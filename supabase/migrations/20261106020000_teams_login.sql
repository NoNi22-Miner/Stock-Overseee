-- Teams (one per Team Leader) + one-box login (UserID / Username / Email)
--
-- * Anyone can sign up with email and create a team; they become its Team Leader (role 'owner').
-- * Team Leaders create Oversee / Staff / Onlooker accounts (Edge Function "manage-users").
--   Those accounts sign in with their UserID or Username; their Auth email is an opaque
--   <login_key>@users.stock-overseee.invalid that nobody needs to know.
-- * All stock data belongs to a team; members only ever see their own team.

-- Teams -------------------------------------------------------------------------
create table public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 1 and 60),
  created_at  timestamptz not null default now()
);
alter table public.teams enable row level security;

-- Private settings (not reachable through the API) ---------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table private.settings (key text primary key, value text not null);
insert into private.settings (key, value)
values ('login_salt', encode(extensions.gen_random_bytes(32), 'hex'));

-- Profiles: team, second login name, login key ---------------------------------
alter table public.profiles
  add column team_id   uuid references public.teams(id) on delete cascade,
  add column username  text unique check (username ~ '^[a-z0-9._-]{3,32}$'),
  add column login_key uuid unique;

drop index public.profiles_single_owner;
create unique index profiles_one_leader_per_team on public.profiles (team_id) where role = 'owner';
create index profiles_team_idx on public.profiles (team_id);

-- A UserID or Username may only be used once, across both columns.
create function public.check_login_names() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (
    select 1 from public.profiles p
    where p.id <> new.id
      and (p.user_code in (new.user_code, new.username) or p.username in (new.user_code, new.username))
  ) then
    raise exception 'That UserID or Username is already taken';
  end if;
  return new;
end $$;

create trigger profiles_login_names
  before insert or update of user_code, username on public.profiles
  for each row execute function public.check_login_names();

-- Team columns on stock data ------------------------------------------------------
alter table public.locations    add column team_id uuid references public.teams(id) on delete cascade;
alter table public.products     add column team_id uuid references public.teams(id) on delete cascade;
alter table public.stock_levels add column team_id uuid references public.teams(id) on delete cascade;
alter table public.movements    add column team_id uuid references public.teams(id) on delete cascade;

-- Existing data goes to the existing owner's team.
do $$
declare
  t uuid;
begin
  if exists (select 1 from public.profiles where role is not null) then
    insert into public.teams (name) values ('My Team') returning id into t;
    update public.profiles     set team_id = t where role is not null;
    update public.locations    set team_id = t;
    update public.products     set team_id = t;
    update public.stock_levels set team_id = t;
    update public.movements    set team_id = t;
  end if;
end $$;

-- Seed rows from the first migration on a fresh install have no team.
delete from public.locations where team_id is null;

alter table public.locations    alter column team_id set not null;
alter table public.products     alter column team_id set not null;
alter table public.stock_levels alter column team_id set not null;
alter table public.movements    alter column team_id set not null;

-- Location codes and barcodes are unique per team, not globally.
alter table public.locations drop constraint locations_code_key;
alter table public.locations add constraint locations_team_code_key unique (team_id, code);
alter table public.products drop constraint products_barcode_key;
alter table public.products add constraint products_team_barcode_key unique (team_id, barcode);

create index stock_levels_team_idx on public.stock_levels (team_id);
create index movements_team_created_idx on public.movements (team_id, created_at desc);

-- Helpers ---------------------------------------------------------------------------
create function public.my_team() returns uuid
language sql stable security definer set search_path = '' as $$
  select team_id from public.profiles where id = auth.uid() and is_active and role is not null
$$;
revoke execute on function public.my_team() from public, anon;
grant  execute on function public.my_team() to authenticated;

alter table public.locations alter column team_id set default public.my_team();
alter table public.products  alter column team_id set default public.my_team();

