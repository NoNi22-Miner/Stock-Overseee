-- Let a member turn "notify me of every stock change" on or off for themselves.
create function public.set_my_notify_changes(p_on boolean) returns void
language sql security definer set search_path = '' as $$
  update public.profiles set notify_changes = coalesce(p_on, true) where id = auth.uid();
$$;
revoke execute on function public.set_my_notify_changes(boolean) from public, anon;
grant  execute on function public.set_my_notify_changes(boolean) to authenticated;
