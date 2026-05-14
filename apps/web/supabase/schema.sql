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

drop policy if exists "roadmaps_select_own"          on public.roadmaps;
drop policy if exists "roadmaps_select_collaborator" on public.roadmaps;
drop policy if exists "roadmaps_insert_own"          on public.roadmaps;
drop policy if exists "roadmaps_update_own"          on public.roadmaps;
drop policy if exists "roadmaps_delete_own"          on public.roadmaps;

-- Owner can SELECT their own roadmaps
create policy "roadmaps_select_own"
  on public.roadmaps for select
  using (auth.uid() = user_id);

-- INSERT / UPDATE / DELETE remain owner-only
create policy "roadmaps_insert_own"
  on public.roadmaps for insert
  with check (auth.uid() = user_id);

create policy "roadmaps_update_own"
  on public.roadmaps for update
  using (auth.uid() = user_id);

create policy "roadmaps_delete_own"
  on public.roadmaps for delete
  using (auth.uid() = user_id);

-- The collaborator SELECT policy is added later, after roadmap_collaborators
-- is created (Postgres requires the referenced table to exist at policy time).

-- Index for ordering the dashboard by recency
create index if not exists idx_roadmaps_user_updated
  on public.roadmaps (user_id, updated_at desc);

-- =====================================================================
-- COLLABORATION (Cut A: collaborators, invitations, comments, proposals)
-- =====================================================================

-- Active collaborators on a roadmap. Owner is implicit via roadmaps.user_id.
create table if not exists public.roadmap_collaborators (
  id          uuid primary key default gen_random_uuid(),
  roadmap_id  uuid not null references public.roadmaps(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  invited_by  uuid not null references auth.users(id),
  invited_at  timestamptz not null default now(),
  unique (roadmap_id, user_id)
);

create index if not exists idx_collab_user on public.roadmap_collaborators (user_id);
create index if not exists idx_collab_roadmap on public.roadmap_collaborators (roadmap_id);

-- ----- Security-definer helpers for RLS cross-table checks -----
-- Without these, policies on `roadmaps` that reference `roadmap_collaborators`
-- (and vice versa) would trigger nested RLS evaluation and Postgres would
-- either reject the query or return empty results. Wrapping each cross-table
-- check in a `security definer` function lets that lookup bypass RLS while
-- still being scoped to the calling user's auth.uid().
create or replace function public.is_roadmap_owner(p_roadmap_id uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.roadmaps r
    where r.id = p_roadmap_id and r.user_id = auth.uid()
  );
$$;

create or replace function public.is_roadmap_collaborator(p_roadmap_id uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.roadmap_collaborators c
    where c.roadmap_id = p_roadmap_id and c.user_id = auth.uid()
  );
$$;

-- Now that roadmap_collaborators and the helpers exist, add the SELECT
-- policy on public.roadmaps that lets collaborators see shared rows.
create policy "roadmaps_select_collaborator"
  on public.roadmaps for select
  using (public.is_roadmap_collaborator(id));

-- Pending email-based invitations. Auto-claimed via trigger when the invitee
-- signs in (or immediately if they already have an account).
create table if not exists public.roadmap_invitations (
  id            uuid primary key default gen_random_uuid(),
  roadmap_id    uuid not null references public.roadmaps(id) on delete cascade,
  invitee_email text not null,
  invited_by    uuid not null references auth.users(id),
  invited_at    timestamptz not null default now(),
  unique (roadmap_id, invitee_email)
);

create index if not exists idx_invite_email on public.roadmap_invitations (lower(invitee_email));

-- Item-scoped comments. item_id is the engine-level id from the roadmap JSON.
create table if not exists public.roadmap_comments (
  id          uuid primary key default gen_random_uuid(),
  roadmap_id  uuid not null references public.roadmaps(id) on delete cascade,
  item_id     text not null,
  author_id   uuid not null references auth.users(id),
  body        text not null,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id)
);

create index if not exists idx_comments_roadmap_item on public.roadmap_comments (roadmap_id, item_id);

-- Pending proposals from collaborators. Cut A creates the table for forward
-- compatibility but only Cut B/C populates it. kind discriminates the change.
create table if not exists public.roadmap_proposals (
  id             uuid primary key default gen_random_uuid(),
  roadmap_id     uuid not null references public.roadmaps(id) on delete cascade,
  kind           text not null check (kind in ('add-item','add-lane','update-item','update-lane')),
  target_id      text,
  author_id      uuid not null references auth.users(id),
  payload        jsonb not null,
  base_snapshot  jsonb,
  note           text,
  status         text not null default 'pending' check (status in ('pending','accepted','rejected')),
  decided_at     timestamptz,
  decided_by     uuid references auth.users(id),
  decided_reason text,
  created_at     timestamptz not null default now()
);

create index if not exists idx_proposals_roadmap_status on public.roadmap_proposals (roadmap_id, status);

-- One-time cleanup before adding the coalesce index: collapse any
-- duplicate pending proposals from before this constraint existed,
-- keeping only the most-recently-created row per group. Idempotent —
-- on fresh databases there are no duplicates and this deletes nothing.
delete from public.roadmap_proposals
where status = 'pending'
  and id not in (
    select distinct on (roadmap_id, kind, target_id, author_id) id
    from public.roadmap_proposals
    where status = 'pending'
    order by roadmap_id, kind, target_id, author_id, created_at desc
  );

