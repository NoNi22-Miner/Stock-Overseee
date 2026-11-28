-- Devices signed in to the team, and one bound device for the Team Leader (role owner).
-- The place is a coarse city and country from the network address, never GPS.
-- A revoked sign-in is the session, so signing in again on the same phone is allowed
-- while the signed-out session can no longer change stock.

create table public.member_devices (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null default public.my_team() references public.teams(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  device_key    text not null check (length(device_key) between 8 and 80),
  model         text check (model is null or length(model) <= 80),
  os_name       text check (os_name is null or length(os_name) <= 40),
  os_version    text check (os_version is null or length(os_version) <= 40),
  app_version   text check (app_version is null or length(app_version) <= 40),
  ip            text check (ip is null or length(ip) <= 64),
  place         text check (place is null or length(place) <= 120),
  signed_in_at  timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  revoked_at    timestamptz,
  unique (user_id, device_key)
);
create index member_devices_team_idx on public.member_devices (team_id, last_seen_at desc);

-- One row per auth session. Kept even after the device signs in again, so the old session stays revoked.
create table public.device_sessions (
  session_id  text primary key,
  device_id   uuid not null references public.member_devices(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  revoked_at  timestamptz
);
create index device_sessions_device_idx on public.device_sessions (device_id);

alter table public.profiles add column bound_device_key text;

alter table public.member_devices enable row level security;
create policy "member reads own devices" on public.member_devices for select to authenticated
  using (user_id = (select auth.uid()));
create policy "owner reads team devices" on public.member_devices for select to authenticated
  using (team_id = (select public.my_team()) and (select public.has_role('owner')));

alter table public.device_sessions enable row level security;
-- No policies: only the functions below read or write sessions.

create function private.request_ip() returns text
language plpgsql stable set search_path = '' as $$
declare
  h jsonb;
  v text;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return null;
  end;
  if h is null then
    return null;
  end if;
  v := coalesce(
    nullif(trim(h->>'cf-connecting-ip'), ''),
    nullif(trim(h->>'x-real-ip'), ''),
    nullif(trim(split_part(coalesce(h->>'x-forwarded-for', ''), ',', 1)), '')
  );
  if v is null or length(v) > 64 then
    return null;
  end if;
  return v;
end $$;
revoke all on function private.request_ip() from public, anon, authenticated;

create function private.revoke_device_sessions(p_device uuid) returns void
language sql security definer set search_path = '' as $$
  update public.device_sessions set revoked_at = coalesce(revoked_at, now()) where device_id = p_device;
$$;
revoke all on function private.revoke_device_sessions(uuid) from public, anon, authenticated;

create function public.register_device(
  p_device_key  text,
  p_model       text default null,
  p_os_name     text default null,
  p_os_version  text default null,
  p_app_version text default null,
  p_place       text default null,
  p_replace     boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_team    uuid;
  v_role    text;
  v_bound   text;
  v_session text := nullif(auth.jwt()->>'session_id', '');
  v_key     text := nullif(trim(coalesce(p_device_key, '')), '');
  v_id      uuid;
  v_other   uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if v_session is null then
    raise exception 'This sign-in has no session';
  end if;
  if v_key is null or length(v_key) < 8 or length(v_key) > 80 then
    raise exception 'This device could not be recognised';
  end if;
  select team_id, role::text, bound_device_key into v_team, v_role, v_bound
    from public.profiles where id = v_uid and is_active;
  if v_team is null or v_role is null then
    raise exception 'Your account cannot sign in on a device';
  end if;

  if v_role = 'owner' and v_bound is not null and v_bound <> v_key and not coalesce(p_replace, false) then
    return jsonb_build_object('ok', false, 'code', 'replace_required');
  end if;

  if exists (
    select 1 from public.device_sessions where session_id = v_session and revoked_at is not null
  ) then
    return jsonb_build_object('ok', false, 'code', 'revoked');
  end if;

  if v_role = 'owner' and coalesce(p_replace, false) and v_bound is distinct from v_key then
    update public.member_devices
       set revoked_at = now()
     where user_id = v_uid and device_key is distinct from v_key and revoked_at is null;
    for v_other in
      select id from public.member_devices where user_id = v_uid and device_key is distinct from v_key
    loop
      perform private.revoke_device_sessions(v_other);
    end loop;
    update public.profiles set bound_device_key = v_key where id = v_uid;
  elsif v_role = 'owner' and v_bound is null then
    update public.profiles set bound_device_key = v_key where id = v_uid;
  end if;

  insert into public.member_devices (
    team_id, user_id, device_key, model, os_name, os_version, app_version, ip, place,
    signed_in_at, last_seen_at, revoked_at
  ) values (
    v_team, v_uid, v_key,
    nullif(left(trim(coalesce(p_model, '')), 80), ''),
    nullif(left(trim(coalesce(p_os_name, '')), 40), ''),
    nullif(left(trim(coalesce(p_os_version, '')), 40), ''),
    nullif(left(trim(coalesce(p_app_version, '')), 40), ''),
    private.request_ip(),
    nullif(left(trim(coalesce(p_place, '')), 120), ''),
    now(), now(), null
  )
  on conflict (user_id, device_key) do update set
    team_id = excluded.team_id,
    model = coalesce(excluded.model, public.member_devices.model),
    os_name = coalesce(excluded.os_name, public.member_devices.os_name),
    os_version = coalesce(excluded.os_version, public.member_devices.os_version),
    app_version = coalesce(excluded.app_version, public.member_devices.app_version),
    ip = coalesce(excluded.ip, public.member_devices.ip),
    place = coalesce(excluded.place, public.member_devices.place),
    last_seen_at = now(),
    revoked_at = null
  returning id into v_id;

  -- The previous session on this phone can no longer change stock.
  update public.device_sessions
     set revoked_at = coalesce(revoked_at, now())
   where device_id = v_id and session_id <> v_session and revoked_at is null;

  insert into public.device_sessions (session_id, device_id, user_id)
  values (v_session, v_id, v_uid)
  on conflict (session_id) do update set
    device_id = excluded.device_id,
    revoked_at = null;

  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.register_device(text, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.register_device(text, text, text, text, text, text, boolean) to authenticated;

create function public.release_owner_device(p_device_key text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_bound text;
begin
  if not public.has_role('owner') then
    raise exception 'Only the Team Leader can release the bound device';
  end if;
  select bound_device_key into v_bound from public.profiles where id = auth.uid();
  if v_bound is null or v_bound <> nullif(trim(coalesce(p_device_key, '')), '') then
    raise exception 'Release the binding from the device that is signed in now';
  end if;
  update public.profiles set bound_device_key = null where id = auth.uid();
end $$;
revoke all on function public.release_owner_device(text) from public, anon;
grant execute on function public.release_owner_device(text) to authenticated;

create function public.revoke_device(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_key  text;
  v_mine text;
begin
  if not public.has_role('owner') or public.my_team() is null then
    raise exception 'Only the Team Leader can sign a device out';
  end if;
  select user_id, device_key into v_user, v_key
    from public.member_devices
   where id = p_id and team_id = public.my_team();
  if v_user is null then
    raise exception 'Device not found';
  end if;
  select d.device_key into v_mine
    from public.device_sessions s
    join public.member_devices d on d.id = s.device_id
   where s.session_id = nullif(auth.jwt()->>'session_id', '') and s.user_id = auth.uid();
  if v_user = auth.uid() and v_key = v_mine then
    raise exception 'Use Sign out to leave this device';
  end if;
  update public.member_devices set revoked_at = now() where id = p_id and revoked_at is null;
  perform private.revoke_device_sessions(p_id);
end $$;
revoke all on function public.revoke_device(uuid) from public, anon;
grant execute on function public.revoke_device(uuid) to authenticated;

create function private.reject_blocked_device() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_session text := nullif(auth.jwt()->>'session_id', '');
  v_role    text;
  v_bound   text;
  v_key     text;
  v_revoked timestamptz;
begin
  if v_uid is null or v_session is null then
    return new;
  end if;
  select role::text, bound_device_key into v_role, v_bound from public.profiles where id = v_uid;
  select d.device_key, s.revoked_at into v_key, v_revoked
    from public.device_sessions s
    join public.member_devices d on d.id = s.device_id
   where s.session_id = v_session and s.user_id = v_uid;
  if v_revoked is not null then
    raise exception 'This device was signed out by the Team Leader. Sign in again if you are allowed to.';
  end if;
  if v_role = 'owner' and v_bound is not null and (v_key is null or v_key <> v_bound) then
    raise exception 'The Team Leader account is bound to another device.';
  end if;
  return new;
end $$;
create trigger movements_device before insert on public.movements
  for each row execute function private.reject_blocked_device();
