// Team Leader account management for their own team:
// create / update / reset password / delete a member, and delete the whole team.
// Members sign in with a UserID or Username; their Auth email is <login_key>@<LOGIN_DOMAIN>.
import { createClient } from 'npm:@supabase/supabase-js@2';

const LOGIN_DOMAIN = 'users.stock-overseee.invalid';
const ROLES = ['oversee', 'staff', 'onlooker'] as const;
const LOGIN_NAME = /^[a-z0-9._-]{3,32}$/;

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
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function checkRole(role: unknown) {
  if (!ROLES.includes(role as (typeof ROLES)[number]))
    throw new HttpError(400, 'Role must be oversee, staff or onlooker');
  return role as string;
}

function checkPassword(pw: unknown) {
  if (typeof pw !== 'string' || pw.length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
  return pw;
}

/** Normalised login name, or null when empty and optional. */
function loginName(value: unknown, label: string, required: boolean): string | null {
  const v = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!v) {
    if (required) throw new HttpError(400, `${label} is required`);
    return null;
  }
  if (!LOGIN_NAME.test(v))
    throw new HttpError(400, `${label}: 3-32 characters, letters, numbers, dot, dash or underscore`);
  return v;
}

async function ensureNamesFree(names: (string | null)[], exceptId?: string) {
  const list = names.filter((n): n is string => !!n);
  if (new Set(list).size !== list.length) throw new HttpError(400, 'UserID and Username must be different');
  for (const n of list) {
    const { data, error } = await admin.from('profiles').select('id').or(`user_code.eq.${n},username.eq.${n}`).limit(1);
    if (error) throw new HttpError(500, error.message);
    if (data?.length && data[0].id !== exceptId) throw new HttpError(409, `"${n}" is already taken`);
  }
}

/** Location access: all locations, or a list of this team's location ids. */
async function checkLocations(body: { all_locations?: unknown; location_ids?: unknown }, teamId: string) {
  const all = body.all_locations !== false;
  if (all) return { all, ids: [] as string[] };
  const ids = Array.isArray(body.location_ids) ? [...new Set(body.location_ids.map(String))] : [];
  if (!ids.length) throw new HttpError(400, 'Pick at least one location, or All locations');
  const { data, error } = await admin.from('locations').select('id').eq('team_id', teamId).in('id', ids);
  if (error) throw new HttpError(500, error.message);
  if ((data ?? []).length !== ids.length) throw new HttpError(400, 'Unknown location');
  return { all, ids };
}

async function setLocations(profileId: string, teamId: string, loc: { all: boolean; ids: string[] }) {
  const { error: delErr } = await admin.from('member_locations').delete().eq('profile_id', profileId);
  if (delErr) throw new HttpError(500, delErr.message);
  if (!loc.all && loc.ids.length) {
    const { error } = await admin
      .from('member_locations')
      .insert(loc.ids.map((location_id) => ({ profile_id: profileId, location_id, team_id: teamId })));
    if (error) throw new HttpError(500, error.message);
  }
  const { error } = await admin.from('profiles').update({ all_locations: loc.all }).eq('id', profileId);
  if (error) throw new HttpError(500, error.message);
}

function friendly(message: string) {
  return /already taken|duplicate key|unique/i.test(message) ? 'That UserID or Username is already taken' : message;
}

