// Owner-only account management: create / update / reset password / delete.
// Non-owner accounts sign in with a User ID, stored in Auth as <userid>@<LOGIN_DOMAIN>.
import { createClient } from 'npm:@supabase/supabase-js@2';

const LOGIN_DOMAIN = 'users.stock-overseee.invalid';
const ROLES = ['oversee', 'staff', 'onlooker'] as const;
const USER_CODE = /^[a-z0-9._-]{3,32}$/;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

function secretKey(): string {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (keys) {
    try {
      const k = JSON.parse(keys).default;
      if (k) return k;
    } catch {
      // fall through to the legacy key
    }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}

const admin = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function checkRole(role: unknown) {
  if (!ROLES.includes(role as (typeof ROLES)[number])) throw new HttpError(400, 'Role must be oversee, staff or onlooker');
  return role as string;
}

function checkPassword(pw: unknown) {
  if (typeof pw !== 'string' || pw.length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
  return pw;
}

async function getTarget(userId: unknown) {
  if (typeof userId !== 'string') throw new HttpError(400, 'Missing user_id');
  const { data, error } = await admin.from('profiles').select('id, role').eq('id', userId).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(404, 'User not found');
  return data as { id: string; role: string | null };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  try {
    // Who is calling? Must be the active owner.
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) throw new HttpError(401, 'Not signed in');
    const { data: auth, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !auth.user) throw new HttpError(401, 'Not signed in');
    const { data: me } = await admin.from('profiles').select('role, is_active').eq('id', auth.user.id).maybeSingle();
    if (me?.role !== 'owner' || !me.is_active) throw new HttpError(403, 'Only the Owner can manage accounts');

    const body = await req.json().catch(() => ({}));

    switch (body.action) {
      case 'create': {
        const code = String(body.user_code ?? '').trim().toLowerCase();
        if (!USER_CODE.test(code)) {
          throw new HttpError(400, 'User ID: 3-32 characters, letters, numbers, dot, dash or underscore');
        }
        const role = checkRole(body.role);
        const password = checkPassword(body.password);
        const displayName = String(body.display_name ?? '').trim();

        const { data: taken } = await admin.from('profiles').select('id').eq('user_code', code).maybeSingle();
        if (taken) throw new HttpError(409, 'That User ID is already taken');

        const { data: created, error } = await admin.auth.admin.createUser({
          email: `${code}@${LOGIN_DOMAIN}`,
          password,
          email_confirm: true,
          user_metadata: { user_code: code, display_name: displayName },
        });
        if (error || !created.user) {
          const msg = error?.message ?? 'Could not create user';
          throw new HttpError(/already/i.test(msg) ? 409 : 400, /already/i.test(msg) ? 'That User ID is already taken' : msg);
        }

        // The auth trigger made an empty profile; fill it in.
        const { error: profErr } = await admin.from('profiles').upsert({
          id: created.user.id,
          user_code: code,
          display_name: displayName,
          role,
          is_active: true,
          can_transfer: body.can_transfer !== false,
        });
        if (profErr) {
          await admin.auth.admin.deleteUser(created.user.id);
          throw new HttpError(500, profErr.message);
        }
        return json({ ok: true, id: created.user.id });
      }

      case 'update': {
        const target = await getTarget(body.user_id);
        const patch: Record<string, unknown> = {};
        if (typeof body.display_name === 'string') patch.display_name = body.display_name.trim();
        if (target.role === 'owner') {
          if (body.role !== undefined || body.is_active !== undefined) {
            throw new HttpError(400, "The Owner's role and status cannot be changed");
          }
        } else {
          if (body.role !== undefined) patch.role = checkRole(body.role);
          if (typeof body.can_transfer === 'boolean') patch.can_transfer = body.can_transfer;
          if (typeof body.is_active === 'boolean') {
            patch.is_active = body.is_active;
            if (!body.is_active) patch.is_online = false;
            const { error } = await admin.auth.admin.updateUserById(target.id, {
              ban_duration: body.is_active ? 'none' : '876000h',
            });
            if (error) throw new HttpError(500, error.message);
          }
        }
        if (Object.keys(patch).length) {
          const { error } = await admin.from('profiles').update(patch).eq('id', target.id);
          if (error) throw new HttpError(500, error.message);
        }
        return json({ ok: true });
      }

      case 'set_password': {
        const target = await getTarget(body.user_id);
        const password = checkPassword(body.password);
        const { error } = await admin.auth.admin.updateUserById(target.id, { password });
        if (error) throw new HttpError(500, error.message);
        return json({ ok: true });
      }

      case 'delete': {
        const target = await getTarget(body.user_id);
        if (target.role === 'owner') throw new HttpError(400, 'The Owner account cannot be deleted');
        const { error } = await admin.auth.admin.deleteUser(target.id);
        if (error) throw new HttpError(500, error.message);
        return json({ ok: true });
      }

      default:
        throw new HttpError(400, 'Unknown action');
    }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json({ error: (e as Error).message }, status);
  }
});
