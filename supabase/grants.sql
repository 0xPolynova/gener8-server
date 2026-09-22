-- Required: the Data API is getting 42501 permission denied on public.users.
-- Paste into Supabase → SQL Editor → Run, then restart the API (`cd gener8 && npm run dev`).

grant usage on schema public to postgres, anon, authenticated, service_role;

grant all privileges on all tables in schema public to postgres, service_role;
grant all privileges on all sequences in schema public to postgres, service_role;
grant all privileges on all routines in schema public to postgres, service_role;

grant select on table public.users, public.videos, public.likes, public.follows to anon, authenticated;

alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
