-- Grade per move: one item, its stock kept per grade (A, B, C …).
--
-- The grade versions of an item are the items with the same parts except the grade, e.g.
--   "PLAT BESI · SS400 · 10mm × 4' × 8' · KP" and "PLAT BESI B · SS400 · 10mm × 4' × 8' · KP".
-- A move (or a stock count) can pick the grade. When the item has no version with that grade yet,
-- it is made then and there: same parts and unit, its own code (IT…), min stock 0.
-- Staff can do this too: they pick a grade, they do not edit items.

create function private.grade_version(p_product_id uuid, p_grade_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_team   uuid := public.my_team();
  p        public.products;
  v_id     uuid;
  v_active boolean;
begin
  if not public.has_role('owner', 'oversee', 'staff') or v_team is null then
    raise exception 'Your account is not allowed to change stock';
  end if;
  select * into p from public.products where id = p_product_id and team_id = v_team;
  if p.id is null then
    raise exception 'Product not found';
  end if;
  if p.grade_id is not distinct from p_grade_id then
    return p.id;
  end if;
  if not p.structured then
    raise exception 'Only items built from parts have grades. Split this item into parts first.';
  end if;
  if p_grade_id is not null and not exists (
    select 1 from public.recognition_terms where id = p_grade_id and team_id = v_team and kind = 'grade') then
    raise exception 'Unknown grade';
  end if;

  -- One phone at a time looks for (or makes) a version of this item.
  perform pg_advisory_xact_lock(hashtextextended(concat_ws('|',
    'grade', v_team, p.category_id, p.label_ids::text, upper(p.size::text), p.brand_id, p.mark_ids::text), 0));

  select id, is_active into v_id, v_active
    from public.products
   where team_id = v_team and structured
     and category_id = p.category_id
     and grade_id is not distinct from p_grade_id
     and label_ids = p.label_ids
     and mark_ids = p.mark_ids
     and brand_id is not distinct from p.brand_id
     and upper(size::text) = upper(p.size::text)
   order by is_active desc, created_at
   limit 1;

  if v_id is not null then
    if not v_active then
      update public.products set is_active = true where id = v_id;   -- used again
    end if;
    return v_id;
  end if;

  -- The name and the code are filled in by products_prepare.
  insert into public.products
    (team_id, structured, category_id, grade_id, label_ids, mark_ids, brand_id, size, unit, min_stock, name)
  values
    (v_team, true, p.category_id, p_grade_id, p.label_ids, p.mark_ids, p.brand_id, p.size, p.unit, 0, p.name)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function private.grade_version(uuid, uuid) from public, anon, authenticated;

-- In / Out / Transfer of the version with this grade (null = the version without a grade).
-- Like record_movement_sync: sent once per scan id, also when the scan waited offline.
create function public.record_graded_movement(
  p_client_id   uuid,
  p_scanned_at  timestamptz,
  p_kind        text,
  p_product_id  uuid,
  p_grade_id    uuid,
  p_qty         numeric,
  p_from        uuid default null,
  p_to          uuid default null,
  p_note        text default null
) returns public.movements
language plpgsql security definer set search_path = '' as $$
declare
  v_existing bigint;
  v_row      public.movements;
begin
  if p_client_id is null then
    raise exception 'Missing client id';
  end if;
  -- Already recorded (a retry): return it, make nothing.
  select movement_id into v_existing from public.sync_receipts where client_id = p_client_id;
  if v_existing is not null then
    select * into v_row from public.movements where id = v_existing;
    return v_row;
  end if;
  -- If the move is refused (e.g. not enough stock), a version made for it is undone with it.
  return public.record_movement_sync(
    p_client_id, p_scanned_at, p_kind, private.grade_version(p_product_id, p_grade_id), p_qty, p_from, p_to, p_note);
end $$;
revoke execute on function public.record_graded_movement(uuid, timestamptz, text, uuid, uuid, numeric, uuid, uuid, text)
  from public, anon;
grant execute on function public.record_graded_movement(uuid, timestamptz, text, uuid, uuid, numeric, uuid, uuid, text)
  to authenticated;

-- Stock count of the version with this grade.
create function public.record_graded_adjustment(
  p_product_id  uuid,
  p_grade_id    uuid,
  p_location_id uuid,
  p_new_qty     numeric,
  p_note        text default null
) returns public.movements
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role('owner', 'oversee') or public.my_team() is null then
    raise exception 'Only Team Leader and Oversee can adjust stock';
  end if;
  return public.record_adjustment(private.grade_version(p_product_id, p_grade_id), p_location_id, p_new_qty, p_note);
end $$;
revoke execute on function public.record_graded_adjustment(uuid, uuid, uuid, numeric, text) from public, anon;
grant execute on function public.record_graded_adjustment(uuid, uuid, uuid, numeric, text) to authenticated;