-- Policies: always limited to the caller's team ------------------------------------
drop policy "members read locations"  on public.locations;
drop policy "managers add locations"  on public.locations;
drop policy "managers edit locations" on public.locations;
drop policy "members read products"   on public.products;
drop policy "managers add products"   on public.products;
drop policy "managers edit products"  on public.products;
drop policy "members read stock"      on public.stock_levels;
drop policy "members read movements"  on public.movements;
drop policy "read profiles"           on public.profiles;

create policy "team reads locations" on public.locations for select to authenticated
  using (team_id = (select public.my_team()));
create policy "team managers add locations" on public.locations for insert to authenticated
  with check (team_id = (select public.my_team()) and (select public.has_role('owner', 'oversee')));
create policy "team managers edit locations" on public.locations for update to authenticated
  using (team_id = (select public.my_team()) and (select public.has_role('owner', 'oversee')))
  with check (team_id = (select public.my_team()) and (select public.has_role('owner', 'oversee')));

create policy "team reads products" on public.products for select to authenticated
  using (team_id = (select public.my_team()));
create policy "team managers add products" on public.products for insert to authenticated
  with check (team_id = (select public.my_team()) and (select public.has_role('owner', 'oversee')));
create policy "team managers edit products" on public.products for update to authenticated
  using (team_id = (select public.my_team()) and (select public.has_role('owner', 'oversee')))
  with check (team_id = (select public.my_team()) and (select public.has_role('owner', 'oversee')));

create policy "team reads stock" on public.stock_levels for select to authenticated
  using (team_id = (select public.my_team()));
create policy "team reads movements" on public.movements for select to authenticated
  using (team_id = (select public.my_team()));

create policy "read profiles" on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (team_id = (select public.my_team()) and (select public.has_role('owner', 'oversee')))
  );

create policy "team reads its team" on public.teams for select to authenticated
  using (id = (select public.my_team()));
create policy "leader renames team" on public.teams for update to authenticated
  using (id = (select public.my_team()) and (select public.has_role('owner')))
  with check (id = (select public.my_team()) and (select public.has_role('owner')));

-- New auth users ----------------------------------------------------------------
-- Only the manage-users function may create accounts on the internal login domain.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email like '%@users.stock-overseee.invalid'
     and coalesce(new.raw_app_meta_data->>'managed', '') <> 'true' then
    raise exception 'This email address cannot be used';
  end if;
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Sign-up: a new, confirmed email account creates its team ------------------------
create function public.create_team(p_team_name text, p_display_name text default '') returns uuid
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
  insert into public.locations (team_id, code, name, kind) values
    (v_team, 'WRH', 'Warehouse', 'warehouse'),
    (v_team, 'TOKO', 'Toko', 'store');
  return v_team;
end $$;
revoke execute on function public.create_team(text, text) from public, anon;
grant  execute on function public.create_team(text, text) to authenticated;

