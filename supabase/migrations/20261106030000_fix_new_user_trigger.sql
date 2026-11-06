-- Supabase Auth sets app_metadata after inserting the user row, so the trigger cannot see
-- the "managed" flag. The check is not needed: member Auth emails use random login keys,
-- and an account on the internal domain can never create or join a team by itself
-- (create_team refuses it; only manage-users assigns a team).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end $$;
