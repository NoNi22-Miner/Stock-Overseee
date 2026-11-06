-- 1) Members tied to locations
-- 2) Transfers go "in transit" and are received (fully or short) at the destination
-- 3) In-app notifications for each location's responsible people
--
-- Written without DROP statements: new tables/columns, ALTER POLICY, CREATE OR REPLACE.

-- 1. Location access ------------------------------------------------------------------
alter table public.profiles
  add column all_locations  boolean not null default true,   -- false = only member_locations
  add column notify_changes boolean not null default true;   -- notify on every stock change

create table public.member_locations (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  team_id     uuid not null references public.teams(id) on delete cascade,
  primary key (profile_id, location_id)
);
create index member_locations_location_idx on public.member_locations (location_id);
alter table public.member_locations enable row level security;

create function public.can_access_location(p_location uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    join public.locations l on l.id = p_location and l.team_id = p.team_id
    where p.id = auth.uid() and p.is_active and p.role is not null
      and (p.role = 'owner' or p.all_locations
           or exists (select 1 from public.member_locations ml
                      where ml.profile_id = p.id and ml.location_id = p_location))
  )
$$;
revoke execute on function public.can_access_location(uuid) from public, anon;
grant  execute on function public.can_access_location(uuid) to authenticated;

-- Locations the caller may use (all team locations stay visible for picking a transfer target).
create function public.my_location_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select l.id from public.locations l
  where l.team_id = public.my_team() and public.can_access_location(l.id)
$$;
revoke execute on function public.my_location_ids() from public, anon;
grant  execute on function public.my_location_ids() to authenticated;

create policy "read member locations" on public.member_locations for select to authenticated
  using (
    team_id = (select public.my_team())
    and (profile_id = (select auth.uid()) or (select public.has_role('owner', 'oversee')))
  );

alter policy "team reads stock" on public.stock_levels
  using (team_id = (select public.my_team()) and public.can_access_location(location_id));

-- Stock overview only lists locations the caller may use.
create or replace view public.stock_overview
with (security_invoker = true) as
select
  p.id          as product_id,
  p.barcode,
  p.name        as product_name,
  p.unit,
  p.min_stock,
  l.id          as location_id,
  l.code        as location_code,
  l.name        as location_name,
  coalesce(s.qty, 0)                                   as qty,
  (p.min_stock > 0 and coalesce(s.qty, 0) <= p.min_stock) as is_low
from public.products p
cross join public.locations l
left join public.stock_levels s
  on s.product_id = p.id and s.location_id = l.id
where p.is_active and l.is_active and public.can_access_location(l.id);

-- 2. Transfers in transit ------------------------------------------------------------
create table public.transfers (
  id                uuid primary key default gen_random_uuid(),
  team_id           uuid not null references public.teams(id) on delete cascade,
  product_id        uuid not null references public.products(id),
  from_location_id  uuid not null references public.locations(id),
  to_location_id    uuid not null references public.locations(id),
  qty_sent          numeric(14,3) not null check (qty_sent > 0),
  qty_received      numeric(14,3),                       -- null while in transit
  qty_returned      numeric(14,3) not null default 0,    -- missing, sent back to the source
  qty_late          numeric(14,3) not null default 0,    -- missing, arrived later at the destination
  qty_lost          numeric(14,3) not null default 0,    -- missing, written off
  status            text not null default 'in_transit' check (status in ('in_transit', 'short', 'done')),
  note              text,
  receive_note      text,
  sent_by           uuid references auth.users(id) on delete set null,
  sent_by_name      text,
  sent_at           timestamptz not null default now(),
  received_by_name  text,
  received_at       timestamptz,
  resolved_by_name  text,
  resolved_at       timestamptz,
  constraint transfers_locations check (from_location_id <> to_location_id),
  constraint transfers_received check (qty_received is null or (qty_received >= 0 and qty_received <= qty_sent)),
  constraint transfers_missing check (
    qty_returned >= 0 and qty_late >= 0 and qty_lost >= 0
    and qty_returned + qty_late + qty_lost <= qty_sent - coalesce(qty_received, 0)
  )
);
create index transfers_team_status_idx on public.transfers (team_id, status, sent_at desc);
create index transfers_to_idx on public.transfers (to_location_id, status);
create index transfers_from_idx on public.transfers (from_location_id, status);
create index transfers_product_idx on public.transfers (product_id);
alter table public.transfers enable row level security;

create policy "team reads transfers" on public.transfers for select to authenticated
  using (
    team_id = (select public.my_team())
    and (public.can_access_location(from_location_id) or public.can_access_location(to_location_id))
  );

