-- Recognition Table (docs/RECOGNITION.md): items are built from parts picked from lists, and the
-- app reads item names (scan, typing, Excel import) by finding those parts.
--   Category (with size pattern) · Grade · Labels (up to 3) · Size (up to 5 boxes) · Brand · Marks
-- Written without DROP / DELETE so it can be applied in one go.
-- Trigger functions run as their owner: app users cannot reach the private schema.

-- 1. Lists: grades, labels, brands, marks ---------------------------------------------------
create table public.recognition_terms (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null default public.my_team() references public.teams(id) on delete cascade,
  kind        text not null check (kind in ('grade', 'label', 'brand', 'mark')),
  name        text not null check (length(name) between 1 and 40),
  aliases     text[] not null default '{}' check (cardinality(aliases) <= 20),
  meaning     text check (meaning is null or length(meaning) <= 120),
  created_at  timestamptz not null default now(),
  unique (team_id, id)
);
create unique index recognition_terms_name_key on public.recognition_terms (team_id, kind, upper(name));

alter table public.recognition_terms enable row level security;
create policy "team reads terms" on public.recognition_terms for select to authenticated
  using (team_id = (select public.my_team()));
create policy "team managers add terms" on public.recognition_terms for insert to authenticated
  with check (team_id = (select public.my_team()) and (select public.has_role('owner', 'oversee')));
create policy "team managers edit terms" on public.recognition_terms for update to authenticated
  using (team_id = (select public.my_team()) and (select public.has_role('owner', 'oversee')))
  with check (team_id = (select public.my_team()) and (select public.has_role('owner', 'oversee')));
create policy "team managers delete terms" on public.recognition_terms for delete to authenticated
  using (team_id = (select public.my_team()) and (select public.has_role('owner', 'oversee')));

