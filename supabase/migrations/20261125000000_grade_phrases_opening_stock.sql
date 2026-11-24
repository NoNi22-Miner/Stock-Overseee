-- "Grade A" / "(Grade A)" (and B, C) are other spellings of the grade letter, so a name
-- does not leave the word GRADE unmatched.
-- Excel import can also set opening stock (at a location, or the team's warehouse) and a
-- remark on a grade that is not the standard one.
-- The previous grade migration is already applied; this file only adds to it.

-- 1. Grade phrase on A, B and C (existing rows and any grade saved later) --------------------
create or replace function private.terms_prepare() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.name := trim(regexp_replace(new.name, '\s+', ' ', 'g'));
  new.aliases := private.clean_spellings(new.name, new.aliases);
  new.meaning := nullif(trim(new.meaning), '');
  -- "Grade A" and "(Grade A)" both contain the words GRADE A. The letter still matches on its own.
  if new.kind = 'grade' and upper(new.name) in ('A', 'B', 'C')
     and cardinality(new.aliases) < 20
     and not exists (
       select 1 from unnest(new.aliases) a where upper(a) = 'GRADE ' || upper(new.name)
     ) then
    new.aliases := new.aliases || array['GRADE ' || upper(new.name)];
  end if;
  return new;
end $$;

-- Touch every A / B / C so the trigger above stores the phrase. Custom aliases are kept.
update public.recognition_terms
   set aliases = aliases
 where kind = 'grade' and upper(name) in ('A', 'B', 'C');

-- 2. Where opening stock goes ----------------------------------------------------------------
create function private.resolve_location(p_team uuid, p_text text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_text text := upper(trim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g')));
  v_id   uuid;
begin
  if v_text <> '' then
    select l.id into v_id
      from public.locations l
     where l.team_id = p_team and l.is_active
       and (
         upper(l.code) = v_text
         or upper(trim(l.name)) = v_text
         or v_text in (select upper(trim(a)) from unnest(l.aliases) a)
       )
     order by (upper(l.code) = v_text) desc, l.created_at
     limit 1;
    if v_id is null then
      raise exception 'Location "%" was not found', trim(p_text);
    end if;
    return v_id;
  end if;

  -- No location written: the warehouse, or the oldest location when the team has none.
  select l.id into v_id
    from public.locations l
   where l.team_id = p_team and l.is_active
   order by (l.kind = 'warehouse') desc, l.created_at, l.code
   limit 1;
  if v_id is null then
    raise exception 'Add a location before importing opening stock';
  end if;
  return v_id;
end $$;
revoke all on function private.resolve_location(uuid, text) from public, anon, authenticated;

-- 3. Import: opening quantity, location, remark ----------------------------------------------
create or replace function public.import_items(p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_team    uuid := public.my_team();
  v_item    jsonb;
  v_cat     uuid;
  v_name    text;
  v_unit    text;
  v_labels  uuid[];
  v_marks   uuid[];
  v_brand   uuid;
  v_grade   uuid;
  v_new     uuid;
  v_qty     numeric;
  v_remark  text;
  v_added   int := 0;
  v_skipped int := 0;
  v_stocked int := 0;
  v_lists   int := (select count(*) from public.recognition_terms where team_id = v_team)
                   + (select count(*) from public.categories where team_id = v_team);
begin
  if v_team is null or not public.has_role('owner', 'oversee') then
    raise exception 'Only the Team Leader or an Oversee can import items';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 3000 then
    raise exception 'Send a list of at most 3000 items';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_name := trim(regexp_replace(coalesce(v_item->>'category', ''), '\s+', ' ', 'g'));
    if v_name = '' then
      raise exception 'Every item needs a category';
    end if;
    v_unit := coalesce(nullif(v_item->>'unit', ''), 'Pcs');
    begin
      v_qty := nullif(trim(coalesce(v_item->>'qty', '')), '')::numeric;
    exception when invalid_text_representation then
      raise exception 'Opening stock must be a number';
    end;
    if v_qty is not null and v_qty < 0 then
      raise exception 'Opening stock cannot be negative';
    end if;
    v_remark := nullif(left(trim(coalesce(v_item->>'remark', '')), 400), '');

    select id into v_cat from public.categories
    where team_id = v_team
      and (upper(name) = upper(v_name) or upper(v_name) in (select upper(a) from unnest(aliases) a))
    order by (upper(name) = upper(v_name)) desc
    limit 1;
    if v_cat is null then
      insert into public.categories (team_id, name, default_unit) values (v_team, v_name, v_unit)
      returning id into v_cat;
    end if;

    select coalesce(array_agg(private.term_id(v_team, 'label', l) order by ord), '{}') into v_labels
      from jsonb_array_elements_text(coalesce(v_item->'labels', '[]')) with ordinality u(l, ord)
      where trim(l) <> '';
    select coalesce(array_agg(private.term_id(v_team, 'mark', m) order by ord), '{}') into v_marks
      from jsonb_array_elements_text(coalesce(v_item->'marks', '[]')) with ordinality u(m, ord)
      where trim(m) <> '';
    v_labels := coalesce(v_labels, '{}');
    v_marks := coalesce(v_marks, '{}');
    v_brand := private.term_id(v_team, 'brand', v_item->>'brand');
    v_grade := private.term_id(v_team, 'grade', v_item->>'grade');
    if v_grade is null then
      v_grade := coalesce(
        private.mapped_grade(v_team, v_cat, v_brand, v_labels, v_marks),
        private.team_default_grade(v_team)
      );
    end if;
    -- A remark is only kept when this grade is not the standard one (products_grade_note agrees).
    if v_grade is not distinct from private.team_default_grade(v_team) then
      v_remark := null;
    end if;

    begin
      insert into public.products
        (team_id, structured, category_id, grade_id, brand_id, label_ids, mark_ids, size, unit, min_stock,
         barcode, grade_note, name)
      values (
        v_team, true, v_cat, v_grade, v_brand, v_labels, v_marks,
        array(select jsonb_array_elements_text(coalesce(v_item->'size', '[]'))),
        v_unit,
        greatest(coalesce((v_item->>'min_stock')::numeric, 0), 0),
        v_item->>'barcode',
        v_remark,
        'item'
      )
      returning id into v_new;
      if v_qty is not null and v_qty > 0 then
        perform public.record_adjustment(
          v_new,
          private.resolve_location(v_team, v_item->>'location'),
          v_qty,
          case when v_remark is null then 'Opening stock' else 'Opening stock · ' || v_remark end
        );
        v_stocked := v_stocked + 1;
      end if;
      v_added := v_added + 1;
    exception when unique_violation then
      v_skipped := v_skipped + 1;
    end;
  end loop;

  return jsonb_build_object(
    'added', v_added,
    'skipped', v_skipped,
    'stocked', v_stocked,
    'new_list_entries',
      (select count(*) from public.recognition_terms where team_id = v_team)
      + (select count(*) from public.categories where team_id = v_team) - v_lists
  );
end $$;
