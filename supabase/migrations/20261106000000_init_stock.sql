-- Stock-Overseee: multi-location stock (WRH, TOKO, ...)
-- Stock can only change through record_movement(), so every change is logged.

-- Locations ("place holders") -------------------------------------------------
create table public.locations (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Z0-9_-]{1,12}$'),
  name        text not null check (length(trim(name)) > 0),
  kind        text not null default 'store' check (kind in ('warehouse', 'store', 'other')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

insert into public.locations (code, name, kind) values
  ('WRH',  'Warehouse', 'warehouse'),
  ('TOKO', 'Toko',      'store');

-- Products ---------------------------------------------------------------------
create table public.products (
  id          uuid primary key default gen_random_uuid(),
  barcode     text not null unique check (length(trim(barcode)) > 0),
  name        text not null check (length(trim(name)) > 0),
  unit        text not null default 'pcs',
  min_stock   numeric(14,3) not null default 0 check (min_stock >= 0),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();

-- Current stock per product per location ---------------------------------------
create table public.stock_levels (
  product_id  uuid not null references public.products(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  qty         numeric(14,3) not null default 0 check (qty >= 0),
  updated_at  timestamptz not null default now(),
  primary key (product_id, location_id)
);
create index stock_levels_location_idx on public.stock_levels(location_id);

-- Movement log -----------------------------------------------------------------
create table public.movements (
  id                bigint generated always as identity primary key,
  kind              text not null check (kind in ('IN', 'OUT', 'TRANSFER')),
  product_id        uuid not null references public.products(id) on delete restrict,
  from_location_id  uuid references public.locations(id) on delete restrict,
  to_location_id    uuid references public.locations(id) on delete restrict,
  qty               numeric(14,3) not null check (qty > 0),
  note              text,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint movements_shape check (
    (kind = 'IN'       and from_location_id is null     and to_location_id is not null) or
    (kind = 'OUT'      and from_location_id is not null and to_location_id is null) or
    (kind = 'TRANSFER' and from_location_id is not null and to_location_id is not null
                       and from_location_id <> to_location_id)
  )
);
create index movements_created_idx on public.movements(created_at desc);
create index movements_product_idx on public.movements(product_id);
create index movements_from_idx    on public.movements(from_location_id);
create index movements_to_idx      on public.movements(to_location_id);
create index movements_user_idx    on public.movements(created_by);

-- Row level security: signed-in staff only ------------------------------------
alter table public.locations    enable row level security;
alter table public.products     enable row level security;
alter table public.stock_levels enable row level security;
alter table public.movements    enable row level security;

create policy "staff read locations"   on public.locations for select to authenticated using (true);
create policy "staff add locations"    on public.locations for insert to authenticated with check (true);
create policy "staff edit locations"   on public.locations for update to authenticated using (true) with check (true);

create policy "staff read products"    on public.products for select to authenticated using (true);
create policy "staff add products"     on public.products for insert to authenticated with check (true);
create policy "staff edit products"    on public.products for update to authenticated using (true) with check (true);

-- stock_levels and movements are read-only for clients; writes go through record_movement().
create policy "staff read stock"       on public.stock_levels for select to authenticated using (true);
create policy "staff read movements"   on public.movements    for select to authenticated using (true);

-- Record a stock movement atomically -------------------------------------------
create function public.record_movement(
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
  v_left numeric;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'Quantity must be more than 0';
  end if;
  if p_kind not in ('IN', 'OUT', 'TRANSFER') then
    raise exception 'Unknown movement type %', p_kind;
  end if;

  -- Normalise which side is used for each kind.
  if p_kind = 'IN' then p_from := null; end if;
  if p_kind = 'OUT' then p_to := null; end if;

  -- Take stock out of the source location.
  if p_from is not null then
    update public.stock_levels
       set qty = qty - p_qty, updated_at = now()
     where product_id = p_product_id and location_id = p_from and qty >= p_qty
    returning qty into v_left;

    if not found then
      raise exception 'Not enough stock at source location';
    end if;
  end if;

  -- Put stock into the destination location.
  if p_to is not null then
    insert into public.stock_levels (product_id, location_id, qty)
    values (p_product_id, p_to, p_qty)
    on conflict (product_id, location_id)
    do update set qty = public.stock_levels.qty + excluded.qty, updated_at = now();
  end if;

  insert into public.movements (kind, product_id, from_location_id, to_location_id, qty, note, created_by)
  values (p_kind, p_product_id, p_from, p_to, p_qty, nullif(trim(p_note), ''), auth.uid())
  returning * into v_row;

  return v_row;
end $$;

revoke execute on function public.record_movement(text, uuid, numeric, uuid, uuid, text) from public, anon;
grant  execute on function public.record_movement(text, uuid, numeric, uuid, uuid, text) to authenticated;

-- Stock overview: every active product x every active location -----------------
create view public.stock_overview
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
where p.is_active and l.is_active;

-- Movement history with readable names ---------------------------------------
create view public.movement_history
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
  lt.code       as to_code
from public.movements m
join public.products p        on p.id = m.product_id
left join public.locations lf on lf.id = m.from_location_id
left join public.locations lt on lt.id = m.to_location_id;