-- Movements: link to a transfer, and what an incoming transfer movement was.
alter table public.movements
  add column transfer_id uuid references public.transfers(id),
  add column detail text check (detail in ('receive', 'return', 'late'));
create index movements_transfer_idx on public.movements (transfer_id);

alter policy "team reads movements" on public.movements
  using (
    team_id = (select public.my_team())
    and (public.can_access_location(from_location_id) or public.can_access_location(to_location_id))
  );

-- 3. Notifications -----------------------------------------------------------------------
create table public.notifications (
  id          bigint generated always as identity primary key,
  team_id     uuid not null references public.teams(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null check (kind in
                ('transfer_incoming', 'transfer_received', 'transfer_short', 'transfer_resolved',
                 'stock_change', 'low_stock')),
  title       text not null,
  body        text not null,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;
alter table public.notifications enable row level security;

create policy "read own notifications" on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));

create function public.mark_notifications_read(p_ids bigint[] default null) returns void
language sql security definer set search_path = '' as $$
  update public.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
$$;
revoke execute on function public.mark_notifications_read(bigint[]) from public, anon;
grant  execute on function public.mark_notifications_read(bigint[]) to authenticated;

-- People responsible for a location: the Team Leader + members with access to it.
create schema if not exists private;
create function private.location_people(p_team uuid, p_location uuid, p_changes_only boolean default false)
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p
  where p.team_id = p_team and p.is_active and p.role is not null
    and (not p_changes_only or p.notify_changes)
    and (p.role = 'owner' or p.all_locations
         or exists (select 1 from public.member_locations ml
                    where ml.profile_id = p.id and ml.location_id = p_location))
$$;

-- Send one notification to each recipient, never to the person who caused it.
create function private.notify(
  p_team uuid, p_users uuid[], p_kind text, p_title text, p_body text, p_data jsonb default '{}'::jsonb
) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (team_id, user_id, kind, title, body, data)
  select p_team, u, p_kind, p_title, p_body, coalesce(p_data, '{}'::jsonb)
  from (select distinct unnest(p_users) as u) x
  where u is not null and u is distinct from auth.uid();
$$;

create function private.qty_text(p_qty numeric, p_unit text) returns text
language sql immutable set search_path = '' as $$
  select trim(trailing '.' from trim(trailing '0' from to_char(p_qty, 'FM999999999990.999'))) || ' ' || p_unit
$$;

-- Low stock: notify when a product at a location drops to or below its minimum.
create function private.low_stock_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_min  numeric;
  v_name text;
  v_unit text;
  v_loc  text;
begin
  select min_stock, name, unit into v_min, v_name, v_unit from public.products where id = new.product_id;
  if v_min > 0 and new.qty <= v_min and (tg_op = 'INSERT' or old.qty > v_min) then
    select code into v_loc from public.locations where id = new.location_id;
    perform private.notify(
      new.team_id,
      array(select private.location_people(new.team_id, new.location_id)),
      'low_stock',
      'Low stock at ' || v_loc,
      v_name || ': ' || private.qty_text(new.qty, v_unit) || ' left (minimum ' || private.qty_text(v_min, v_unit) || ')',
      jsonb_build_object('product_id', new.product_id, 'location_id', new.location_id)
    );
  end if;
  return new;
end $$;

create trigger stock_levels_low_stock
  after insert or update of qty on public.stock_levels
  for each row execute function private.low_stock_check();

