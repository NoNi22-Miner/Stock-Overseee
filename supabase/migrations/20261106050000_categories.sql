-- Product categories (e.g. Steel Shaft, Steel Pipe, Steel Knee), one per product, per team.
-- No category = "Uncategorized".
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null default public.my_team() references public.teams(id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 60),
  created_at  timestamptz not null default now(),
  unique (team_id, name),
  unique (team_id, id)
);
alter table public.categories enable row level security;

create policy "team reads categories" on public.categories for select to authenticated
  using (team_id = (select public.my_team()));
create policy "team managers add categories" on public.categories for insert to authenticated
  with check (team_id = (select public.my_team()) and (select public.has_role('owner', 'oversee')));
create policy "team managers edit categories" on public.categories for update to authenticated
  using (team_id = (select public.my_team()) and (select public.has_role('owner', 'oversee')))
  with check (team_id = (select public.my_team()) and (select public.has_role('owner', 'oversee')));
create policy "team managers delete categories" on public.categories for delete to authenticated
  using (team_id = (select public.my_team()) and (select public.has_role('owner', 'oversee')));

-- A product's category must belong to the same team; deleting a category leaves its products
-- uncategorized.
alter table public.products add column category_id uuid;
alter table public.products
  add constraint products_category_fk foreign key (team_id, category_id)
  references public.categories (team_id, id) on delete set null (category_id);
create index products_category_idx on public.products (category_id);
