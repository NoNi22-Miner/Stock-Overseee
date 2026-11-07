-- Plans, per team (bought by the Team Leader):
--   free       1 location, 1 user per role (plus the Team Leader)
--   pro        many locations, up to 20 users per role. Monthly ($1, plan_until set) or Lifetime ($10)
--   supporter  Pro Lifetime + feature requests answered first + Supporter badge ($20)
-- When a Monthly plan ends nothing is deleted: only the first location and the first user of each
-- role keep working; the others are locked (users become view-only, locations take no stock moves)
-- until Pro is back. Plans are activated with codes for now (Google Play purchase later).
-- Written without DROP / DELETE so it can be applied in one go.

-- 1. The plan ------------------------------------------------------------------------------------
-- Developer accounts (the app's owner): make codes, set plans, answer feature requests.
create table private.developers (
  user_id uuid primary key references auth.users(id) on delete cascade
);

alter table public.teams
  add column plan text not null default 'free' check (plan in ('free', 'pro', 'supporter')),
  add column plan_until timestamptz,          -- null = forever (Lifetime / Supporter)
  add column plan_source text check (plan_source in ('code', 'google_play', 'developer'));

-- Teams can read their own plan, but only these functions (and the developer) can change it.
create function private.protect_plan() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.plan, new.plan_until, new.plan_source) is distinct from (old.plan, old.plan_until, old.plan_source)
     and current_setting('stock.plan_change', true) is distinct from 'yes'
     and coalesce(auth.role(), '') in ('authenticated', 'anon') then
    raise exception 'The plan can only be changed with an activation code';
  end if;
  return new;
end $$;
create trigger teams_protect_plan before update on public.teams
  for each row execute function private.protect_plan();