-- Stock functions -------------------------------------------------------------------------
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
  v_team     uuid := public.my_team();
  v_actor    text := public.actor_name();
  v_row      public.movements;
  v_transfer uuid;
  v_name     text;
  v_unit     text;
  v_from     text;
  v_to       text;
  v_loc      uuid;
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
  if p_kind = 'TRANSFER' and (p_from is null or p_to is null or p_from = p_to) then
    raise exception 'Pick two different locations';
  end if;

  select name, unit into v_name, v_unit from public.products where id = p_product_id and team_id = v_team;
  if v_name is null then
    raise exception 'Product not found';
  end if;
  if (p_from is not null and not exists (select 1 from public.locations where id = p_from and team_id = v_team))
     or (p_to is not null and not exists (select 1 from public.locations where id = p_to and team_id = v_team)) then
    raise exception 'Location not found';
  end if;

  -- In needs the destination; Out and Transfer need the source.
  if (p_kind = 'IN' and not public.can_access_location(p_to))
     or (p_kind in ('OUT', 'TRANSFER') and not public.can_access_location(p_from)) then
    raise exception 'You do not have access to this location';
  end if;

  if p_from is not null then
    update public.stock_levels
       set qty = qty - p_qty, updated_at = now()
     where product_id = p_product_id and location_id = p_from and qty >= p_qty;
    if not found then
      raise exception 'Not enough stock at source location';
    end if;
  end if;

  if p_kind = 'IN' then
    insert into public.stock_levels (team_id, product_id, location_id, qty)
    values (v_team, p_product_id, p_to, p_qty)
    on conflict (product_id, location_id)
    do update set qty = public.stock_levels.qty + excluded.qty, updated_at = now();
  end if;

  -- A transfer leaves the source now and waits "in transit" until the destination receives it.
  if p_kind = 'TRANSFER' then
    insert into public.transfers
      (team_id, product_id, from_location_id, to_location_id, qty_sent, note, sent_by, sent_by_name)
    values (v_team, p_product_id, p_from, p_to, p_qty, nullif(trim(p_note), ''), auth.uid(), v_actor)
    returning id into v_transfer;
  end if;

  insert into public.movements
    (team_id, kind, product_id, from_location_id, to_location_id, qty, note, created_by, actor_name, transfer_id)
  values
    (v_team, p_kind, p_product_id, p_from, p_to, p_qty, nullif(trim(p_note), ''), auth.uid(), v_actor, v_transfer)
  returning * into v_row;

  -- Notifications
  select code into v_from from public.locations where id = p_from;
  select code into v_to from public.locations where id = p_to;
  if p_kind = 'TRANSFER' then
    perform private.notify(
      v_team, array(select private.location_people(v_team, p_to)), 'transfer_incoming',
      'Incoming to ' || v_to,
      private.qty_text(p_qty, v_unit) || ' ' || v_name || ' sent from ' || v_from || ' by ' || v_actor || '. Please receive it.',
      jsonb_build_object('transfer_id', v_transfer, 'product_id', p_product_id, 'location_id', p_to)
    );
  end if;
  v_loc := coalesce(p_from, p_to);
  perform private.notify(
    v_team, array(select private.location_people(v_team, v_loc, true)), 'stock_change',
    case p_kind when 'IN' then 'Stock in at ' || v_to
                when 'OUT' then 'Stock out at ' || v_from
                else 'Sent from ' || v_from || ' to ' || v_to end,
    v_actor || ': ' || case p_kind when 'IN' then '+' else '−' end || private.qty_text(p_qty, v_unit) || ' ' || v_name,
    jsonb_build_object('movement_id', v_row.id, 'product_id', p_product_id, 'location_id', v_loc)
  );

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
  v_actor text := public.actor_name();
  v_old   numeric;
  v_delta numeric;
  v_row   public.movements;
  v_name  text;
  v_unit  text;
  v_loc   text;
begin
  if not public.has_role('owner', 'oversee') or v_team is null then
    raise exception 'Only Team Leader and Oversee can adjust stock';
  end if;
  if p_new_qty is null or p_new_qty < 0 then
    raise exception 'Counted quantity cannot be negative';
  end if;
  select name, unit into v_name, v_unit from public.products where id = p_product_id and team_id = v_team;
  select code into v_loc from public.locations where id = p_location_id and team_id = v_team;
  if v_name is null or v_loc is null then
    raise exception 'Product or location not found';
  end if;
  if not public.can_access_location(p_location_id) then
    raise exception 'You do not have access to this location';
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
    abs(v_delta), v_old, p_new_qty, nullif(trim(p_note), ''), auth.uid(), v_actor
  )
  returning * into v_row;

  perform private.notify(
    v_team, array(select private.location_people(v_team, p_location_id, true)), 'stock_change',
    'Stock count at ' || v_loc,
    v_actor || ': ' || v_name || ' ' || private.qty_text(v_old, v_unit) || ' → ' || private.qty_text(p_new_qty, v_unit),
    jsonb_build_object('movement_id', v_row.id, 'product_id', p_product_id, 'location_id', p_location_id)
  );

  return v_row;
end $$;

-- Receive a transfer at its destination: all of it, or fewer (the rest stays open as "short").
create function public.receive_transfer(p_transfer_id uuid, p_qty_received numeric, p_note text default null)
returns public.transfers
language plpgsql security definer set search_path = '' as $$
declare
  v_team  uuid := public.my_team();
  v_actor text := public.actor_name();
  t       public.transfers;
  v_name  text;
  v_unit  text;
  v_from  text;
  v_to    text;
  v_short numeric;
