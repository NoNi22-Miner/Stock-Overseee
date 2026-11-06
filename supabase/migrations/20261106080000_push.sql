-- Phone push notifications: each new in-app notification is also pushed (via the send-push
-- Edge Function and Firebase Cloud Messaging) to the recipient's registered phones.
create extension if not exists pg_net;

create table public.push_tokens (
  token       text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  platform    text not null default 'android',
  active      boolean not null default true,   -- false after signing out on that phone
  updated_at  timestamptz not null default now()
);
create index push_tokens_user_idx on public.push_tokens (user_id) where active;
alter table public.push_tokens enable row level security;   -- no policies: only the functions below

-- A phone registers its token for whoever is signed in on it now.
create function public.register_push_token(p_token text, p_platform text default 'android') returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or coalesce(length(p_token), 0) < 10 then
    raise exception 'Not signed in';
  end if;
  insert into public.push_tokens (token, user_id, platform, active, updated_at)
  values (p_token, auth.uid(), coalesce(p_platform, 'android'), true, now())
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, active = true, updated_at = now();
end $$;

create function public.unregister_push_token(p_token text) returns void
language sql security definer set search_path = '' as $$
  update public.push_tokens set active = false, updated_at = now()
   where token = p_token and user_id = auth.uid();
$$;

revoke execute on function public.register_push_token(text, text) from public, anon;
revoke execute on function public.unregister_push_token(text) from public, anon;
grant  execute on function public.register_push_token(text, text) to authenticated;
grant  execute on function public.unregister_push_token(text) to authenticated;

-- Each notification is pushed once; send-push claims it by setting pushed_at.
alter table public.notifications add column pushed_at timestamptz;

insert into private.settings (key, value)
values ('push_url', 'https://kvrogdhmjagrowpqzxqx.supabase.co/functions/v1/send-push')
on conflict (key) do nothing;

create function private.push_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
begin
  if not exists (select 1 from public.push_tokens where user_id = new.user_id and active) then
    return new;
  end if;
  select value into v_url from private.settings where key = 'push_url';
  if v_url is not null then
    -- Asynchronous: never slows down or breaks the stock change itself.
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('notification_id', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json')
    );
  end if;
  return new;
end $$;

create trigger notifications_push
  after insert on public.notifications
  for each row execute function private.push_notification();
