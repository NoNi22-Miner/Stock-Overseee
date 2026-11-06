// Sends one in-app notification to the recipient's phones via Firebase Cloud Messaging (HTTP v1).
// Called by a database trigger (pg_net) right after a notification row is inserted.
//
// Needs the Edge Function secret FCM_SERVICE_ACCOUNT = the Firebase service-account JSON
// (Firebase console → Project settings → Service accounts → Generate new private key).
// Without it the function does nothing, so the app keeps working with in-app notifications only.
import { createClient } from 'npm:@supabase/supabase-js@2';

type ServiceAccount = { project_id: string; client_email: string; private_key: string };

function secretKey(): string {
  try {
    const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default;
    if (k) return k;
  } catch {
    // fall through to the legacy key
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}

const admin = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** The Firebase key from the FCM_SERVICE_ACCOUNT secret, or why it can't be used. */
function serviceAccount(): ServiceAccount | string {
  const raw = Deno.env.get('FCM_SERVICE_ACCOUNT');
  if (!raw) return 'FCM_SERVICE_ACCOUNT not set';
  try {
    const sa = JSON.parse(raw);
    if (sa.project_id && sa.client_email && sa.private_key) return sa;
    return 'FCM_SERVICE_ACCOUNT is JSON but not a service-account key (missing project_id / client_email / private_key)';
  } catch {
    return `FCM_SERVICE_ACCOUNT is not valid JSON (${raw.length} characters; paste the whole key file)`;
  }
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const b64urlText = (s: string) => b64url(new TextEncoder().encode(s));

function pemToDer(pem: string) {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

let cachedToken: { token: string; exp: number } | null = null;

/** OAuth access token for FCM, from a self-signed service-account JWT. */
async function accessToken(sa: ServiceAccount) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp > now + 60) return cachedToken.token;
  const header = b64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64urlText(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  );
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`)),
  );
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${b64url(sig)}`,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Google auth failed: ${json.error_description ?? json.error ?? res.status}`);
  cachedToken = { token: json.access_token, exp: now + (json.expires_in ?? 3600) };
  return cachedToken.token;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Use POST', { status: 405 });
  const sa = serviceAccount();
  if (typeof sa === 'string') return Response.json({ skipped: sa });

  const { notification_id } = await req.json().catch(() => ({}));
  if (!notification_id) return Response.json({ error: 'notification_id required' }, { status: 400 });

  // Claim the notification so it is pushed at most once, and only while it is fresh.
  const { data: n } = await admin
    .from('notifications')
    .update({ pushed_at: new Date().toISOString() })
    .eq('id', notification_id)
    .is('pushed_at', null)
    .gt('created_at', new Date(Date.now() - 10 * 60_000).toISOString())
    .select('id, user_id, kind, title, body, data')
    .maybeSingle();
  if (!n) return Response.json({ skipped: 'already pushed or not found' });

  const { data: tokens } = await admin.from('push_tokens').select('token').eq('user_id', n.user_id).eq('active', true);
  if (!tokens?.length) return Response.json({ sent: 0 });

  const { count } = await admin
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', n.user_id)
    .is('read_at', null);

  const data: Record<string, string> = { notification_id: String(n.id), kind: n.kind };
  for (const [k, v] of Object.entries(n.data ?? {})) if (v != null) data[k] = String(v);

  const bearer = await accessToken(sa);
  let sent = 0;
  const failed: string[] = [];
  for (const { token } of tokens) {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: n.title, body: n.body },
          data,
          android: {
            priority: 'HIGH',
            notification: { channel_id: 'default', sound: 'default', notification_count: count ?? undefined },
          },
        },
      }),
    });
    if (res.ok) {
      sent++;
    } else {
      const err = await res.json().catch(() => ({}));
      const code = err?.error?.details?.[0]?.errorCode ?? err?.error?.status;
      // The phone uninstalled the app or the token expired: stop using it.
      if (res.status === 404 || code === 'UNREGISTERED') {
        await admin.from('push_tokens').update({ active: false }).eq('token', token);
      } else {
        console.error('FCM send failed', res.status, JSON.stringify(err));
      }
      failed.push(String(code ?? res.status));
    }
  }
  return Response.json({ sent, failed });
});
