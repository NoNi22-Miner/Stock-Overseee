-- Standard grade, grade assigned by a recognition entry, and a remark when an item is not
-- the standard grade.
--
-- Grades stay the Recognition Table entries of kind 'grade' (A, B, C, …).
--   * teams.default_grade_id — the grade new items use. Null means the grade named B.
--   * recognition_terms.target_grade_id / categories.target_grade_id — optional grade an entry
--     assigns when an item name matches it and the name does not name a grade itself.
--   * products.grade_note — remark kept on a version whose grade is not the standard one.
-- A movement into such a grade still uses movements.note (already on the scan queue). The first
-- remark is copied onto the item when that version has none yet.
-- Written without DROP / DELETE so it can be applied in one go.

-- 1. Columns ------------------------------------------------------------------------------------
alter table public.teams
  add column default_grade_id uuid;

alter table public.teams
  add constraint teams_default_grade_fk
  foreign key (id, default_grade_id)
  references public.recognition_terms (team_id, id)
  on delete set null (default_grade_id);

alter table public.recognition_terms
  add column target_grade_id uuid;

alter table public.recognition_terms
  add constraint recognition_terms_target_grade_fk
  foreign key (team_id, target_grade_id)
  references public.recognition_terms (team_id, id)
  on delete set null (target_grade_id);

alter table public.categories
  add column target_grade_id uuid;

alter table public.categories
  add constraint categories_target_grade_fk
  foreign key (team_id, target_grade_id)
  references public.recognition_terms (team_id, id)
  on delete set null (target_grade_id);

alter table public.products
  add column grade_note text check (grade_note is null or length(grade_note) <= 400);

create index teams_default_grade_idx on public.teams (default_grade_id) where default_grade_id is not null;
create index recognition_terms_target_grade_idx
  on public.recognition_terms (target_grade_id) where target_grade_id is not null;
create index categories_target_grade_idx
  on public.categories (target_grade_id) where target_grade_id is not null;

-- 2. Which grade is standard, and which grade a set of parts assigns ---------------------------
-- Null default_grade_id means the grade named B, when the team has one.
create function private.team_default_grade(p_team uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select t.default_grade_id from public.teams t where t.id = p_team),
    (
      select r.id from public.recognition_terms r
      where r.team_id = p_team and r.kind = 'grade' and upper(r.name) = 'B'
      order by r.created_at
      limit 1
    )
  )
$$;
revoke all on function private.team_default_grade(uuid) from public, anon, authenticated;

-- Mark, then label, then brand, then category. The first entry that assigns a grade wins.
create function private.mapped_grade(
  p_team uuid,
  p_category uuid,
  p_brand uuid,
  p_labels uuid[],
  p_marks uuid[]
) returns uuid
language sql stable set search_path = '' as $$
  select s.g
  from (
    select t.target_grade_id as g, 1 as pri, u.ord
    from unnest(coalesce(p_marks, '{}')) with ordinality u(id, ord)
    join public.recognition_terms t on t.id = u.id and t.team_id = p_team
    where t.target_grade_id is not null
    union all
    select t.target_grade_id, 2, u.ord
    from unnest(coalesce(p_labels, '{}')) with ordinality u(id, ord)
    join public.recognition_terms t on t.id = u.id and t.team_id = p_team
    where t.target_grade_id is not null
    union all
    select t.target_grade_id, 3, 0
    from public.recognition_terms t
    where t.id = p_brand and t.team_id = p_team and t.target_grade_id is not null
    union all
    select c.target_grade_id, 4, 0
    from public.categories c
    where c.id = p_category and c.team_id = p_team and c.target_grade_id is not null
  ) s
  order by s.pri, s.ord
  limit 1
$$;
revoke all on function private.mapped_grade(uuid, uuid, uuid, uuid[], uuid[]) from public, anon, authenticated;