begin
  if not public.has_role('owner', 'oversee', 'staff') or v_team is null then
    raise exception 'Your account is not allowed to receive stock';
  end if;
  select * into t from public.transfers where id = p_transfer_id and team_id = v_team for update;
  if t.id is null then
    raise exception 'Transfer not found';
  end if;
  if t.status <> 'in_transit' then
    raise exception 'This transfer was already received';
  end if;
  if not public.can_access_location(t.to_location_id) then
    raise exception 'You do not have access to the destination location';
  end if;
  if p_qty_received is null or p_qty_received < 0 or p_qty_received > t.qty_sent then
    raise exception 'Received quantity must be between 0 and %', t.qty_sent;
  end if;

  v_short := t.qty_sent - p_qty_received;
  update public.transfers
     set qty_received = p_qty_received,
         status = case when v_short = 0 then 'done' else 'short' end,
         receive_note = nullif(trim(p_note), ''),
         received_by_name = v_actor,
         received_at = now()
   where id = t.id
  returning * into t;

  if p_qty_received > 0 then
    insert into public.stock_levels (team_id, product_id, location_id, qty)
    values (v_team, t.product_id, t.to_location_id, p_qty_received)
    on conflict (product_id, location_id)
    do update set qty = public.stock_levels.qty + excluded.qty, updated_at = now();
    insert into public.movements
      (team_id, kind, product_id, to_location_id, qty, note, created_by, actor_name, transfer_id, detail)
    values
      (v_team, 'IN', t.product_id, t.to_location_id, p_qty_received, nullif(trim(p_note), ''), auth.uid(), v_actor, t.id, 'receive');
  end if;

  select name, unit into v_name, v_unit from public.products where id = t.product_id;
  select code into v_from from public.locations where id = t.from_location_id;
  select code into v_to from public.locations where id = t.to_location_id;

  -- Tell the sender's side whether everything arrived.
  perform private.notify(
    v_team,
    array(select private.location_people(v_team, t.from_location_id)) || t.sent_by,
    case when v_short = 0 then 'transfer_received' else 'transfer_short' end,
    case when v_short = 0 then v_to || ' received everything'
         else v_to || ' is short ' || private.qty_text(v_short, v_unit) end,
    case when v_short = 0
         then private.qty_text(t.qty_sent, v_unit) || ' ' || v_name || ' from ' || v_from || ' fully received by ' || v_actor || '.'
         else private.qty_text(p_qty_received, v_unit) || ' of ' || private.qty_text(t.qty_sent, v_unit) || ' ' || v_name
              || ' arrived (received by ' || v_actor || '). ' || private.qty_text(v_short, v_unit) || ' missing.' end,
    jsonb_build_object('transfer_id', t.id, 'product_id', t.product_id, 'location_id', t.from_location_id)
  );
  perform private.notify(
    v_team, array(select private.location_people(v_team, t.to_location_id, true)), 'stock_change',
    'Received at ' || v_to,
    v_actor || ': +' || private.qty_text(p_qty_received, v_unit) || ' ' || v_name || ' from ' || v_from,
    jsonb_build_object('transfer_id', t.id, 'product_id', t.product_id, 'location_id', t.to_location_id)
  );

  return t;
end $$;
revoke execute on function public.receive_transfer(uuid, numeric, text) from public, anon;
grant  execute on function public.receive_transfer(uuid, numeric, text) to authenticated;

-- Settle missing items of a short transfer: returned to the source, arrived late, or lost.
create function public.resolve_transfer(p_transfer_id uuid, p_outcome text, p_qty numeric, p_note text default null)
returns public.transfers
language plpgsql security definer set search_path = '' as $$
declare
  v_team  uuid := public.my_team();
  v_actor text := public.actor_name();
  t       public.transfers;
  v_open  numeric;
  v_name  text;
  v_unit  text;
  v_from  text;
  v_to    text;
  v_loc   uuid;
  v_what  text;
