-- Gener8 production schema
-- Text IDs match app-generated ids (usr_*, vid_*, job_*).
-- Server access uses the service role (bypasses RLS).
--
-- Apply once in the Supabase dashboard: SQL Editor → New query → Run.

create extension if not exists "pgcrypto";

create table if not exists public.users (
  id text primary key,
  username text unique not null,
  display_name text not null,
  bio text not null default '',
  avatar_url text,
  avatar_palette jsonb not null default '{}'::jsonb,
  x_handle text,
  profile_complete boolean not null default false,
  follower_count integer not null default 0,
  following_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.wallets (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references public.users(id) on delete cascade,
  address text unique not null,
  chain text not null default 'solana',
  created_at timestamptz not null default now()
);

create index if not exists wallets_user_id_idx on public.wallets(user_id);

create table if not exists public.videos (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  prompt text not null,
  public_prompt boolean not null default true,
  title text not null default '',
  video_url text,
  thumbnail_url text,
  poster jsonb not null default '{}'::jsonb,
  model text not null,
  aspect_ratio text not null,
  duration integer not null,
  quality text not null default 'standard',
  status text not null default 'queued',
  visibility text not null default 'private',
  created_at timestamptz not null default now(),
  published_at timestamptz,
  provider text not null,
  provider_job_id text,
  views integer not null default 0,
  likes integer not null default 0,
  category text,
  featured boolean not null default false,
  grid_span text,
  seed integer,
  negative_prompt text,
  camera_movement text,
  prompt_adherence numeric,
  creativity numeric,
  error_message text
);

create index if not exists videos_user_id_idx on public.videos(user_id);
create index if not exists videos_status_idx on public.videos(status);
create index if not exists videos_visibility_idx on public.videos(visibility);
create index if not exists videos_created_at_idx on public.videos(created_at desc);
create index if not exists videos_category_idx on public.videos(category);

create table if not exists public.generation_jobs (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  video_id text not null references public.videos(id) on delete cascade,
  status text not null default 'queued',
  progress integer not null default 0,
  prompt text not null,
  settings jsonb not null default '{}'::jsonb,
  provider text not null,
  provider_job_id text,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index if not exists generation_jobs_user_id_idx on public.generation_jobs(user_id);
create index if not exists generation_jobs_video_id_idx on public.generation_jobs(video_id);
create index if not exists generation_jobs_provider_job_id_idx on public.generation_jobs(provider_job_id);

create table if not exists public.likes (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references public.users(id) on delete cascade,
  video_id text not null references public.videos(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, video_id)
);

create table if not exists public.follows (
  id text primary key default gen_random_uuid()::text,
  follower_id text not null references public.users(id) on delete cascade,
  following_id text not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (follower_id, following_id),
  check (follower_id <> following_id)
);

create table if not exists public.views (
  id text primary key default gen_random_uuid()::text,
  video_id text not null references public.videos(id) on delete cascade,
  user_id text references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.auth_nonces (
  wallet text primary key,
  nonce text not null,
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;
alter table public.wallets enable row level security;
alter table public.videos enable row level security;
alter table public.generation_jobs enable row level security;
alter table public.likes enable row level security;
alter table public.follows enable row level security;
alter table public.views enable row level security;
alter table public.auth_nonces enable row level security;

drop policy if exists "users are publicly readable" on public.users;
create policy "users are publicly readable"
  on public.users for select using (true);

drop policy if exists "public videos are readable" on public.videos;
create policy "public videos are readable"
  on public.videos for select using (
    visibility = 'public' and status = 'complete'
  );

drop policy if exists "likes readable" on public.likes;
create policy "likes readable"
  on public.likes for select using (true);

drop policy if exists "follows readable" on public.follows;
create policy "follows readable"
  on public.follows for select using (true);

drop policy if exists "views insertable" on public.views;
create policy "views insertable"
  on public.views for insert with check (true);

-- Additive profile fields for existing projects
alter table public.users add column if not exists avatar_url text;
alter table public.users add column if not exists x_handle text;
alter table public.users add column if not exists profile_complete boolean not null default true;

alter table public.videos add column if not exists sort_order integer;
create index if not exists videos_sort_order_idx on public.videos(sort_order);

grant usage on schema public to postgres, anon, authenticated, service_role;
grant all privileges on all tables in schema public to postgres, service_role;
grant all privileges on all sequences in schema public to postgres, service_role;
grant all privileges on all routines in schema public to postgres, service_role;
grant select on table public.users, public.videos, public.likes, public.follows to anon, authenticated;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