-- Keep the first remark on a grade version that does not have one yet. The product trigger
-- drops it again when that version is the standard grade.
create function private.remember_grade_note(p_product_id uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_note text := left(nullif(trim(p_note), ''), 400);
begin
  if v_note is null then
    return;
  end if;
  update public.products
     set grade_note = v_note
   where id = p_product_id and grade_note is null;
end $$;
revoke all on function private.remember_grade_note(uuid, text) from public, anon, authenticated;

-- 3. Checks -------------------------------------------------------------------------------------
create function private.products_grade_note() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.grade_note := nullif(trim(new.grade_note), '');
  if new.grade_note is not null and length(new.grade_note) > 400 then
    raise exception 'Grade remark must be 400 characters or less';
  end if;
  if not new.structured
     or new.grade_id is not distinct from private.team_default_grade(new.team_id) then
    new.grade_note := null;
  end if;
  return new;
end $$;
create trigger products_grade_note before insert or update on public.products
  for each row execute function private.products_grade_note();

create function private.terms_target_grade() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'grade' or new.target_grade_id is not distinct from new.id then
    new.target_grade_id := null;
  elsif new.target_grade_id is not null and not exists (
    select 1 from public.recognition_terms
    where id = new.target_grade_id and team_id = new.team_id and kind = 'grade'
  ) then
    raise exception 'Assign a grade from this team';
  end if;
  return new;
end $$;
create trigger recognition_terms_target_grade before insert or update on public.recognition_terms
  for each row execute function private.terms_target_grade();

create function private.categories_target_grade() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.target_grade_id is not null and not exists (
    select 1 from public.recognition_terms
    where id = new.target_grade_id and team_id = new.team_id and kind = 'grade'
  ) then
    raise exception 'Assign a grade from this team';
  end if;
  return new;
end $$;
create trigger categories_target_grade before insert or update on public.categories
  for each row execute function private.categories_target_grade();

create function private.teams_default_grade() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.default_grade_id is not null and not exists (
    select 1 from public.recognition_terms
    where id = new.default_grade_id and team_id = new.id and kind = 'grade'
  ) then
    raise exception 'The standard grade must be a grade of this team';
  end if;
  return new;
end $$;
create trigger teams_default_grade before update of default_grade_id on public.teams
  for each row execute function private.teams_default_grade();

-- 4. Graded moves: the movement note is also the first remark on a new grade version -----------
create or replace function public.record_graded_movement(
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
  select movement_id into v_existing from public.sync_receipts where client_id = p_client_id;
  if v_existing is not null then
    select * into v_row from public.movements where id = v_existing;
    return v_row;
  end if;
  v_row := public.record_movement_sync(
    p_client_id, p_scanned_at, p_kind, private.grade_version(p_product_id, p_grade_id), p_qty, p_from, p_to, p_note);
  perform private.remember_grade_note(v_row.product_id, p_note);
  return v_row;
end $$;
revoke execute on function public.record_graded_movement(uuid, timestamptz, text, uuid, uuid, numeric, uuid, uuid, text)
  from public, anon;
grant execute on function public.record_graded_movement(uuid, timestamptz, text, uuid, uuid, numeric, uuid, uuid, text)
  to authenticated;

create or replace function public.record_graded_adjustment(
  p_product_id  uuid,
  p_grade_id    uuid,
  p_location_id uuid,
  p_new_qty     numeric,
  p_note        text default null
) returns public.movements
language plpgsql security definer set search_path = '' as $$
declare
  v_id  uuid;
  v_row public.movements;
begin
  if not public.has_role('owner', 'oversee') or public.my_team() is null then
    raise exception 'Only Team Leader and Oversee can adjust stock';
  end if;
  v_id := private.grade_version(p_product_id, p_grade_id);
  v_row := public.record_adjustment(v_id, p_location_id, p_new_qty, p_note);
  perform private.remember_grade_note(v_id, p_note);
  return v_row;
end $$;
revoke execute on function public.record_graded_adjustment(uuid, uuid, uuid, numeric, text) from public, anon;
grant execute on function public.record_graded_adjustment(uuid, uuid, uuid, numeric, text) to authenticated;

-- 5. Excel import: an empty grade uses a recognition entry's grade, then the standard grade -----
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
  v_added   int := 0;
  v_skipped int := 0;
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
    -- A list with nothing in it returns no row, so SELECT INTO would leave these null.
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

    begin
      insert into public.products
        (team_id, structured, category_id, grade_id, brand_id, label_ids, mark_ids, size, unit, min_stock,
         barcode, name)
      values (
        v_team, true, v_cat, v_grade, v_brand, v_labels, v_marks,
        array(select jsonb_array_elements_text(coalesce(v_item->'size', '[]'))),
        v_unit,
        greatest(coalesce((v_item->>'min_stock')::numeric, 0), 0),
        v_item->>'barcode',
        'item'
      );
      v_added := v_added + 1;
    exception when unique_violation then
      v_skipped := v_skipped + 1;
    end;
  end loop;

  return jsonb_build_object(
    'added', v_added,
    'skipped', v_skipped,
    'new_list_entries',
      (select count(*) from public.recognition_terms where team_id = v_team)
      + (select count(*) from public.categories where team_id = v_team) - v_lists
  );
end $$;

-- 6. New teams start with grades A, B and C, and B as the standard grade ------------------------
create or replace function public.create_team(p_team_name text, p_display_name text default '') returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_team  uuid;
  v_grade uuid;
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
  insert into public.recognition_terms (team_id, kind, name)
  values (v_team, 'grade', 'A'), (v_team, 'grade', 'B'), (v_team, 'grade', 'C');
  select id into v_grade from public.recognition_terms
  where team_id = v_team and kind = 'grade' and name = 'B';
  update public.teams set default_grade_id = v_grade where id = v_team;
  return v_team;
end $$;

-- Teams that already exist get A, B and C when those names are missing. The standard grade stays
-- unset, so it is B until someone chooses another.
insert into public.recognition_terms (team_id, kind, name)
select t.id, 'grade', g.name
from public.teams t
cross join (values ('A'), ('B'), ('C')) as g(name)
where not exists (
  select 1 from public.recognition_terms r
  where r.team_id = t.id and r.kind = 'grade' and upper(r.name) = g.name
);

-- 7. Team Leader or Oversee chooses the standard grade ------------------------------------------
create function public.set_default_grade(p_grade_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_team uuid := public.my_team();
begin
  if v_team is null or not public.has_role('owner', 'oversee') then
    raise exception 'Only the Team Leader or an Oversee can set the standard grade';
  end if;
  if p_grade_id is null then
    raise exception 'Pick a grade';
  end if;
  if not exists (
    select 1 from public.recognition_terms
    where id = p_grade_id and team_id = v_team and kind = 'grade'
  ) then
    raise exception 'Unknown grade';
  end if;
  update public.teams set default_grade_id = p_grade_id where id = v_team;
end $$;
revoke all on function public.set_default_grade(uuid) from public, anon;
grant execute on function public.set_default_grade(uuid) to authenticated;
