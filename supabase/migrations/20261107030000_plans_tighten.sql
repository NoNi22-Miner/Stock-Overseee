-- The plan helpers that take another team's or member's id are only used inside the database
-- (policies, triggers, my_role). The app reads its own plan with my_plan_info().
revoke execute on function public.team_plan(uuid), public.locked_locations(uuid),
  public.location_locked(uuid), public.member_locked(uuid)
  from authenticated;
