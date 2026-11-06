-- Accounts & roles
--   owner    : signs in with email, manages accounts, full access
--   oversee  : sees who is online, adjusts stock, stock in/out/transfer, manages products & locations
--   staff    : stock in/out; transfer only when can_transfer is on
--   onlooker : read only
-- Accounts other than the owner are created by the owner (Edge Function "manage-users")
-- and sign in with a User ID.

create type public.app_role as enum ('owner', 'oversee', 'staff', 'onlooker');

create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  user_code     text unique check (user_code ~ '^[a-z0-9._-]{3,32}$'),
  display_name  text not null default '',
  role          public.app_role,            -- null = no access
  is_active     boolean not null default true,
  can_transfer  boolean not null default true,  -- only matters for staff
  is_online     boolean not null default false,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now()
);

-- At most one owner.
create unique index profiles_single_owner on public.profiles (role) where role = 'owner';

alter table public.profiles enable row level security;

-- Every auth user gets a profile with no role; the owner grants roles.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (id) select id from auth.users on conflict (id) do nothing;

-- Bootstrap: the earliest confirmed account becomes the owner if there is none yet.
update public.profiles set role = 'owner', display_name = 'Owner'
where id = (select id from auth.users where email_confirmed_at is not null order by created_at limit 1)
  and not exists (select 1 from public.profiles where role = 'owner');

-- Role helpers ------------------------------------------------------------------
create function public.my_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create function public.has_role(variadic roles public.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role() = any (roles), false)
$$;

revoke execute on function public.my_role() from public, anon;
revoke execute on function public.has_role(public.app_role[]) from public, anon;
grant  execute on function public.my_role() to authenticated;
grant  execute on function public.has_role(public.app_role[]) to authenticated;

-- Policies ------------------------------------------------------------------------
drop policy "staff read locations"  on public.locations;
drop policy "staff add locations"   on public.locations;
drop policy "staff edit locations"  on public.locations;
drop policy "staff read products"   on public.products;
drop policy "staff add products"    on public.products;
drop policy "staff edit products"   on public.products;
drop policy "staff read stock"      on public.stock_levels;
drop policy "staff read movements"  on public.movements;

create policy "members read locations" on public.locations for select to authenticated
  using ((select public.my_role()) is not null);
create policy "managers add locations" on public.locations for insert to authenticated
  with check ((select public.has_role('owner', 'oversee')));
create policy "managers edit locations" on public.locations for update to authenticated
  using ((select public.has_role('owner', 'oversee')))
  with check ((select public.has_role('owner', 'oversee')));

create policy "members read products" on public.products for select to authenticated
  using ((select public.my_role()) is not null);
create policy "managers add products" on public.products for insert to authenticated
  with check ((select public.has_role('owner', 'oversee')));
create policy "managers edit products" on public.products for update to authenticated
  using ((select public.has_role('owner', 'oversee')))
  with check ((select public.has_role('owner', 'oversee')));

create policy "members read stock" on public.stock_levels for select to authenticated
  using ((select public.my_role()) is not null);
create policy "members read movements" on public.movements for select to authenticated
  using ((select public.my_role()) is not null);

-- Own profile always; owner & oversee see everyone (for the online list).
create policy "read profiles" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.has_role('owner', 'oversee')));

-- Movements: add ADJUST (stock count correction) and who did it ---------------
alter table public.movements drop constraint movements_kind_check;
alter table public.movements add constraint movements_kind_check
  check (kind in ('IN', 'OUT', 'TRANSFER', 'ADJUST'));

alter table public.movements drop constraint movements_shape;
alter table public.movements add constraint movements_shape check (
  (kind = 'IN'       and from_location_id is null     and to_location_id is not null) or
  (kind = 'OUT'      and from_location_id is not null and to_location_id is null) or
  (kind = 'TRANSFER' and from_location_id is not null and to_location_id is not null
                     and from_location_id <> to_location_id) or
  (kind = 'ADJUST'   and (from_location_id is null) <> (to_location_id is null))
);

alter table public.movements
  add column qty_before numeric(14,3),
  add column qty_after  numeric(14,3),
  add column actor_name text;

