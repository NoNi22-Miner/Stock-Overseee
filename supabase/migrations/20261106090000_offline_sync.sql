-- Offline scanning: In / Out / Transfer made without internet are queued on the phone and sent
-- later with a client-generated id, so a retry can never be counted twice.
alter table public.movements add column scanned_at timestamptz;   -- when it happened on the phone

create table public.sync_receipts (
  client_id   uuid primary key,
  team_id     uuid not null references public.teams(id) on delete cascade,
  movement_id bigint references public.movements(id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table public.sync_receipts enable row level security;   -- no policies: only the function below

create function public.record_movement_sync(
  p_client_id   uuid,
  p_scanned_at  timestamptz,
  p_kind        text,
  p_product_id  uuid,
  p_qty         numeric,
  p_from        uuid default null,
  p_to          uuid default null,
  p_note        text default null
) returns public.movements
language plpgsql security definer set search_path = '' as $$
declare
  v_row      public.movements;
  v_existing bigint;
begin
  if p_client_id is null then
    raise exception 'Missing client id';
  end if;
  -- One sync of the same scan at a time; a repeat returns the movement already recorded.
  perform pg_advisory_xact_lock(hashtextextended(p_client_id::text, 0));
  select movement_id into v_existing from public.sync_receipts where client_id = p_client_id;
  if v_existing is not null then
    select * into v_row from public.movements where id = v_existing;
    return v_row;
  end if;

  v_row := public.record_movement(p_kind, p_product_id, p_qty, p_from, p_to, p_note);

  update public.movements
     set scanned_at = least(coalesce(p_scanned_at, now()), now())
   where id = v_row.id
  returning * into v_row;
  insert into public.sync_receipts (client_id, team_id, movement_id) values (p_client_id, v_row.team_id, v_row.id);
  return v_row;
end $$;
revoke execute on function public.record_movement_sync(uuid, timestamptz, text, uuid, numeric, uuid, uuid, text) from public, anon;
grant  execute on function public.record_movement_sync(uuid, timestamptz, text, uuid, numeric, uuid, uuid, text) to authenticated;

-- History shows the scan time; the dashboard counts a movement on the day it was scanned.
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
  m.detail,
  m.scanned_at
from public.movements m
join public.products p        on p.id = m.product_id
left join public.locations lf on lf.id = m.from_location_id
left join public.locations lt on lt.id = m.to_location_id;

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
    (coalesce(m.scanned_at, m.created_at) at time zone p_tz)::date as day,
    coalesce(sum(m.qty) filter (where m.kind = 'IN'), 0),
    coalesce(sum(m.qty) filter (where m.kind = 'OUT'), 0),
    coalesce(sum(m.qty) filter (where m.kind = 'TRANSFER'), 0),
    count(*)
  from public.movements m
  where coalesce(m.scanned_at, m.created_at) >= p_from
    and coalesce(m.scanned_at, m.created_at) < p_to
    and m.kind <> 'ADJUST'
    and m.detail is null
  group by 1, 2
  order by 2
$$;
