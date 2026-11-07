-- Company branding and layout, set by the Team Leader and used by everyone in the team:
-- logo (small PNG data URL), main color, light / dark mode, side panel position, spacing and the
-- Home page sections. The Team Leader can already update the team row ("leader renames team").
alter table public.teams
  add column theme jsonb not null default '{}'::jsonb
    check (jsonb_typeof(theme) = 'object' and octet_length(theme::text) <= 400000);