begin
  if v_team is null then
    raise exception 'Not signed in';
  end if;
  select * into t from public.transfers where id = p_transfer_id and team_id = v_team for update;
  if t.id is null then
    raise exception 'Transfer not found';
  end if;
  if t.status <> 'short' then
    raise exception 'Only short transfers can be resolved';
  end if;
  -- The sender, or Team Leader / Oversee with access to either location.
  if not (t.sent_by = auth.uid() and public.has_role('owner', 'oversee', 'staff'))
     and not (public.has_role('owner', 'oversee')
              and (public.can_access_location(t.from_location_id) or public.can_access_location(t.to_location_id))) then
    raise exception 'You are not allowed to resolve this transfer';
  end if;
  if p_outcome not in ('returned', 'late', 'lost') then
    raise exception 'Unknown outcome %', p_outcome;
  end if;

  v_open := t.qty_sent - coalesce(t.qty_received, 0) - t.qty_returned - t.qty_late - t.qty_lost;
  if p_qty is null or p_qty <= 0 or p_qty > v_open then
    raise exception 'Quantity must be between 0 and %', v_open;
  end if;

  update public.transfers
     set qty_returned = qty_returned + case when p_outcome = 'returned' then p_qty else 0 end,
         qty_late     = qty_late     + case when p_outcome = 'late'     then p_qty else 0 end,
         qty_lost     = qty_lost     + case when p_outcome = 'lost'     then p_qty else 0 end,
         status = case when p_qty = v_open then 'done' else 'short' end,
         resolved_by_name = v_actor,
         resolved_at = now()
   where id = t.id
  returning * into t;

  if p_outcome in ('returned', 'late') then
    v_loc := case when p_outcome = 'returned' then t.from_location_id else t.to_location_id end;
    insert into public.stock_levels (team_id, product_id, location_id, qty)
    values (v_team, t.product_id, v_loc, p_qty)
    on conflict (product_id, location_id)
    do update set qty = public.stock_levels.qty + excluded.qty, updated_at = now();
    insert into public.movements
      (team_id, kind, product_id, to_location_id, qty, note, created_by, actor_name, transfer_id, detail)
    values
      (v_team, 'IN', t.product_id, v_loc, p_qty, nullif(trim(p_note), ''), auth.uid(), v_actor, t.id,
       case when p_outcome = 'returned' then 'return' else 'late' end);
  end if;

  select name, unit into v_name, v_unit from public.products where id = t.product_id;
  select code into v_from from public.locations where id = t.from_location_id;
  select code into v_to from public.locations where id = t.to_location_id;
  v_what := case p_outcome when 'returned' then 'returned to ' || v_from
                           when 'late' then 'arrived late at ' || v_to
                           else 'marked lost' end;
  perform private.notify(
    v_team,
    array(select private.location_people(v_team, t.from_location_id))
      || array(select private.location_people(v_team, t.to_location_id)) || t.sent_by,
    'transfer_resolved',
    'Missing items ' || v_what,
    private.qty_text(p_qty, v_unit) || ' ' || v_name || ' (' || v_from || ' → ' || v_to || ') ' || v_what || ' by ' || v_actor
      || case when t.status = 'done' then '. Transfer closed.' else '.' end,
    jsonb_build_object('transfer_id', t.id, 'product_id', t.product_id)
  );

  return t;
end $$;
revoke execute on function public.resolve_transfer(uuid, text, numeric, text) from public, anon;
grant  execute on function public.resolve_transfer(uuid, text, numeric, text) to authenticated;

-- Transfers with readable names, for the Transfers screen.
create view public.transfer_list
with (security_invoker = true) as
select
  t.*,
  p.name  as product_name,
  p.unit,
  p.barcode,
  lf.code as from_code,
  lt.code as to_code,
  t.qty_sent - coalesce(t.qty_received, 0) - t.qty_returned - t.qty_late - t.qty_lost as qty_open
from public.transfers t
join public.products p   on p.id = t.product_id
join public.locations lf on lf.id = t.from_location_id
join public.locations lt on lt.id = t.to_location_id;

-- History view: also expose the transfer link and what an incoming movement was.
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
  m.actor_name,
  m.transfer_id,
  m.detail
from public.movements m
join public.products p        on p.id = m.product_id
left join public.locations lf on lf.id = m.from_location_id
left join public.locations lt on lt.id = m.to_location_id;

-- Team list: also show location access.
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
  p.username,
  p.all_locations,
  array(select ml.location_id from public.member_locations ml where ml.profile_id = p.id) as location_ids
from public.profiles p
where p.role is not null;

-- Home dashboard: a transfer counts once (when sent); receiving / returning it is not new movement.
create or replace function public.movement_daily(p_from timestamptz, p_to timestamptz, p_tz text default 'UTC')
returns table (
  product_id   uuid,
  day          date,
  in_qty       numeric,
  out_qty      numeric,
  transfer_qty numeric,
  moves        bigint
)
language sql stable security invoker set search_path = '' as $$
  select
    m.product_id,
    (m.created_at at time zone p_tz)::date as day,
    coalesce(sum(m.qty) filter (where m.kind = 'IN'), 0),
    coalesce(sum(m.qty) filter (where m.kind = 'OUT'), 0),
    coalesce(sum(m.qty) filter (where m.kind = 'TRANSFER'), 0),
    count(*)
  from public.movements m
  where m.created_at >= p_from
    and m.created_at < p_to
    and m.kind <> 'ADJUST'
    and m.detail is null
  group by 1, 2
  order by 2
$$;