/** The plan in force now: a Monthly plan past its date counts as free. */
create function public.team_plan(p_team uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
           when t.plan in ('pro', 'supporter') and (t.plan_until is null or t.plan_until > now()) then t.plan
           else 'free'
         end
  from public.teams t where t.id = p_team
$$;

create function public.my_plan() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(public.team_plan(public.my_team()), 'free')
$$;

create function private.max_locations(p_plan text) returns int
language sql immutable set search_path = '' as $$
  select case when p_plan in ('pro', 'supporter') then 1000 else 1 end
$$;

create function private.max_per_role(p_plan text) returns int
language sql immutable set search_path = '' as $$
  select case when p_plan in ('pro', 'supporter') then 20 else 1 end
$$;

-- 2. Locked locations and members (only when a team has more than its plan allows) --------------
/** Active locations past the plan's limit (the oldest stay open; a warehouse first when made together). */
create function public.locked_locations(p_team uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(id), '{}')
  from (
    select id, row_number() over (order by created_at, kind <> 'warehouse', code, id) as n
    from public.locations where team_id = p_team and is_active
  ) x
  where n > private.max_locations(public.team_plan(p_team))
$$;

create function public.location_locked(p_location uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_location = any (public.locked_locations(l.team_id)), false)
  from public.locations l where l.id = p_location
$$;

/** Members past the plan's limit for their role (oldest stay open; the Team Leader never locks). */
create function public.member_locked(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p.role <> 'owner' and (
    select count(*) from public.profiles o
    where o.team_id = p.team_id and o.role = p.role and o.is_active
      and (o.created_at, o.id) < (p.created_at, p.id)
  ) >= private.max_per_role(public.team_plan(p.team_id)), false)
  from public.profiles p where p.id = p_user
$$;

-- A locked member works like an Onlooker (can look, cannot change anything).
create or replace function public.my_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select case when public.member_locked(p.id) then 'onlooker'::public.app_role else p.role end
  from public.profiles p where p.id = auth.uid() and p.is_active
$$;

-- 3. Limits when adding --------------------------------------------------------------------------
create function private.location_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_plan text := public.team_plan(new.team_id);
  v_n    int;
begin
  if not new.is_active or (tg_op = 'UPDATE' and old.is_active and old.team_id = new.team_id) then
    return new;
  end if;
  select count(*) into v_n from public.locations
  where team_id = new.team_id and is_active and id <> new.id;
  if v_n >= private.max_locations(v_plan) then
    raise exception using
      message = case when v_plan = 'free'
        then 'The Free plan has 1 location. Upgrade to Pro for more locations.'
        else 'This plan has reached its location limit.' end,
      errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger locations_limit before insert or update of is_active, team_id on public.locations
  for each row execute function private.location_limit();

create function private.member_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_plan text;
  v_n    int;
begin
  if not new.is_active or new.team_id is null or new.role is null or new.role = 'owner' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.is_active and old.team_id is not distinct from new.team_id
     and old.role is not distinct from new.role then
    return new;
  end if;
  v_plan := public.team_plan(new.team_id);
  select count(*) into v_n from public.profiles
  where team_id = new.team_id and role = new.role and is_active and id <> new.id;
  if v_n >= private.max_per_role(v_plan) then
    raise exception using
      message = case when v_plan = 'free'
        then format('The Free plan has 1 %s. Upgrade to Pro for up to 20 per role.', initcap(new.role::text))
        else format('This plan allows up to %s per role.', private.max_per_role(v_plan)) end,
      errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger profiles_member_limit before insert or update of is_active, role, team_id on public.profiles
  for each row execute function private.member_limit();

-- No stock moves at a locked location.
create function private.locked_location_moves() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
begin
  select code into v_code from public.locations
  where id in (new.from_location_id, new.to_location_id) and public.location_locked(id)
  limit 1;
  if v_code is not null then
    raise exception '% is locked: the Pro plan has ended. Renew Pro to use it again.', v_code;
  end if;
  return new;
end $$;
create trigger movements_locked_location before insert on public.movements
  for each row execute function private.locked_location_moves();

-- New teams start on Free with one location.
create or replace function public.create_team(p_team_name text, p_display_name text default '') returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_team  uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  select email into v_email from auth.users where id = v_uid;
  if v_email is null or v_email like '%@users.stock-overseee.invalid' then
    raise exception 'This account cannot create a team';
  end if;
  if exists (select 1 from public.profiles where id = v_uid and (team_id is not null or role is not null)) then
    raise exception 'You already belong to a team';
  end if;
  if length(trim(coalesce(p_team_name, ''))) = 0 then
    raise exception 'Enter a team name';
  end if;

  insert into public.teams (name) values (trim(p_team_name)) returning id into v_team;
  insert into public.profiles (id, team_id, role, display_name)
  values (v_uid, v_team, 'owner', coalesce(nullif(trim(p_display_name), ''), 'Team Leader'))
  on conflict (id) do update
    set team_id = excluded.team_id, role = 'owner', display_name = excluded.display_name, is_active = true;
  insert into public.locations (team_id, code, name, kind) values (v_team, 'WRH', 'Warehouse', 'warehouse');
  return v_team;
end $$;

-- 4. What the app shows about the plan -----------------------------------------------------------
create function public.my_plan_info() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'plan', public.team_plan(t.id),
    'saved_plan', t.plan,
    'plan_until', t.plan_until,
    'plan_source', t.plan_source,
    'max_locations', private.max_locations(public.team_plan(t.id)),
    'max_per_role', private.max_per_role(public.team_plan(t.id)),
    'locked', public.member_locked(auth.uid()),
    'locked_locations', to_jsonb(public.locked_locations(t.id)),
    'locked_members', (
      select coalesce(jsonb_agg(p.id), '[]') from public.profiles p
      where p.team_id = t.id and p.is_active and public.member_locked(p.id)),
    'locations', (select count(*) from public.locations where team_id = t.id and is_active),
    'members', (
      select coalesce(jsonb_object_agg(role, n), '{}') from (
        select role, count(*) n from public.profiles
        where team_id = t.id and is_active and role is not null group by role) r),
    'developer', exists (select 1 from private.developers d where d.user_id = auth.uid())
  )
  from public.teams t where t.id = public.my_team()
$$;

-- 5. Activation codes ----------------------------------------------------------------------------
create table private.activation_codes (
  code_hash      text primary key,              -- sha256 of the code; the code itself is not kept
  hint           text not null,                 -- last 4 characters, to recognise it
  plan           text not null check (plan in ('pro', 'supporter')),
  months         int check (months is null or months between 1 and 120),   -- null = lifetime
  note           text,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  redeemed_team  uuid references public.teams(id) on delete set null,
  redeemed_by    uuid references auth.users(id) on delete set null,
  redeemed_at    timestamptz
);

create table private.code_attempts (
  team_id uuid not null,
  at      timestamptz not null default now()
);
create index code_attempts_team_idx on private.code_attempts (team_id, at);

