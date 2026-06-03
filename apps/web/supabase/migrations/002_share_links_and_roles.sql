Me-- Roadbook migration 002 — share links + collaborator roles
-- =====================================================================
-- Adds:
--   1. roadmap_collaborators.role  ('editor' | 'proposer')
--   2. roadmap_share_links table   (no-email join links)
--   3. is_roadmap_editor() helper + RLS so editors can UPDATE the roadmap
--   4. claim_share_link(token)     (turns a link-opener into a collaborator)
--
-- Idempotent: safe to re-run. Run this in the Supabase SQL Editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Collaborator role
-- ---------------------------------------------------------------------
-- Default 'proposer' preserves the existing propose-and-approve behavior
-- for everyone already on a roadmap. Editors can mutate the roadmap
-- directly; proposers still go through the proposal flow.
alter table public.roadmap_collaborators
  add column if not exists role text not null default 'proposer';

-- Add the check constraint separately so re-runs don't error if it exists.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'roadmap_collaborators_role_check'
  ) then
    alter table public.roadmap_collaborators
      add constraint roadmap_collaborators_role_check
      check (role in ('editor','proposer'));
  end if;
end $$;

-- The original schema had no UPDATE policy on roadmap_collaborators, so the
-- owner couldn't change a collaborator's role. Add one.
drop policy if exists "collab_update_owner" on public.roadmap_collaborators;
create policy "collab_update_owner"
  on public.roadmap_collaborators for update
  using (public.is_roadmap_owner(roadmap_id))
  with check (public.is_roadmap_owner(roadmap_id));

-- ---------------------------------------------------------------------
-- 2. Share links (no-email join)
-- ---------------------------------------------------------------------
-- One row per generated link. `token` is a random URL-safe string minted
-- client-side. Opening the link and signing in calls claim_share_link()
-- which inserts the caller as a collaborator with this link's role.
-- Revoking sets revoked_at; existing collaborators are unaffected.
create table if not exists public.roadmap_share_links (
  id          uuid primary key default gen_random_uuid(),
  roadmap_id  uuid not null references public.roadmaps(id) on delete cascade,
  token       text not null unique,
  role        text not null default 'editor' check (role in ('editor','proposer')),
  created_by  uuid not null references auth.users(id),
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);

create index if not exists idx_sharelinks_roadmap on public.roadmap_share_links (roadmap_id);

alter table public.roadmap_share_links enable row level security;

-- Only the roadmap owner can see / create / revoke links for their roadmap.
-- Link-openers never SELECT this table directly — claim_share_link() is a
-- security-definer function that reads the row on their behalf.
drop policy if exists "sharelinks_owner_all" on public.roadmap_share_links;
create policy "sharelinks_owner_all"
  on public.roadmap_share_links for all
  using (public.is_roadmap_owner(roadmap_id))
  with check (public.is_roadmap_owner(roadmap_id));

-- ---------------------------------------------------------------------
-- 3. Editor RLS — let role='editor' collaborators UPDATE the roadmap
-- ---------------------------------------------------------------------
create or replace function public.is_roadmap_editor(p_roadmap_id uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.roadmap_collaborators c
    where c.roadmap_id = p_roadmap_id
      and c.user_id = auth.uid()
      and c.role = 'editor'
  );
$$;

drop policy if exists "roadmaps_update_editor" on public.roadmaps;
create policy "roadmaps_update_editor"
  on public.roadmaps for update
  using (public.is_roadmap_editor(id))
  with check (public.is_roadmap_editor(id));

-- ---------------------------------------------------------------------
-- 4. Claim a share link → become a collaborator
-- ---------------------------------------------------------------------
-- Caller must be authenticated. Looks up a non-revoked link by token and
-- inserts the caller as a collaborator with the link's role. If they're
-- already a collaborator, upgrades proposer→editor when the link grants
-- editor (never downgrades). Returns the roadmap_id, or null if the token
-- is invalid/revoked or the caller isn't signed in.
create or replace function public.claim_share_link(p_token text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_link public.roadmap_share_links;
  v_uid  uuid := auth.uid();
begin
  if v_uid is null then
    return null;
  end if;

  select * into v_link
  from public.roadmap_share_links
  where token = p_token and revoked_at is null
  limit 1;

  if v_link.id is null then
    return null;
  end if;

  -- The owner opening their own link is a no-op (they already have full access).
  if exists (select 1 from public.roadmaps r where r.id = v_link.roadmap_id and r.user_id = v_uid) then
    return v_link.roadmap_id;
  end if;

  insert into public.roadmap_collaborators (roadmap_id, user_id, invited_by, role)
  values (v_link.roadmap_id, v_uid, v_link.created_by, v_link.role)
  on conflict (roadmap_id, user_id) do update
    set role = case
      when v_link.role = 'editor' then 'editor'   -- upgrade proposer → editor
      else roadmap_collaborators.role              -- otherwise keep existing
    end;

  return v_link.roadmap_id;
end;
$$;

grant execute on function public.claim_share_link(text) to authenticated;