-- One-box login: turn a UserID / Username into the Auth email --------------------
-- Unknown names get a stable fake address, so the answer never reveals whether a name exists.
create function public.resolve_login(p_identifier text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v    text := lower(trim(coalesce(p_identifier, '')));
  k    uuid;
  salt text;
begin
  if position('@' in v) > 0 then
    return v;
  end if;
  select login_key into k from public.profiles
   where (user_code = v or username = v) and login_key is not null
   limit 1;
  if k is null then
    select value into salt from private.settings where key = 'login_salt';
    k := md5(salt || v)::uuid;
  end if;
  return k::text || '@users.stock-overseee.invalid';
end $$;
revoke execute on function public.resolve_login(text) from public;
grant  execute on function public.resolve_login(text) to anon, authenticated;

-- Stock functions: check everything belongs to the caller's team ----------------
create or replace function public.record_movement(
  p_kind        text,
  p_product_id  uuid,
  p_qty         numeric,
  p_from        uuid default null,
  p_to          uuid default null,
  p_note        text default null
) returns public.movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team uuid := public.my_team();
  v_row  public.movements;
begin
  if not public.has_role('owner', 'oversee', 'staff') or v_team is null then
    raise exception 'Your account is not allowed to change stock';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'Quantity must be more than 0';
  end if;
  if p_kind not in ('IN', 'OUT', 'TRANSFER') then
    raise exception 'Unknown movement type %', p_kind;
  end if;
  if p_kind = 'TRANSFER' and public.my_role() = 'staff'
     and not coalesce((select can_transfer from public.profiles where id = auth.uid()), false) then
    raise exception 'Your account is not allowed to transfer stock';
  end if;

  if p_kind = 'IN' then p_from := null; end if;
  if p_kind = 'OUT' then p_to := null; end if;

  if not exists (select 1 from public.products where id = p_product_id and team_id = v_team) then
    raise exception 'Product not found';
  end if;
  if (p_from is not null and not exists (select 1 from public.locations where id = p_from and team_id = v_team))
     or (p_to is not null and not exists (select 1 from public.locations where id = p_to and team_id = v_team)) then
    raise exception 'Location not found';
  end if;

  if p_from is not null then
    update public.stock_levels
       set qty = qty - p_qty, updated_at = now()
     where product_id = p_product_id and location_id = p_from and qty >= p_qty;
    if not found then
      raise exception 'Not enough stock at source location';
    end if;
  end if;

  if p_to is not null then
    insert into public.stock_levels (team_id, product_id, location_id, qty)
    values (v_team, p_product_id, p_to, p_qty)
    on conflict (product_id, location_id)
    do update set qty = public.stock_levels.qty + excluded.qty, updated_at = now();
  end if;

  insert into public.movements
    (team_id, kind, product_id, from_location_id, to_location_id, qty, note, created_by, actor_name)
  values
    (v_team, p_kind, p_product_id, p_from, p_to, p_qty, nullif(trim(p_note), ''), auth.uid(), public.actor_name())
  returning * into v_row;

  return v_row;
end $$;

create or replace function public.record_adjustment(
  p_product_id  uuid,
  p_location_id uuid,
  p_new_qty     numeric,
  p_note        text default null
) returns public.movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team  uuid := public.my_team();
  v_old   numeric;
  v_delta numeric;
  v_row   public.movements;
begin
  if not public.has_role('owner', 'oversee') or v_team is null then
    raise exception 'Only Team Leader and Oversee can adjust stock';
  end if;
  if p_new_qty is null or p_new_qty < 0 then
    raise exception 'Counted quantity cannot be negative';
  end if;
  if not exists (select 1 from public.products where id = p_product_id and team_id = v_team)
     or not exists (select 1 from public.locations where id = p_location_id and team_id = v_team) then
    raise exception 'Product or location not found';
  end if;

  select qty into v_old from public.stock_levels
   where product_id = p_product_id and location_id = p_location_id
   for update;
  v_old := coalesce(v_old, 0);
  v_delta := p_new_qty - v_old;
  if v_delta = 0 then
    raise exception 'Stock is already %', v_old;
  end if;

  insert into public.stock_levels (team_id, product_id, location_id, qty)
  values (v_team, p_product_id, p_location_id, p_new_qty)
  on conflict (product_id, location_id)
  do update set qty = excluded.qty, updated_at = now();

  insert into public.movements
    (team_id, kind, product_id, from_location_id, to_location_id, qty, qty_before, qty_after, note, created_by, actor_name)
  values (
    v_team, 'ADJUST', p_product_id,
    case when v_delta < 0 then p_location_id end,
    case when v_delta > 0 then p_location_id end,
    abs(v_delta), v_old, p_new_qty, nullif(trim(p_note), ''), auth.uid(), public.actor_name()
  )
  returning * into v_row;

  return v_row;
end $$;

-- Team list now also shows the Username.
create or replace view public.team_presence
with (security_invoker = true) as
select
  p.id,
  p.user_code,
  p.display_name,
  p.role,
  p.is_active,
  p.can_transfer,
  p.last_seen_at,
  (p.is_active and p.is_online and p.last_seen_at > now() - interval '2 minutes') as online,
  p.created_at,
  p.username
from public.profiles p
where p.role is not null;