-- Coalesce: at most one pending proposal per (roadmap, kind, target, author).
-- Re-proposing the same change on the same item updates the existing row
-- via UPSERT instead of inserting a new one. Only enforced for status=pending;
-- once decided, the constraint relaxes so a follow-up proposal is allowed.
create unique index if not exists idx_proposals_one_pending_per_author
  on public.roadmap_proposals (roadmap_id, kind, target_id, author_id)
  where status = 'pending';

-- ----- Auto-claim invitations -----
-- Single function used by both triggers below. Looks up any pending
-- invitations for the given email, materializes them as collaborator rows,
-- and deletes the consumed invitations. Idempotent via the unique constraint.
create or replace function public.migrate_invitations_for_email(p_email text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_user_id uuid;
begin
  select id into v_user_id from auth.users where lower(email) = lower(p_email) limit 1;
  if v_user_id is null then return; end if;

  insert into public.roadmap_collaborators (roadmap_id, user_id, invited_by, invited_at)
  select i.roadmap_id, v_user_id, i.invited_by, i.invited_at
  from public.roadmap_invitations i
  where lower(i.invitee_email) = lower(p_email)
  on conflict (roadmap_id, user_id) do nothing;

  delete from public.roadmap_invitations where lower(invitee_email) = lower(p_email);
end;
$$;

-- Trigger 1: new user signs up → claim any invites waiting for their email.
create or replace function public.handle_new_user_invitations()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.migrate_invitations_for_email(new.email);
  return new;
end;
$$;

drop trigger if exists trg_handle_new_user_invitations on auth.users;
create trigger trg_handle_new_user_invitations
  after insert on auth.users
  for each row execute function public.handle_new_user_invitations();

-- Trigger 2: new invitation inserted → if user already exists, claim immediately.
create or replace function public.handle_new_invitation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.migrate_invitations_for_email(new.invitee_email);
  return new;
end;
$$;

drop trigger if exists trg_handle_new_invitation on public.roadmap_invitations;
create trigger trg_handle_new_invitation
  after insert on public.roadmap_invitations
  for each row execute function public.handle_new_invitation();

-- ----- RLS: roadmap_collaborators -----
alter table public.roadmap_collaborators enable row level security;

drop policy if exists "collab_select_owner"    on public.roadmap_collaborators;
drop policy if exists "collab_select_self"     on public.roadmap_collaborators;
drop policy if exists "collab_insert_owner"    on public.roadmap_collaborators;
drop policy if exists "collab_delete_owner"    on public.roadmap_collaborators;
drop policy if exists "collab_delete_self"     on public.roadmap_collaborators;

create policy "collab_select_owner"
  on public.roadmap_collaborators for select
  using (public.is_roadmap_owner(roadmap_id));

create policy "collab_select_self"
  on public.roadmap_collaborators for select
  using (user_id = auth.uid());

create policy "collab_insert_owner"
  on public.roadmap_collaborators for insert
  with check (public.is_roadmap_owner(roadmap_id));

create policy "collab_delete_owner"
  on public.roadmap_collaborators for delete
  using (public.is_roadmap_owner(roadmap_id));

create policy "collab_delete_self"
  on public.roadmap_collaborators for delete
  using (user_id = auth.uid());

-- ----- RLS: roadmap_invitations -----
alter table public.roadmap_invitations enable row level security;

drop policy if exists "invite_owner_all" on public.roadmap_invitations;

create policy "invite_owner_all"
  on public.roadmap_invitations for all
  using (public.is_roadmap_owner(roadmap_id))
  with check (public.is_roadmap_owner(roadmap_id));

-- ----- RLS: roadmap_comments -----
alter table public.roadmap_comments enable row level security;

drop policy if exists "comments_select_participants" on public.roadmap_comments;
drop policy if exists "comments_insert_participants" on public.roadmap_comments;
drop policy if exists "comments_update_self_or_owner" on public.roadmap_comments;
drop policy if exists "comments_delete_self" on public.roadmap_comments;

create policy "comments_select_participants"
  on public.roadmap_comments for select
  using (
    public.is_roadmap_owner(roadmap_id)
    or public.is_roadmap_collaborator(roadmap_id)
  );

create policy "comments_insert_participants"
  on public.roadmap_comments for insert
  with check (
    author_id = auth.uid()
    and (public.is_roadmap_owner(roadmap_id) or public.is_roadmap_collaborator(roadmap_id))
  );

create policy "comments_update_self_or_owner"
  on public.roadmap_comments for update
  using (
    author_id = auth.uid() or public.is_roadmap_owner(roadmap_id)
  );

create policy "comments_delete_self"
  on public.roadmap_comments for delete
  using (author_id = auth.uid());

-- ----- RLS: roadmap_proposals -----
alter table public.roadmap_proposals enable row level security;

drop policy if exists "proposals_select_participants" on public.roadmap_proposals;
drop policy if exists "proposals_insert_collaborator" on public.roadmap_proposals;
drop policy if exists "proposals_update_owner"        on public.roadmap_proposals;
drop policy if exists "proposals_delete_self_pending" on public.roadmap_proposals;

create policy "proposals_select_participants"
  on public.roadmap_proposals for select
  using (
    public.is_roadmap_owner(roadmap_id)
    or public.is_roadmap_collaborator(roadmap_id)
  );

create policy "proposals_insert_collaborator"
  on public.roadmap_proposals for insert
  with check (
    author_id = auth.uid()
    and public.is_roadmap_collaborator(roadmap_id)
  );

create policy "proposals_update_owner"
  on public.roadmap_proposals for update
  using (public.is_roadmap_owner(roadmap_id));

create policy "proposals_delete_self_pending"
  on public.roadmap_proposals for delete
  using (author_id = auth.uid() and status = 'pending');