async function getMember(userId: unknown, teamId: string) {
  if (typeof userId !== 'string') throw new HttpError(400, 'Missing user_id');
  const { data, error } = await admin.from('profiles').select('id, role, team_id').eq('id', userId).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data || data.team_id !== teamId) throw new HttpError(404, 'User not found');
  return data as { id: string; role: string | null; team_id: string };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  try {
    // Caller must be the active Team Leader of a team.
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) throw new HttpError(401, 'Not signed in');
    const { data: auth, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !auth.user) throw new HttpError(401, 'Not signed in');
    const { data: me } = await admin
      .from('profiles')
      .select('role, is_active, team_id')
      .eq('id', auth.user.id)
      .maybeSingle();
    if (me?.role !== 'owner' || !me.is_active || !me.team_id) {
      throw new HttpError(403, 'Only the Team Leader can manage accounts');
    }
    const teamId: string = me.team_id;

    const body = await req.json().catch(() => ({}));

    switch (body.action) {
      case 'create': {
        const userCode = loginName(body.user_code, 'UserID', true)!;
        const username = loginName(body.username, 'Username', false);
        const role = checkRole(body.role);
        const password = checkPassword(body.password);
        const displayName = String(body.display_name ?? '').trim();
        const locations = await checkLocations(body, teamId);
        await ensureNamesFree([userCode, username]);

        const loginKey = crypto.randomUUID();
        const { data: created, error } = await admin.auth.admin.createUser({
          email: `${loginKey}@${LOGIN_DOMAIN}`,
          password,
          email_confirm: true,
          app_metadata: { managed: 'true' },
        });
        if (error || !created.user) throw new HttpError(400, error?.message ?? 'Could not create user');

        const { error: profErr } = await admin.from('profiles').upsert({
          id: created.user.id,
          team_id: teamId,
          user_code: userCode,
          username,
          login_key: loginKey,
          display_name: displayName,
          role,
          is_active: true,
          can_transfer: body.can_transfer !== false,
        });
        if (profErr) {
          await admin.auth.admin.deleteUser(created.user.id);
          throw new HttpError(409, friendly(profErr.message));
        }
        try {
          await setLocations(created.user.id, teamId, locations);
        } catch (e) {
          await admin.auth.admin.deleteUser(created.user.id);
          throw e;
        }
        return json({ ok: true, id: created.user.id });
      }

      case 'update': {
        const target = await getMember(body.user_id, teamId);
        const patch: Record<string, unknown> = {};
        if (typeof body.display_name === 'string') patch.display_name = body.display_name.trim();
        if (target.role === 'owner') {
          if (body.role !== undefined || body.is_active !== undefined) {
            throw new HttpError(400, "The Team Leader's role and status cannot be changed");
          }
        } else {
          if (body.user_code !== undefined || body.username !== undefined) {
            const userCode = loginName(body.user_code, 'UserID', true);
            const username = loginName(body.username, 'Username', false);
            await ensureNamesFree([userCode, username], target.id);
            patch.user_code = userCode;
            patch.username = username;
          }
          if (body.role !== undefined) patch.role = checkRole(body.role);
          if (typeof body.can_transfer === 'boolean') patch.can_transfer = body.can_transfer;
          if (typeof body.is_active === 'boolean') {
            patch.is_active = body.is_active;
            if (!body.is_active) patch.is_online = false;
          }
        }
        // The profile first: the database refuses a change past the plan's limits (e.g. a second
        // Staff on the Free plan), and then the sign-in is not unblocked either.
        if (Object.keys(patch).length) {
          const { error } = await admin.from('profiles').update(patch).eq('id', target.id);
          if (error) throw new HttpError(409, friendly(error.message));
        }
        if (target.role !== 'owner' && typeof body.is_active === 'boolean') {
          const { error } = await admin.auth.admin.updateUserById(target.id, {
            ban_duration: body.is_active ? 'none' : '876000h',
          });
          if (error) throw new HttpError(500, error.message);
        }
        if (target.role !== 'owner' && (body.all_locations !== undefined || body.location_ids !== undefined)) {
          await setLocations(target.id, teamId, await checkLocations(body, teamId));
        }
        return json({ ok: true });
      }

      case 'set_password': {
        const target = await getMember(body.user_id, teamId);
        const password = checkPassword(body.password);
        const { error } = await admin.auth.admin.updateUserById(target.id, { password });
        if (error) throw new HttpError(500, error.message);
        return json({ ok: true });
      }

      case 'delete': {
        const target = await getMember(body.user_id, teamId);
        if (target.role === 'owner') throw new HttpError(400, 'Use "Delete team" to remove the Team Leader account');
        const { error } = await admin.auth.admin.deleteUser(target.id);
        if (error) throw new HttpError(500, error.message);
        return json({ ok: true });
      }

      case 'delete_team': {
        // Deletes every member account, all stock data, the team, and the Team Leader account.
        const { data: team } = await admin.from('teams').select('name').eq('id', teamId).single();
        if (String(body.confirm_name ?? '').trim() !== team?.name) {
          throw new HttpError(400, 'Type the team name exactly to confirm');
        }
        const { data: members, error: mErr } = await admin.from('profiles').select('id').eq('team_id', teamId);
        if (mErr) throw new HttpError(500, mErr.message);

        for (const table of ['movements', 'transfers', 'notifications', 'stock_levels', 'products', 'locations']) {
          const { error } = await admin.from(table).delete().eq('team_id', teamId);
          if (error) throw new HttpError(500, error.message);
        }
        for (const m of members ?? []) {
          if (m.id === auth.user.id) continue;
          await admin.auth.admin.deleteUser(m.id);
        }
        await admin.from('teams').delete().eq('id', teamId);
        const { error } = await admin.auth.admin.deleteUser(auth.user.id);
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