-- Single spaces, no empty or repeated other spellings, none equal to the name.
create function private.clean_spellings(p_name text, p_aliases text[]) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(a order by ord), '{}')
  from (
    select distinct on (upper(a)) a, ord
    from (
      select trim(regexp_replace(x, '\s+', ' ', 'g')) as a, ord
      from unnest(coalesce(p_aliases, '{}')) with ordinality u(x, ord)
    ) s
    where a <> '' and upper(a) <> upper(trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')))
    order by upper(a), ord
  ) d
$$;

create function private.terms_prepare() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.name := trim(regexp_replace(new.name, '\s+', ' ', 'g'));
  new.aliases := private.clean_spellings(new.name, new.aliases);
  new.meaning := nullif(trim(new.meaning), '');
  return new;
end $$;
create trigger recognition_terms_prepare before insert or update on public.recognition_terms
  for each row execute function private.terms_prepare();

-- 2. Categories: other spellings, size pattern, default unit ---------------------------------
-- size_pattern: up to 5 boxes, e.g. [{"name":"Tebal","unit":"mm"},{"name":"Panjang","unit":"m","default":"6m"}]
-- A box can be "optional"; "default" fills it when an item's size leaves it out.
alter table public.categories
  add column aliases text[] not null default '{}' check (cardinality(aliases) <= 20),
  add column size_pattern jsonb not null default '[]'::jsonb
    check (jsonb_typeof(size_pattern) = 'array' and jsonb_array_length(size_pattern) <= 5),
  add column default_unit text not null default 'Pcs'
    check (default_unit in ('Lembar', 'Batang', 'Pcs', 'Roll', 'Dus', 'KG'));

create function private.categories_prepare() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.name := trim(regexp_replace(new.name, '\s+', ' ', 'g'));
  new.aliases := private.clean_spellings(new.name, new.aliases);
  return new;
end $$;
create trigger categories_prepare before insert or update on public.categories
  for each row execute function private.categories_prepare();

-- 3. Locations: other spellings (e.g. "PNK IPS" = WRH), for the DO import later ----------------
alter table public.locations
  add column aliases text[] not null default '{}' check (cardinality(aliases) <= 20);

-- 4. Products: parts, units, automatic name and code ------------------------------------------
-- The code / barcode can be left empty: the database gives one (IT1, IT2, ...).
create sequence public.product_code_seq;

alter table public.products
  add column structured boolean not null default false,
  add column grade_id   uuid,
  add column brand_id   uuid,
  add column label_ids  uuid[] not null default '{}' check (cardinality(label_ids) <= 3),
  add column mark_ids   uuid[] not null default '{}' check (cardinality(mark_ids) <= 3),
  add column size       text[] not null default '{}' check (cardinality(size) <= 5);
alter table public.products
  add constraint products_grade_fk foreign key (team_id, grade_id)
    references public.recognition_terms (team_id, id) on delete restrict,
  add constraint products_brand_fk foreign key (team_id, brand_id)
    references public.recognition_terms (team_id, id) on delete restrict;
-- The six units. Not checked against items saved before this change.
alter table public.products alter column unit set default 'Pcs';
alter table public.products
  add constraint products_unit_check check (unit in ('Lembar', 'Batang', 'Pcs', 'Roll', 'Dus', 'KG')) not valid;

create index products_grade_idx on public.products (grade_id);
create index products_brand_idx on public.products (brand_id);
create index products_labels_idx on public.products using gin (label_ids);
create index products_marks_idx on public.products using gin (mark_ids);
-- No duplicates: the name is built from the parts, so the same parts give the same name.
create unique index products_structured_name_key on public.products (team_id, upper(name)) where structured;

-- The name, in this order: Category Grade · Labels · Size · Brand Marks
--   e.g. "PLAT BESI · SS400 · 10mm × 4' × 8' · VM*", "CNP BESI A · 100 × 50 × 20 × 2.3mm × 6m"
-- Marks that are symbols stick to the brand (VM*); word marks get a space (CB NS).
-- src/lib/recognize.ts builds the same name for the preview.
create function private.product_name(p public.products) returns text
language plpgsql stable set search_path = '' as $$
declare
  v_cat    text;
  v_grade  text;
  v_brand  text;
  v_labels text;
  v_marks  text;
  v_last   text;
  v_parts  text[];
begin
  select name into v_cat   from public.categories        where id = p.category_id;
  select name into v_grade from public.recognition_terms where id = p.grade_id;
  select name into v_brand from public.recognition_terms where id = p.brand_id;
  select string_agg(t.name, ' ' order by u.ord) into v_labels
    from unnest(p.label_ids) with ordinality u(id, ord) join public.recognition_terms t on t.id = u.id;
  select string_agg(case when t.name ~ '[[:alnum:]]' then ' ' || t.name else t.name end, '' order by u.ord)
    into v_marks
    from unnest(p.mark_ids) with ordinality u(id, ord) join public.recognition_terms t on t.id = u.id;

  v_parts := array[concat_ws(' ', v_cat, v_grade)];
  if v_labels is not null then v_parts := v_parts || v_labels; end if;
  if cardinality(p.size) > 0 then v_parts := v_parts || array_to_string(p.size, ' × '); end if;
  v_last := trim(coalesce(v_brand, '') || coalesce(v_marks, ''));
  if v_last <> '' then v_parts := v_parts || v_last; end if;
  return array_to_string(v_parts, ' · ');
end $$;

create function private.products_prepare() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_bad int;
begin
  new.barcode := nullif(trim(new.barcode), '');
  if new.barcode is null then
    new.barcode := 'IT' || nextval('public.product_code_seq');
  end if;
  new.size := array(
    select trim(regexp_replace(s, '\s+', ' ', 'g')) from unnest(new.size) with ordinality u(s, ord)
    where trim(s) <> '' order by ord
  );

  if new.structured then
    if new.category_id is null then
      raise exception 'Pick a category';
    end if;
    if new.grade_id is not null and not exists (
      select 1 from public.recognition_terms
      where id = new.grade_id and team_id = new.team_id and kind = 'grade') then
      raise exception 'Unknown grade';
    end if;
    if new.brand_id is not null and not exists (
      select 1 from public.recognition_terms
      where id = new.brand_id and team_id = new.team_id and kind = 'brand') then
      raise exception 'Unknown brand';
    end if;
    select count(*) into v_bad from unnest(new.label_ids) x
    where not exists (
      select 1 from public.recognition_terms t where t.id = x and t.team_id = new.team_id and t.kind = 'label');
    if v_bad > 0 or cardinality(new.label_ids) <> (select count(distinct x) from unnest(new.label_ids) x) then
      raise exception 'Unknown or repeated label';
    end if;
    select count(*) into v_bad from unnest(new.mark_ids) x
    where not exists (
      select 1 from public.recognition_terms t where t.id = x and t.team_id = new.team_id and t.kind = 'mark');
    if v_bad > 0 or cardinality(new.mark_ids) <> (select count(distinct x) from unnest(new.mark_ids) x) then
      raise exception 'Unknown or repeated mark';
    end if;

    new.name := private.product_name(new);
    if exists (
      select 1 from public.products
      where team_id = new.team_id and structured and upper(name) = upper(new.name) and id <> new.id) then
      raise exception using errcode = 'unique_violation', message = 'This item already exists: ' || new.name;
    end if;
  end if;
  return new;
end $$;
create trigger products_prepare before insert or update on public.products
  for each row execute function private.products_prepare();

-- Renaming a list entry or a category renames the items that use it.
create function private.rename_items_of_term() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.name is distinct from old.name then
    update public.products set name = name
    where team_id = new.team_id and structured
      and (grade_id = new.id or brand_id = new.id or new.id = any (label_ids) or new.id = any (mark_ids));
  end if;
  return null;
end $$;
create trigger recognition_terms_rename after update on public.recognition_terms
  for each row execute function private.rename_items_of_term();

create function private.rename_items_of_category() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.name is distinct from old.name then
    update public.products set name = name where category_id = new.id and structured;
  end if;
  return null;
end $$;
create trigger categories_rename after update on public.categories
  for each row execute function private.rename_items_of_category();

-- A list entry or category that items still use cannot be deleted.
create function private.term_in_use() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_n int;
begin
  select count(*) into v_n from public.products
  where team_id = old.team_id
    and (grade_id = old.id or brand_id = old.id or old.id = any (label_ids) or old.id = any (mark_ids));
  if v_n > 0 then
    raise exception '% is used by % item(s). Change those items first.', old.name, v_n;
  end if;
  return old;
end $$;
create trigger recognition_terms_in_use before delete on public.recognition_terms
  for each row execute function private.term_in_use();

create function private.category_in_use() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_n int;
begin
  select count(*) into v_n from public.products where category_id = old.id and structured;
  if v_n > 0 then
    raise exception '% is used by % item(s). Change those items first.', old.name, v_n;
  end if;
  return old;
end $$;
create trigger categories_in_use before delete on public.categories
  for each row execute function private.category_in_use();

-- 5. Whole numbers for Lembar / Batang / Pcs / Roll / Dus; only KG takes decimals ---------------
create function private.whole_qty_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_unit text;
begin
  if new.qty <> trunc(new.qty) then
    select unit into v_unit from public.products where id = new.product_id;
    if v_unit in ('Lembar', 'Batang', 'Pcs', 'Roll', 'Dus') then
      raise exception 'Use whole numbers for % (only KG takes decimals)', v_unit;
    end if;
  end if;
  return new;
end $$;
create trigger movements_whole_qty before insert on public.movements
  for each row execute function private.whole_qty_check();

-- 6. Learned spellings: text read from a DO, linked to the item someone picked for it ----------
create table public.product_aliases (
  team_id     uuid not null default public.my_team() references public.teams(id) on delete cascade,
  spelling    text not null check (length(spelling) between 2 and 200),  -- normalised by the app
  product_id  uuid not null references public.products(id) on delete cascade,
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (team_id, spelling)
);
create index product_aliases_product_idx on public.product_aliases (product_id);

alter table public.product_aliases enable row level security;
create policy "team reads spellings" on public.product_aliases for select to authenticated
  using (team_id = (select public.my_team()));
create policy "team scanners add spellings" on public.product_aliases for insert to authenticated
  with check (
    team_id = (select public.my_team())
    and (select public.has_role('owner', 'oversee', 'staff'))
    and exists (select 1 from public.products p where p.id = product_id and p.team_id = (select public.my_team()))
  );
create policy "team scanners change spellings" on public.product_aliases for update to authenticated
  using (team_id = (select public.my_team()) and (select public.has_role('owner', 'oversee', 'staff')))
  with check (
    team_id = (select public.my_team())
    and (select public.has_role('owner', 'oversee', 'staff'))
    and exists (select 1 from public.products p where p.id = product_id and p.team_id = (select public.my_team()))
  );
create policy "team managers delete spellings" on public.product_aliases for delete to authenticated
  using (team_id = (select public.my_team()) and (select public.has_role('owner', 'oversee')));

-- 7. Excel import ----------------------------------------------------------------------------
-- Finds a list entry by name or other spelling, or adds it.
create function private.term_id(p_team uuid, p_kind text, p_name text) returns uuid
language plpgsql set search_path = '' as $$
declare
  v_name text := trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_id   uuid;
begin
  if v_name = '' then
    return null;
  end if;
  select id into v_id from public.recognition_terms
  where team_id = p_team and kind = p_kind
    and (upper(name) = upper(v_name) or upper(v_name) in (select upper(a) from unnest(aliases) a))
  order by (upper(name) = upper(v_name)) desc
  limit 1;
  if v_id is null then
    insert into public.recognition_terms (team_id, kind, name) values (p_team, p_kind, v_name)
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- p_items: [{category, grade, labels: [..], size: [..], brand, marks: [..], unit, min_stock, barcode}]
-- Missing categories and list entries are added; items that already exist are skipped.
create function public.import_items(p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_team    uuid := public.my_team();
  v_item    jsonb;
  v_cat     uuid;
  v_name    text;
  v_unit    text;
  v_labels  uuid[];
  v_marks   uuid[];
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

    begin
      insert into public.products
        (team_id, structured, category_id, grade_id, brand_id, label_ids, mark_ids, size, unit, min_stock,
         barcode, name)
      values (
        v_team, true, v_cat,
        private.term_id(v_team, 'grade', v_item->>'grade'),
        private.term_id(v_team, 'brand', v_item->>'brand'),
        v_labels, v_marks,
        array(select jsonb_array_elements_text(coalesce(v_item->'size', '[]'))),
        v_unit,
        greatest(coalesce((v_item->>'min_stock')::numeric, 0), 0),
        v_item->>'barcode',
        'item'   -- replaced by the built name
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
revoke execute on function public.import_items(jsonb) from public, anon;
grant  execute on function public.import_items(jsonb) to authenticated;
