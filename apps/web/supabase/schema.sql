-- Roadbook — Supabase schema
-- Run this in the Supabase SQL Editor after creating your project.

-- One row per saved roadmap. `data` holds the full roadbook JSON (schema v3).
create table if not exists public.roadmaps (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  title         text not null default 'Untitled roadbook',
  data          jsonb not null default '{
    "roadbookVersion": 3,
    "title": "Untitled roadbook",
    "eyebrow": "Product · 2026",
    "activeYear": "2026",
    "data": {
      "2026": { "granularity": "day", "lanes": [], "items": [] },
      "2027": { "granularity": "day", "lanes": [], "items": [] }
    }
  }'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Keep updated_at fresh
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_roadmaps_touch_updated on public.roadmaps;
create trigger trg_roadmaps_touch_updated
  before update on public.roadmaps
  for each row execute function public.touch_updated_at();

-- Row-level security: every user only sees their own roadmaps
alter table public.roadmaps enable row level security;

drop policy if exists "roadmaps_select_own"  on public.roadmaps;
drop policy if exists "roadmaps_insert_own"  on public.roadmaps;
drop policy if exists "roadmaps_update_own"  on public.roadmaps;
drop policy if exists "roadmaps_delete_own"  on public.roadmaps;

create policy "roadmaps_select_own"
  on public.roadmaps for select
  using (auth.uid() = user_id);

create policy "roadmaps_insert_own"
  on public.roadmaps for insert
  with check (auth.uid() = user_id);

create policy "roadmaps_update_own"
  on public.roadmaps for update
  using (auth.uid() = user_id);

create policy "roadmaps_delete_own"
  on public.roadmaps for delete
  using (auth.uid() = user_id);

-- Index for ordering the dashboard by recency
create index if not exists idx_roadmaps_user_updated
  on public.roadmaps (user_id, updated_at desc);
