-- Daily movement per product for the Home dashboard (IN / OUT / TRANSFER; ADJUST is a count
-- correction, not movement). Runs with the caller's rights, so RLS keeps it to their team.
create function public.movement_daily(p_from timestamptz, p_to timestamptz, p_tz text default 'UTC')
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
  group by 1, 2
  order by 2
$$;

revoke execute on function public.movement_daily(timestamptz, timestamptz, text) from public, anon;
grant  execute on function public.movement_daily(timestamptz, timestamptz, text) to authenticated;