create function private.code_hash(p_code text) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')), 'UTF8')), 'hex')
$$;

/** Team Leader: use an activation code. */
create function public.redeem_code(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_team uuid := public.my_team();
  v_code private.activation_codes;
  v_t    public.teams;
  v_now  text;
begin
  if v_team is null or not public.has_role('owner') then
    raise exception 'Only the Team Leader can use an activation code';
  end if;
  if (select count(*) from private.code_attempts where team_id = v_team and at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many wrong codes. Try again in an hour.';
  end if;
  select * into v_code from private.activation_codes where code_hash = private.code_hash(p_code) for update;
  if v_code.code_hash is null or v_code.redeemed_at is not null then
    -- Counted (not raised), so wrong guesses are limited.
    insert into private.code_attempts (team_id) values (v_team);
    return jsonb_build_object('error', 'This code is not valid or was already used.');
  end if;

  select * into v_t from public.teams where id = v_team for update;
  v_now := public.team_plan(v_team);
  if v_now = 'supporter' or (v_now = 'pro' and v_t.plan_until is null and v_code.plan = 'pro') then
    raise exception 'Your plan is already for life. Keep this code for another team.';
  end if;

  perform set_config('stock.plan_change', 'yes', true);
  if v_code.plan = 'supporter' then
    update public.teams set plan = 'supporter', plan_until = null, plan_source = 'code' where id = v_team;
  elsif v_code.months is null then
    update public.teams set plan = 'pro', plan_until = null, plan_source = 'code' where id = v_team;
  else
    -- Months are added after the current Pro month, if one is running.
    update public.teams
       set plan = 'pro',
           plan_until = greatest(now(), case when v_now = 'pro' then plan_until else now() end)
                        + make_interval(months => v_code.months),
           plan_source = 'code'
     where id = v_team;
  end if;
  perform set_config('stock.plan_change', '', true);

  update private.activation_codes
     set redeemed_team = v_team, redeemed_by = auth.uid(), redeemed_at = now()
   where code_hash = v_code.code_hash;
  return public.my_plan_info();
end $$;

-- 6. Feature requests (Supporter) ----------------------------------------------------------------
create table public.feature_requests (
  id          bigint generated always as identity primary key,
  team_id     uuid not null default public.my_team() references public.teams(id) on delete cascade,
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  title       text not null check (length(trim(title)) between 3 and 120),
  body        text not null default '' check (length(body) <= 2000),
  status      text not null default 'new' check (status in ('new', 'planned', 'done', 'declined')),
  reply       text check (reply is null or length(reply) <= 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index feature_requests_team_idx on public.feature_requests (team_id, created_at desc);
alter table public.feature_requests enable row level security;
create policy "team reads its requests" on public.feature_requests for select to authenticated
  using (team_id = (select public.my_team()));
create policy "supporters send requests" on public.feature_requests for insert to authenticated
  with check (
    team_id = (select public.my_team())
    and (select public.has_role('owner', 'oversee'))
    and (select public.my_plan()) = 'supporter'
    and status = 'new' and reply is null
  );

-- 7. App settings (e.g. how to buy a code), readable by everyone signed in -------------------------
create table public.app_settings (
  key    text primary key,
  value  text not null default ''
);
alter table public.app_settings enable row level security;
create policy "signed in reads app settings" on public.app_settings for select to authenticated using (true);
insert into public.app_settings (key, value) values ('contact', '') on conflict (key) do nothing;

-- 8. Developer tools (only accounts in private.developers) ---------------------------------------
create function private.require_developer() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.developers where user_id = auth.uid()) then
    raise exception 'Developer only';
  end if;
end $$;

/** Makes activation codes and returns them once (only their hash is kept). */
create function public.dev_make_codes(p_plan text, p_months int, p_count int, p_note text default null)
returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  v_alpha constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_out   text[] := '{}';
  v_hex   text;
  v_code  text;
  i       int;
  j       int;
begin
  perform private.require_developer();
  if p_plan not in ('pro', 'supporter') then raise exception 'Unknown plan'; end if;
  if p_count is null or p_count not between 1 and 50 then raise exception 'Make 1 to 50 codes at a time'; end if;
  if p_plan = 'supporter' then p_months := null; end if;
  for i in 1..p_count loop
    -- 12 characters from two random UUIDs (version / variant digits left out).
    v_hex := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    v_hex := substr(v_hex, 1, 12) || substr(v_hex, 14, 3) || substr(v_hex, 18, 15) || substr(v_hex, 33, 12);
    v_code := '';
    for j in 0..11 loop
      v_code := v_code || substr(v_alpha, (('x' || substr(v_hex, j * 2 + 1, 2))::bit(8)::int % 31) + 1, 1);
    end loop;
    v_code := substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-' || substr(v_code, 9, 4);
    insert into private.activation_codes (code_hash, hint, plan, months, note, created_by)
    values (private.code_hash(v_code), right(v_code, 4), p_plan, p_months, nullif(trim(p_note), ''), auth.uid());
    v_out := v_out || v_code;
  end loop;
  return v_out;
end $$;

create function public.dev_codes(p_limit int default 100)
returns table (hint text, plan text, months int, note text, created_at timestamptz, redeemed_at timestamptz,
               team_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_developer();
  return query
    select c.hint, c.plan, c.months, c.note, c.created_at, c.redeemed_at, t.name
    from private.activation_codes c left join public.teams t on t.id = c.redeemed_team
    order by c.created_at desc limit least(coalesce(p_limit, 100), 500);
end $$;

create function public.dev_teams()
returns table (id uuid, name text, plan text, saved_plan text, plan_until timestamptz, plan_source text,
               members bigint, locations bigint, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_developer();
  return query
    select t.id, t.name, public.team_plan(t.id), t.plan, t.plan_until, t.plan_source,
           (select count(*) from public.profiles p where p.team_id = t.id and p.is_active),
           (select count(*) from public.locations l where l.team_id = t.id and l.is_active),
           t.created_at
    from public.teams t order by t.created_at desc;
end $$;

create function public.dev_set_plan(p_team uuid, p_plan text, p_until timestamptz default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_developer();
  if p_plan not in ('free', 'pro', 'supporter') then raise exception 'Unknown plan'; end if;
  perform set_config('stock.plan_change', 'yes', true);
  update public.teams
     set plan = p_plan,
         plan_until = case when p_plan = 'pro' then p_until else null end,
         plan_source = case when p_plan = 'free' then null else 'developer' end
   where id = p_team;
  perform set_config('stock.plan_change', '', true);
end $$;

create function public.dev_requests()
returns table (id bigint, team_name text, team_plan text, title text, body text, status text, reply text,
               created_at timestamptz, updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_developer();
  return query
    select r.id, t.name, public.team_plan(t.id), r.title, r.body, r.status, r.reply, r.created_at, r.updated_at
    from public.feature_requests r join public.teams t on t.id = r.team_id
    -- Supporters first, open requests first, newest first.
    order by (public.team_plan(t.id) = 'supporter') desc, (r.status in ('new', 'planned')) desc, r.created_at desc;
end $$;

create function public.dev_answer_request(p_id bigint, p_status text, p_reply text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_developer();
  update public.feature_requests
     set status = p_status, reply = nullif(trim(p_reply), ''), updated_at = now()
   where id = p_id;
end $$;

create function public.dev_set_contact(p_value text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_developer();
  insert into public.app_settings (key, value) values ('contact', coalesce(trim(p_value), ''))
  on conflict (key) do update set value = excluded.value;
end $$;

-- Only signed-in users may call these.
revoke execute on function public.team_plan(uuid), public.my_plan(), public.locked_locations(uuid),
  public.location_locked(uuid), public.member_locked(uuid), public.my_plan_info(), public.redeem_code(text),
  public.dev_make_codes(text, int, int, text), public.dev_codes(int), public.dev_teams(),
  public.dev_set_plan(uuid, text, timestamptz), public.dev_requests(), public.dev_answer_request(bigint, text, text),
  public.dev_set_contact(text)
  from public, anon;
grant execute on function public.team_plan(uuid), public.my_plan(), public.locked_locations(uuid),
  public.location_locked(uuid), public.member_locked(uuid), public.my_plan_info(), public.redeem_code(text),
  public.dev_make_codes(text, int, int, text), public.dev_codes(int), public.dev_teams(),
  public.dev_set_plan(uuid, text, timestamptz), public.dev_requests(), public.dev_answer_request(bigint, text, text),
  public.dev_set_contact(text)
  to authenticated;