create function public.actor_name() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(display_name, ''), user_code, 'Owner')
  from public.profiles where id = auth.uid()
$$;
revoke execute on function public.actor_name() from public, anon, authenticated;

-- In / Out / Transfer: owner, oversee, staff ------------------------------------
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
  v_row public.movements;
begin
  if not public.has_role('owner', 'oversee', 'staff') then
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

  if p_from is not null then
    update public.stock_levels
       set qty = qty - p_qty, updated_at = now()
     where product_id = p_product_id and location_id = p_from and qty >= p_qty;
    if not found then
      raise exception 'Not enough stock at source location';
    end if;
  end if;

  if p_to is not null then
    insert into public.stock_levels (product_id, location_id, qty)
    values (p_product_id, p_to, p_qty)
    on conflict (product_id, location_id)
    do update set qty = public.stock_levels.qty + excluded.qty, updated_at = now();
  end if;

  insert into public.movements (kind, product_id, from_location_id, to_location_id, qty, note, created_by, actor_name)
  values (p_kind, p_product_id, p_from, p_to, p_qty, nullif(trim(p_note), ''), auth.uid(), public.actor_name())
  returning * into v_row;

  return v_row;
end $$;

-- Adjust (set counted quantity): owner, oversee ---------------------------------
create function public.record_adjustment(
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
  v_old   numeric;
  v_delta numeric;
  v_row   public.movements;
begin
  if not public.has_role('owner', 'oversee') then
    raise exception 'Only Owner and Oversee can adjust stock';
  end if;
  if p_new_qty is null or p_new_qty < 0 then
    raise exception 'Counted quantity cannot be negative';
  end if;

  select qty into v_old from public.stock_levels
   where product_id = p_product_id and location_id = p_location_id
   for update;
  v_old := coalesce(v_old, 0);
  v_delta := p_new_qty - v_old;
  if v_delta = 0 then
    raise exception 'Stock is already %', v_old;
  end if;

  insert into public.stock_levels (product_id, location_id, qty)
  values (p_product_id, p_location_id, p_new_qty)
  on conflict (product_id, location_id)
  do update set qty = excluded.qty, updated_at = now();

  insert into public.movements
    (kind, product_id, from_location_id, to_location_id, qty, qty_before, qty_after, note, created_by, actor_name)
  values (
    'ADJUST', p_product_id,
    case when v_delta < 0 then p_location_id end,
    case when v_delta > 0 then p_location_id end,
    abs(v_delta), v_old, p_new_qty, nullif(trim(p_note), ''), auth.uid(), public.actor_name()
  )
  returning * into v_row;

  return v_row;
end $$;

revoke execute on function public.record_adjustment(uuid, uuid, numeric, text) from public, anon;
grant  execute on function public.record_adjustment(uuid, uuid, numeric, text) to authenticated;

-- Presence heartbeat --------------------------------------------------------------
create function public.touch_presence(p_online boolean default true) returns void
language sql security definer set search_path = '' as $$
  update public.profiles
     set is_online = p_online, last_seen_at = now()
   where id = auth.uid() and role is not null and is_active;
$$;
revoke execute on function public.touch_presence(boolean) from public, anon;
grant  execute on function public.touch_presence(boolean) to authenticated;

-- Team list with online status (computed on the server clock).
create view public.team_presence
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
  p.created_at
from public.profiles p
where p.role is not null;

-- History view with ADJUST details and who did it.
create or replace view public.movement_history
with (security_invoker = true) as
select
  m.id,
  m.kind,
  m.qty,
  m.note,
  m.created_at,
  m.created_by,
  m.product_id,
  p.name        as product_name,
  p.barcode,
  p.unit,
  m.from_location_id,
  lf.code       as from_code,
  m.to_location_id,
  lt.code       as to_code,
  m.qty_before,
  m.qty_after,
  m.actor_name
from public.movements m
join public.products p        on p.id = m.product_id
left join public.locations lf on lf.id = m.from_location_id
left join public.locations lt on lt.id = m.to_location_id;
