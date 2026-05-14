// CRUD over the `roadmaps` Supabase table. All requests go through RLS so the
// auth.uid() implicitly scopes results to the signed-in user.
//
// Local dev mode (no Supabase config): roadmaps are persisted in
// localStorage under "roadbook:local:roadmaps" with the same shape.
(function () {
  const LS_KEY = "roadbook:local:roadmaps";
  function sb() { return window.RoadbookAuth.getClient(); }
  function isLocal() { return window.RoadbookAuth.isLocalMode && window.RoadbookAuth.isLocalMode(); }

  function lsRead() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); }
    catch { return []; }
  }
  function lsWrite(rows) { localStorage.setItem(LS_KEY, JSON.stringify(rows)); }
  function lsId() { return "local-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

  async function list() {
    if (isLocal()) {
      return lsRead().slice().sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
    }
    const client = sb();
    if (!client) return [];
    // RLS already scopes this to rows owned by the current user, but selecting
    // user_id explicitly is useful if we ever filter client-side.
    const { data, error } = await client
      .from("roadmaps")
      .select("id, title, data, user_id, created_at, updated_at")
      .order("updated_at", { ascending: false });
    if (error) { console.error(error); return []; }
    return data || [];
  }

  async function get(id) {
    if (isLocal()) return lsRead().find((r) => r.id === id) || null;
    const client = sb();
    if (!client) return null;
    // user_id is required so cloud-sync.js can determine owner vs collaborator.
    const { data, error } = await client
      .from("roadmaps")
      .select("id, title, data, user_id, created_at, updated_at")
      .eq("id", id)
      .maybeSingle();
    if (error) { console.error(error); return null; }
    return data;
  }

  async function create({ title, data }) {
    if (isLocal()) {
      const now = new Date().toISOString();
      const row = {
        id: lsId(),
        title: title || "Untitled roadbook",
        data: data || null,
        created_at: now,
        updated_at: now
      };
      const rows = lsRead();
      rows.push(row);
      lsWrite(rows);
      return row;
    }
    const client = sb();
    if (!client) return null;
    const user = await window.RoadbookAuth.getUser();
    if (!user) return null;
    const payload = {
      user_id: user.id,
      title: title || "Untitled roadbook",
      data: data || null
    };
    const { data: row, error } = await client
      .from("roadmaps")
      .insert(payload)
      .select("id, title, data, created_at, updated_at")
      .single();
    if (error) { console.error(error); return null; }
    return row;
  }

  async function update(id, patch) {
    if (isLocal()) {
      const rows = lsRead();
      const i = rows.findIndex((r) => r.id === id);
      if (i < 0) return null;
      rows[i] = { ...rows[i], ...patch, updated_at: new Date().toISOString() };
      lsWrite(rows);
      return rows[i];
    }
    const client = sb();
    if (!client) return null;
    const { data, error } = await client
      .from("roadmaps")
      .update(patch)
      .eq("id", id)
      .select("id, title, data, updated_at")
      .single();
    if (error) { console.error(error); return null; }
    return data;
  }

  async function remove(id) {
    if (isLocal()) {
      const rows = lsRead().filter((r) => r.id !== id);
      lsWrite(rows);
      return true;
    }
    const client = sb();
    if (!client) return false;
    const { error } = await client.from("roadmaps").delete().eq("id", id);
    if (error) { console.error(error); return false; }
    return true;
  }

  // ---------- Shared-with-me (collaborator-side dashboard) ----------
  async function listSharedWithMe() {
    if (isLocal()) return [];  // local mode has no collaborators
    const client = sb();
    if (!client) return [];
    const user = await window.RoadbookAuth.getUser();
    if (!user) return [];
    // Fetch collaborator rows then resolve the roadmaps. RLS allows seeing
    // roadmaps the user is a collaborator on via the policy added in Cut A.
    const { data: collabs, error: ce } = await client
      .from("roadmap_collaborators")
      .select("roadmap_id, invited_at")
      .eq("user_id", user.id);
    if (ce) { console.error(ce); return []; }
    if (!collabs || collabs.length === 0) return [];
    const ids = collabs.map((c) => c.roadmap_id);
    const { data: rows, error: re } = await client
      .from("roadmaps")
      .select("id, title, data, user_id, created_at, updated_at")
      .in("id", ids)
      .order("updated_at", { ascending: false });
    if (re) { console.error(re); return []; }
    return rows || [];
  }

  // ---------- Collaborators ----------
  async function listCollaborators(roadmapId) {
    if (isLocal()) return [];
    const client = sb();
    if (!client) return [];
    const { data, error } = await client
      .from("roadmap_collaborators")
      .select("id, user_id, invited_by, invited_at")
      .eq("roadmap_id", roadmapId)
      .order("invited_at", { ascending: true });
    if (error) { console.error(error); return []; }
    return data || [];
  }

  async function listInvitations(roadmapId) {
    if (isLocal()) return [];
    const client = sb();
    if (!client) return [];
    const { data, error } = await client
      .from("roadmap_invitations")
      .select("id, invitee_email, invited_at")
      .eq("roadmap_id", roadmapId)
      .order("invited_at", { ascending: true });
    if (error) { console.error(error); return []; }
    return data || [];
  }

  // Owner inserts an invitation; the trigger immediately materializes it as a
  // collaborator row if a matching user already exists, otherwise it waits.
  async function inviteCollaborator(roadmapId, email) {
    if (isLocal()) return { error: "Collaboration requires Supabase configuration." };
    const client = sb();
    if (!client) return { error: "Not signed in." };
    const user = await window.RoadbookAuth.getUser();
    if (!user) return { error: "Not signed in." };
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@")) return { error: "Enter a valid email." };
    const { error } = await client
      .from("roadmap_invitations")
      .insert({ roadmap_id: roadmapId, invitee_email: cleanEmail, invited_by: user.id });
    if (error) {
      // Unique constraint = already invited (or already a collaborator after trigger)
      if (error.code === "23505") return { error: "Already invited or collaborating." };
      console.error(error);
      return { error: error.message };
    }
    return { ok: true };
  }

  async function removeCollaborator(collaboratorId) {
    if (isLocal()) return false;
    const client = sb();
    if (!client) return false;
    const { error } = await client.from("roadmap_collaborators").delete().eq("id", collaboratorId);
    if (error) { console.error(error); return false; }
    return true;
  }

  async function cancelInvitation(invitationId) {
    if (isLocal()) return false;
    const client = sb();
    if (!client) return false;
    const { error } = await client.from("roadmap_invitations").delete().eq("id", invitationId);
    if (error) { console.error(error); return false; }
    return true;
  }

  // ---------- Comments ----------
  async function listComments(roadmapId, itemId) {
    if (isLocal()) return [];
    const client = sb();
    if (!client) return [];
    let q = client
      .from("roadmap_comments")
      .select("id, item_id, author_id, body, created_at, resolved_at, resolved_by")
      .eq("roadmap_id", roadmapId)
      .order("created_at", { ascending: true });
    if (itemId) q = q.eq("item_id", itemId);
    const { data, error } = await q;
    if (error) { console.error(error); return []; }
    return data || [];
  }

  async function addComment(roadmapId, itemId, body) {
    if (isLocal()) return null;
    const client = sb();
    if (!client) return null;
    const user = await window.RoadbookAuth.getUser();
    if (!user) return null;
    const cleanBody = String(body || "").trim();
    if (!cleanBody) return null;
    const { data, error } = await client
      .from("roadmap_comments")
      .insert({ roadmap_id: roadmapId, item_id: itemId, author_id: user.id, body: cleanBody })
      .select("id, item_id, author_id, body, created_at, resolved_at, resolved_by")
      .single();
    if (error) { console.error(error); return null; }
    return data;
  }

  async function resolveComment(commentId) {
    if (isLocal()) return null;
    const client = sb();
    if (!client) return null;
    const user = await window.RoadbookAuth.getUser();
    if (!user) return null;
    const { data, error } = await client
      .from("roadmap_comments")
      .update({ resolved_at: new Date().toISOString(), resolved_by: user.id })
      .eq("id", commentId)
      .select("id, item_id, author_id, body, created_at, resolved_at, resolved_by")
      .single();
    if (error) { console.error(error); return null; }
    return data;
  }

  async function unresolveComment(commentId) {
    if (isLocal()) return null;
    const client = sb();
    if (!client) return null;
    const { data, error } = await client
      .from("roadmap_comments")
      .update({ resolved_at: null, resolved_by: null })
      .eq("id", commentId)
      .select("id, item_id, author_id, body, created_at, resolved_at, resolved_by")
      .single();
    if (error) { console.error(error); return null; }
    return data;
  }

  // ---------- Participant directory (owner + collaborators) ----------
  // Returns a map of user_id → { email, full_name }. Falls back to empty
  // if not signed in or local-mode. Calls the security-definer RPC so the
  // anon client can read auth.users details for this roadmap's participants.
  async function participantDirectory(roadmapId) {
    if (isLocal()) return {};
    const client = sb();
    if (!client) return {};
    const { data, error } = await client.rpc("roadmap_participant_emails", { p_roadmap_id: roadmapId });
    if (error) { console.error(error); return {}; }
    const map = {};
    for (const row of data || []) {
      map[row.user_id] = { email: row.email, full_name: row.full_name };
    }
    return map;
  }

  // ---------- Comment counts per item (for badges) ----------
  // Returns a map of item_id → { open: number, total: number } so the editor
  // can paint badges in one fetch instead of N.
  async function commentCounts(roadmapId) {
    if (isLocal()) return {};
    const client = sb();
    if (!client) return {};
    const { data, error } = await client
      .from("roadmap_comments")
      .select("item_id, resolved_at")
      .eq("roadmap_id", roadmapId);
    if (error) { console.error(error); return {}; }
    const out = {};
    for (const row of data || []) {
      const k = row.item_id;
      out[k] = out[k] || { open: 0, total: 0 };
      out[k].total += 1;
      if (!row.resolved_at) out[k].open += 1;
    }
    return out;
  }

  // ---------- Proposals (Cut B and beyond) ----------
  async function listProposals(roadmapId, status) {
    if (isLocal()) return [];
    const client = sb();
    if (!client) return [];
    let q = client
      .from("roadmap_proposals")
      .select("id, kind, target_id, author_id, payload, base_snapshot, note, status, decided_at, decided_by, decided_reason, created_at")
      .eq("roadmap_id", roadmapId)
      .order("created_at", { ascending: true });
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) { console.error(error); return []; }
    return data || [];
  }

  // Creates or updates a proposal. Coalesces: at most one pending proposal
  // per (roadmap, kind, target, author). Re-proposing on the same item
  // updates the existing row's payload/base_snapshot in place.
  async function createProposal(roadmapId, { kind, target_id, payload, base_snapshot, note }) {
    if (isLocal()) return { error: "Proposals require Supabase." };
    const client = sb();
    if (!client) return { error: "Not signed in." };
    const user = await window.RoadbookAuth.getUser();
    if (!user) return { error: "Not signed in." };
    // Try UPDATE first (matches the partial unique index on pending proposals)
    const { data: existing } = await client
      .from("roadmap_proposals")
      .select("id")
      .eq("roadmap_id", roadmapId)
      .eq("kind", kind)
      .eq("status", "pending")
      .eq("author_id", user.id)
      .eq("target_id", target_id || null)
      .maybeSingle();
    if (existing && existing.id) {
      const { data: updated, error } = await client
        .from("roadmap_proposals")
        .update({ payload, base_snapshot: base_snapshot || null, note: note || null, created_at: new Date().toISOString() })
        .eq("id", existing.id)
        .select("id, kind, target_id, author_id, payload, base_snapshot, note, status, decided_at, decided_by, decided_reason, created_at")
        .single();
      if (error) { console.error(error); return { error: error.message }; }
      return { ok: true, row: updated, updated: true };
    }
    // No existing pending — insert new
    const row = {
      roadmap_id: roadmapId,
      kind,
      target_id: target_id || null,
      author_id: user.id,
      payload,
      base_snapshot: base_snapshot || null,
      note: note || null
    };
    const { data, error } = await client
      .from("roadmap_proposals")
      .insert(row)
      .select("id, kind, target_id, author_id, payload, base_snapshot, note, status, decided_at, decided_by, decided_reason, created_at")
      .single();
    if (error) { console.error(error); return { error: error.message }; }
    return { ok: true, row: data, updated: false };
  }

  // Owner accepts or rejects. status must be "accepted" or "rejected".
  async function decideProposal(proposalId, status, reason) {
    if (isLocal()) return null;
    const client = sb();
    if (!client) return null;
    const user = await window.RoadbookAuth.getUser();
    if (!user) return null;
    const { data, error } = await client
      .from("roadmap_proposals")
      .update({
        status,
        decided_at: new Date().toISOString(),
        decided_by: user.id,
        decided_reason: reason || null
      })
      .eq("id", proposalId)
      .select("id, kind, target_id, author_id, payload, base_snapshot, note, status, decided_at, decided_by, decided_reason, created_at")
      .single();
    if (error) { console.error(error); return null; }
    return data;
  }

  // Author cancels their own pending proposal.
  async function cancelProposal(proposalId) {
    if (isLocal()) return false;
    const client = sb();
    if (!client) return false;
    const { error } = await client
      .from("roadmap_proposals")
      .delete()
      .eq("id", proposalId);
    if (error) { console.error(error); return false; }
    return true;
  }

  window.RoadbookAPI = {
    list, get, create, update, remove,
    listSharedWithMe,
    listCollaborators, listInvitations, inviteCollaborator, removeCollaborator, cancelInvitation,
    listComments, addComment, resolveComment, unresolveComment, commentCounts,
    listProposals, createProposal, decideProposal, cancelProposal,
    participantDirectory
  };
})();
