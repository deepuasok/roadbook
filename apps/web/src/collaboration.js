// collaboration.js — share modal, comments panel, comment badges.
// Loaded only by the cloud editor build. Relies on window.RoadbookCollab
// being populated by cloud-sync.js (role + roadmapId + currentUser).
(async function () {
  // Wait for DOMContentLoaded so all elements are in the DOM.
  await new Promise((r) => (document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", r, { once: true })
    : setTimeout(r, 0)));
  // Wait for cloud-sync to publish RoadbookCollab — either via the explicit
  // CustomEvent it dispatches when ready, or by polling as a fallback (in
  // case the event already fired before this handler attached).
  if (!window.RoadbookCollab) {
    await new Promise((resolve) => {
      let done = false;
      const fire = () => { if (!done) { done = true; resolve(); } };
      document.addEventListener("roadbook:collab-ready", fire, { once: true });
      // Fallback: poll every 100ms up to 15 seconds in case the event fired
      // before this listener was attached (or never fires due to an error
      // earlier in cloud-sync.js).
      let elapsed = 0;
      const iv = setInterval(() => {
        elapsed += 100;
        if (window.RoadbookCollab) { clearInterval(iv); fire(); }
        else if (elapsed >= 15000) { clearInterval(iv); fire(); }
      }, 100);
    });
  }
  if (!window.RoadbookCollab || !window.RoadbookAPI) {
    console.warn("[collab] RoadbookCollab or RoadbookAPI missing — collaboration UI not initializing");
    return;
  }

  const ctx = window.RoadbookCollab;
  const { roadmapId, isOwner, currentUser } = ctx;

  // ----- Toast -----
  let toastEl = null;
  function toast(msg, error) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "collab-toast";
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.toggle("error", !!error);
    toastEl.classList.add("show");
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.remove("show"), 2200);
  }

  // ----- User display helpers -----
  function fmtTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const now = Date.now();
    const diff = (now - d.getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return Math.floor(diff / 60) + "m ago";
    if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + "d ago";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function shortId(id) {
    return (id || "").slice(0, 8);
  }

  // Resolve a user_id to a display name. Auth.users isn't directly queryable
  // by the client, but the current user is known. Collaborator rows in the
  // share list will show shortened IDs for others (Cut B can add a /me-style
  // endpoint or a public users view). For comments where the author is the
  // current user, we show "You".
  function nameForUser(userId) {
    if (!userId) return "Someone";
    if (currentUser && userId === currentUser.id) return "You";
    return "User " + shortId(userId);
  }

  // 2-letter monogram for a user. Uses real name when we have it (current
  // user), falls back to deterministic UUID prefix otherwise.
  function monogramForUser(userId) {
    if (!userId) return "??";
    if (currentUser && userId === currentUser.id) {
      const name = currentUser.user_metadata?.full_name || currentUser.email || "Me";
      const parts = String(name).trim().split(/\s+/).filter(Boolean);
      if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
      return (parts[0] || "M").slice(0, 2).toUpperCase();
    }
    return userId.replace(/-/g, "").slice(0, 2).toUpperCase();
  }

  // Date helpers for ghost positioning. The engine uses CSS custom
  // properties --start-day / --span-days / --row + the lane-body's
  // --total-days. We just compute the same.
  function dayOfYear(iso) {
    if (!iso) return 1;
    return window.Roadbook?.dates?.dayOfYear ? window.Roadbook.dates.dayOfYear(iso) : 1;
  }
  function yearFromIso(iso) { return (iso || "").slice(0, 4); }
  function activeYearStr() {
    return window.Roadbook?.state?.get?.()?.activeYear || "2026";
  }
  function totalDaysForYear(yearStr) {
    const y = parseInt(yearStr, 10);
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365;
  }
  function fmtDateShort(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  // ============================================================
  //  SHARE MODAL (owner-only)
  // ============================================================
  // Renamed from "shareBtn" to "inviteBtn" because the engine's existing
  // Share dropdown also uses id="shareBtn" — duplicate IDs were causing
  // getElementById to return the wrong element and bind handlers to the
  // wrong button. Labeling this "Invite" also makes its purpose clearer
  // alongside the engine's Share (which exports to PNG/SVG/link).
  const shareBtn = document.getElementById("inviteBtn");
  const shareOverlay = document.getElementById("shareOverlay");
  const inviteEmail = document.getElementById("inviteEmail");
  const inviteSend = document.getElementById("inviteSend");
  const inviteError = document.getElementById("inviteError");
  const collabList = document.getElementById("collabList");
  const shareClose = document.getElementById("shareClose");

  if (isOwner && shareBtn) shareBtn.hidden = false;

  function openShareModal() {
    if (!shareOverlay) return;
    shareOverlay.hidden = false;
    shareOverlay.classList.add("show");
    inviteEmail.value = "";
    inviteError.textContent = "";
    refreshCollabList();
    setTimeout(() => inviteEmail.focus(), 50);
  }
  function closeShareModal() {
    if (!shareOverlay) return;
    shareOverlay.classList.remove("show");
    shareOverlay.hidden = true;
  }

  if (shareBtn) shareBtn.addEventListener("click", openShareModal);
  if (shareClose) shareClose.addEventListener("click", closeShareModal);
  if (shareOverlay) shareOverlay.addEventListener("click", (e) => {
    if (e.target === shareOverlay) closeShareModal();
  });

  async function refreshCollabList() {
    collabList.innerHTML = '<div class="collab-empty">Loading…</div>';
    const [collabs, invites] = await Promise.all([
      window.RoadbookAPI.listCollaborators(roadmapId),
      window.RoadbookAPI.listInvitations(roadmapId)
    ]);
    collabList.innerHTML = "";
    if (collabs.length === 0 && invites.length === 0) {
      collabList.innerHTML = '<div class="collab-empty">No one else has access yet.</div>';
      return;
    }
    for (const c of collabs) {
      const row = document.createElement("div");
      row.className = "collab-row";
      row.innerHTML = `
        <div class="who">
          <span class="name"></span>
          <small></small>
        </div>
        <span class="status">Active</span>
        <button class="collab-revoke" type="button">Remove</button>
      `;
      row.querySelector(".name").textContent = nameForUser(c.user_id);
      row.querySelector("small").textContent = "Joined " + fmtTime(c.invited_at);
      row.querySelector("button").addEventListener("click", async () => {
        if (!confirm("Remove this collaborator's access?")) return;
        const ok = await window.RoadbookAPI.removeCollaborator(c.id);
        if (ok) { toast("Removed"); refreshCollabList(); }
        else toast("Could not remove", true);
      });
      collabList.appendChild(row);
    }
    for (const inv of invites) {
      const row = document.createElement("div");
      row.className = "collab-row";
      row.innerHTML = `
        <div class="who">
          <span class="email"></span>
          <small>Invited ${fmtTime(inv.invited_at)}</small>
        </div>
        <span class="status pending">Pending</span>
        <button class="collab-revoke" type="button">Cancel</button>
      `;
      row.querySelector(".email").textContent = inv.invitee_email;
      row.querySelector("button").addEventListener("click", async () => {
        const ok = await window.RoadbookAPI.cancelInvitation(inv.id);
        if (ok) { toast("Invite cancelled"); refreshCollabList(); }
      });
      collabList.appendChild(row);
    }
  }

  if (inviteSend) {
    inviteSend.addEventListener("click", async () => {
      inviteError.textContent = "";
      const email = inviteEmail.value.trim();
      if (!email) { inviteError.textContent = "Enter an email."; return; }
      inviteSend.disabled = true;
      const result = await window.RoadbookAPI.inviteCollaborator(roadmapId, email);
      inviteSend.disabled = false;
      if (result.error) { inviteError.textContent = result.error; return; }
      inviteEmail.value = "";
      toast("Invite sent");
      refreshCollabList();
    });
  }
  if (inviteEmail) inviteEmail.addEventListener("keydown", (e) => {
    if (e.key === "Enter") inviteSend.click();
  });

  // ============================================================
  //  COMMENTS PANEL
  // ============================================================
  const commentsPanel = document.getElementById("commentsPanel");
  const commentsTitle = document.getElementById("commentsTitle");
  const commentsList = document.getElementById("commentsList");
  const commentInput = document.getElementById("commentInput");
  const commentSend = document.getElementById("commentSend");
  const commentsClose = document.getElementById("commentsClose");
  let currentItemId = null;

  async function openCommentsPanel(itemId) {
    if (!commentsPanel) return;
    currentItemId = itemId;
    // Title from engine state
    let label = "Item";
    try {
      const it = window.Roadbook?.state?.findItem?.(itemId);
      if (it && it.title) label = it.title;
    } catch (_) { /* ignore */ }
    commentsTitle.textContent = label;
    commentsList.innerHTML = '<div class="comments-empty">Loading…</div>';
    commentInput.value = "";
    commentsPanel.classList.add("open");
    commentsPanel.setAttribute("aria-hidden", "false");
    await refreshComments();
    setTimeout(() => commentInput.focus(), 220);
  }
  function closeCommentsPanel() {
    if (!commentsPanel) return;
    commentsPanel.classList.remove("open");
    commentsPanel.setAttribute("aria-hidden", "true");
    currentItemId = null;
  }
  if (commentsClose) commentsClose.addEventListener("click", closeCommentsPanel);

  async function refreshComments() {
    if (!currentItemId) return;
    const list = await window.RoadbookAPI.listComments(roadmapId, currentItemId);
    if (list.length === 0) {
      commentsList.innerHTML = '<div class="comments-empty">No comments yet. Be the first.</div>';
      return;
    }
    commentsList.innerHTML = "";
    for (const c of list) {
      const row = document.createElement("div");
      row.className = "comment" + (c.resolved_at ? " resolved" : "");
      row.innerHTML = `
        <div class="comment-meta">
          <span class="comment-author"></span>
          <span>·</span>
          <span class="when"></span>
          ${c.resolved_at ? '<span>·</span><span>Resolved</span>' : ""}
        </div>
        <div class="comment-body"></div>
        <div class="comment-actions"></div>
      `;
      row.querySelector(".comment-author").textContent = nameForUser(c.author_id);
      row.querySelector(".when").textContent = fmtTime(c.created_at);
      row.querySelector(".comment-body").textContent = c.body;
      const actions = row.querySelector(".comment-actions");
      // Resolve / Unresolve — own comment or owner can resolve
      const canResolve = c.author_id === currentUser.id || isOwner;
      if (canResolve) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = c.resolved_at ? "Reopen" : "Resolve";
        b.addEventListener("click", async () => {
          const fn = c.resolved_at ? "unresolveComment" : "resolveComment";
          await window.RoadbookAPI[fn](c.id);
          refreshComments();
          refreshBadges();
        });
        actions.appendChild(b);
      }
      commentsList.appendChild(row);
    }
  }

  if (commentSend) {
    commentSend.addEventListener("click", async () => {
      if (!currentItemId) return;
      const body = commentInput.value.trim();
      if (!body) return;
      commentSend.disabled = true;
      const added = await window.RoadbookAPI.addComment(roadmapId, currentItemId, body);
      commentSend.disabled = false;
      if (!added) { toast("Could not add comment", true); return; }
      commentInput.value = "";
      refreshComments();
      refreshBadges();
    });
  }

  // ============================================================
  //  PROPOSAL GHOSTS (Cut B — update-item moves and resizes)
  // ============================================================
  // Render every pending update-item proposal as a dotted ghost card in
  // the proposed lane body. Owners see all proposals; collaborators only
  // see their own (which is also enforced by RLS).
  let pendingProposals = [];
  let openPopover = null;

  function closePopover() {
    if (openPopover) {
      openPopover.remove();
      openPopover = null;
    }
  }

  async function refreshProposals() {
    pendingProposals = await window.RoadbookAPI.listProposals(roadmapId, "pending");
    paintProposalGhosts();
  }

  // Two distinct rendering modes:
  //   - Owner: render every pending update-item proposal as a dotted ghost
  //     card at the proposed position; the canonical item stays in place.
  //     Click the ghost → approval popover.
  //   - Collaborator: for their OWN proposals, mutate the canonical item's
  //     card (move/resize via CSS variables, reparent to new lane) so the
  //     roadmap reads as if the change were already applied, marked with
  //     a "Pending" badge. Click the pending card → cancel popover.
  function paintProposalGhosts() {
    // Always clear stale ghosts and pending-mine state first
    document.querySelectorAll(".proposal-ghost").forEach((g) => g.remove());
    document.querySelectorAll(".card.pending-mine").forEach((c) => {
      c.classList.remove("pending-mine");
      delete c.dataset.proposalId;
    });

    const activeYear = activeYearStr();
    const totalDays = totalDaysForYear(activeYear);

    for (const p of pendingProposals) {
      if (p.kind !== "update-item") continue;
      const payload = p.payload || {};
      if (!payload.startDate || !payload.endDate || !payload.laneId) continue;
      if (yearFromIso(payload.startDate) !== activeYear) continue;

      const startDay = dayOfYear(payload.startDate);
      const endDay = dayOfYear(payload.endDate);
      const spanDays = Math.max(1, endDay - startDay + 1);
      const row = payload.row || 0;

      // Branch on author identity
      const mineOwnProposal = (!isOwner && p.author_id === currentUser.id);

      if (mineOwnProposal) {
        // Move/resize the canonical card to the proposed position.
        const card = document.querySelector(`.card[data-id="${p.target_id}"]`);
        if (!card) continue;
        card.style.setProperty("--start-day", startDay);
        card.style.setProperty("--span-days", spanDays);
        card.style.setProperty("--row", row);
        // Reparent if lane changed
        const currentBody = card.parentElement;
        const wantedBody = document.querySelector(`.lane-body[data-lane="${payload.laneId}"]`);
        if (wantedBody && currentBody !== wantedBody) wantedBody.appendChild(card);
        card.classList.add("pending-mine");
        card.dataset.proposalId = p.id;
      } else if (isOwner) {
        // Render a dotted ghost at the proposed position for owner review
        const body = document.querySelector(`.lane-body[data-lane="${payload.laneId}"]`);
        if (!body) continue;

        const ghost = document.createElement("div");
        ghost.className = "proposal-ghost";
        ghost.style.setProperty("--start-day", startDay);
        ghost.style.setProperty("--span-days", spanDays);
        ghost.style.setProperty("--row", row);
        ghost.style.setProperty("--total-days", totalDays);
        ghost.dataset.proposalId = p.id;

        let title = "Suggested change";
        try {
          const it = window.Roadbook?.state?.findItem?.(p.target_id);
          if (it && it.title) title = it.title;
        } catch (_) { /* ignore */ }

        ghost.innerHTML = `
          <span class="ghost-title"></span>
          <span class="ghost-monogram"></span>
        `;
        ghost.querySelector(".ghost-title").textContent = title;
        ghost.querySelector(".ghost-monogram").textContent = monogramForUser(p.author_id);
        ghost.title = `Proposal by ${nameForUser(p.author_id)}: ${fmtDateShort(payload.startDate)} - ${fmtDateShort(payload.endDate)}`;
        ghost.addEventListener("click", (e) => {
          e.stopPropagation();
          openApprovalPopover(p, ghost);
        });
        body.appendChild(ghost);
      }
      // Collaborator viewing someone ELSE's proposal: don't render anything
      // (shouldn't happen — RLS lets them only see their own + owner's, and
      // owner doesn't make proposals — but harmless either way).
    }

    // No extra click handlers needed on pending-mine cards — the engine's
    // existing pointerup handler calls window.Roadbook.modal.open(itemId),
    // which we've overridden above to route pending-mine clicks to
    // openCancelPopover.
  }

  function openApprovalPopover(proposal, ghostEl) {
    closePopover();
    const payload = proposal.payload || {};
    const base = proposal.base_snapshot || {};
    const item = window.Roadbook?.state?.findItem?.(proposal.target_id);

    // Conflict detection: if the current item state differs from base_snapshot,
    // the owner has already changed it since the proposal was made.
    let conflict = false;
    if (item && base) {
      conflict = (
        item.startDate !== base.startDate ||
        item.endDate !== base.endDate ||
        item.laneId !== base.laneId ||
        item.row !== base.row
      );
    }

    // Build delta description
    const deltaParts = [];
    if (item) {
      if (payload.startDate !== item.startDate)
        deltaParts.push(`Start: ${fmtDateShort(item.startDate)} → ${fmtDateShort(payload.startDate)}`);
      if (payload.endDate !== item.endDate)
        deltaParts.push(`End: ${fmtDateShort(item.endDate)} → ${fmtDateShort(payload.endDate)}`);
      if (payload.laneId !== item.laneId) {
        const oldLane = window.Roadbook?.state?.findLane?.(item.laneId)?.name || item.laneId;
        const newLane = window.Roadbook?.state?.findLane?.(payload.laneId)?.name || payload.laneId;
        deltaParts.push(`Lane: ${oldLane} → ${newLane}`);
      }
    }
    const deltaText = deltaParts.join("\n") || "No visible changes";

    const pop = document.createElement("div");
    pop.className = "approval-popover";
    pop.innerHTML = `
      <div class="ap-title">
        <span class="ghost-monogram"></span>
        <span class="ap-name"></span>
      </div>
      <div class="ap-detail">suggests this change to <strong class="ap-item-title"></strong></div>
      <div class="ap-delta"></div>
      ${conflict ? '<div class="ap-warning">This item has changed since the proposal was made. Approving will overwrite your edits.</div>' : ''}
      <div class="ap-actions">
        <button class="ap-reject" type="button">Reject</button>
        <button class="ap-approve" type="button">${conflict ? "Approve anyway" : "Approve"}</button>
      </div>
    `;
    pop.querySelector(".ap-name").textContent = nameForUser(proposal.author_id);
    pop.querySelector(".ghost-monogram").textContent = monogramForUser(proposal.author_id);
    pop.querySelector(".ap-item-title").textContent = item?.title || proposal.target_id;
    pop.querySelector(".ap-delta").textContent = deltaText;

    // Position near the ghost
    document.body.appendChild(pop);
    const ghostRect = ghostEl.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();
    let top = ghostRect.bottom + 8 + window.scrollY;
    let left = ghostRect.left + window.scrollX;
    // Clamp horizontally so it doesn't overflow the viewport
    const maxLeft = window.innerWidth - popRect.width - 12;
    if (left > maxLeft) left = maxLeft;
    if (left < 12) left = 12;
    // If there's no room below, flip above
    if (top + popRect.height > window.innerHeight + window.scrollY - 12) {
      top = ghostRect.top + window.scrollY - popRect.height - 8;
    }
    pop.style.top = `${top}px`;
    pop.style.left = `${left}px`;

    openPopover = pop;

    pop.querySelector(".ap-approve").addEventListener("click", async () => {
      if (!item) { toast("Item no longer exists", true); pop.remove(); openPopover = null; refreshProposals(); return; }
      // Apply the patch via the engine's state.commit
      window.Roadbook.state.commit(() => {
        if (payload.startDate !== undefined) item.startDate = payload.startDate;
        if (payload.endDate !== undefined) item.endDate = payload.endDate;
        if (payload.laneId !== undefined) item.laneId = payload.laneId;
        if (payload.row !== undefined) item.row = payload.row;
      });
      // Re-render the moved card
      window.Roadbook.app.fullRender();
      // Mark proposal accepted
      await window.RoadbookAPI.decideProposal(proposal.id, "accepted", null);
      toast("Approved");
      closePopover();
      refreshProposals();
    });

    pop.querySelector(".ap-reject").addEventListener("click", async () => {
      await window.RoadbookAPI.decideProposal(proposal.id, "rejected", null);
      toast("Rejected");
      closePopover();
      refreshProposals();
    });
  }

  // Cancel popover — collaborator clicks their own pending-mine card to
  // either back out the proposal or open a comments thread on the item.
  function openCancelPopover(proposal, anchorEl) {
    closePopover();
    const payload = proposal.payload || {};
    const item = window.Roadbook?.state?.findItem?.(proposal.target_id);

    const deltaParts = [];
    if (item) {
      if (payload.startDate !== item.startDate)
        deltaParts.push(`Start: ${fmtDateShort(item.startDate)} → ${fmtDateShort(payload.startDate)}`);
      if (payload.endDate !== item.endDate)
        deltaParts.push(`End: ${fmtDateShort(item.endDate)} → ${fmtDateShort(payload.endDate)}`);
      if (payload.laneId !== item.laneId) {
        const oldLane = window.Roadbook?.state?.findLane?.(item.laneId)?.name || item.laneId;
        const newLane = window.Roadbook?.state?.findLane?.(payload.laneId)?.name || payload.laneId;
        deltaParts.push(`Lane: ${oldLane} → ${newLane}`);
      }
    }
    const deltaText = deltaParts.join("\n") || "Your pending change";

    const pop = document.createElement("div");
    pop.className = "cancel-popover";
    pop.innerHTML = `
      <div class="cp-title">Pending proposal</div>
      <div class="cp-detail"></div>
      <div class="ap-delta"></div>
      <div class="cp-actions">
        <button class="cp-comment" type="button">Comment</button>
        <button class="cp-cancel" type="button">Cancel proposal</button>
      </div>
    `;
    pop.querySelector(".cp-detail").textContent = item ? `Waiting on owner approval for "${item.title}"` : "Waiting on owner approval";
    pop.querySelector(".ap-delta").textContent = deltaText;
    pop.querySelector(".ap-delta").style.cssText = "font-size:12px;background:#fafafa;border:1px solid #ececef;border-radius:6px;padding:6px 8px;margin-bottom:10px;font-family:ui-monospace,Menlo,monospace;white-space:pre-line;";

    document.body.appendChild(pop);
    const rect = anchorEl.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();
    let top = rect.bottom + 8 + window.scrollY;
    let left = rect.left + window.scrollX;
    const maxLeft = window.innerWidth - popRect.width - 12;
    if (left > maxLeft) left = maxLeft;
    if (left < 12) left = 12;
    if (top + popRect.height > window.innerHeight + window.scrollY - 12) {
      top = rect.top + window.scrollY - popRect.height - 8;
    }
    pop.style.top = `${top}px`;
    pop.style.left = `${left}px`;
    openPopover = pop;

    pop.querySelector(".cp-comment").addEventListener("click", () => {
      closePopover();
      openCommentsPanel(proposal.target_id);
    });
    pop.querySelector(".cp-cancel").addEventListener("click", async () => {
      const ok = await window.RoadbookAPI.cancelProposal(proposal.id);
      if (ok) toast("Proposal cancelled");
      closePopover();
      refreshProposals();
      // Force re-render so the card snaps back to canonical state
      if (window.Roadbook?.app?.fullRender) window.Roadbook.app.fullRender();
    });
  }

  // Close popover on outside click (both approval and cancel variants)
  document.addEventListener("click", (e) => {
    if (!openPopover) return;
    if (e.target.closest(".approval-popover")) return;
    if (e.target.closest(".cancel-popover")) return;
    if (e.target.closest(".proposal-ghost")) return;
    if (e.target.closest(".card.pending-mine")) return;
    closePopover();
  });

  // Re-paint proposals on engine re-renders (covers fullRender + year switch)
  // We already have a MutationObserver below for badges; reuse it for ghosts.

  // Kick off initial proposal fetch.
  await refreshProposals();

  // ============================================================
  //  COMMENT BADGES on item tiles
  // ============================================================
  // The engine renders item cards with data-id=itemId. We paint a small
  // badge after every render. Re-paint after engine mutations via a
  // mutation-observer on the lanes container (covers add/move/edit).
  let badgeCounts = {};

  async function refreshBadges() {
    badgeCounts = await window.RoadbookAPI.commentCounts(roadmapId);
    paintBadges();
  }

  function paintBadges() {
    document.querySelectorAll(".card[data-id]").forEach((card) => {
      const id = card.getAttribute("data-id");
      const existing = card.querySelector(".comment-badge");
      if (existing) existing.remove();
      const counts = badgeCounts[id];
      if (!counts || counts.total === 0) return;
      const badge = document.createElement("button");
      badge.type = "button";
      badge.className = "comment-badge" + (counts.open > 0 ? " has-open" : "");
      badge.innerHTML = `
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5a2 2 0 012-2h6a2 2 0 012 2v4a2 2 0 01-2 2H6l-3 2.5V5z"/></svg>
        <span></span>
      `;
      badge.querySelector("span").textContent = counts.open > 0 ? counts.open : counts.total;
      badge.title = counts.open > 0
        ? `${counts.open} open · ${counts.total} total`
        : `${counts.total} resolved`;
      badge.addEventListener("click", (e) => {
        e.stopPropagation();
        openCommentsPanel(id);
      });
      card.appendChild(badge);
    });
  }

  // Observe DOM for engine re-renders (full + incremental). Re-paint badges
  // AND proposal ghosts. The observer disconnects during paint to avoid an
  // infinite loop — our own DOM writes would otherwise re-trigger it
  // immediately, freezing the page.
  const stageRoot = document.getElementById("lanes") || document.querySelector(".page") || document.body;
  let repaintTimer = null;
  function scheduleRepaint() {
    if (repaintTimer) return;
    repaintTimer = setTimeout(() => {
      repaintTimer = null;
      try {
        mo.disconnect();
        paintBadges();
        paintProposalGhosts();
      } finally {
        // Re-attach after this microtask so our own mutations don't refire it
        Promise.resolve().then(() => mo.observe(stageRoot, { childList: true, subtree: true }));
      }
    }, 32);
  }
  const mo = new MutationObserver(scheduleRepaint);
  mo.observe(stageRoot, { childList: true, subtree: true });

  // Kick off initial badge fetch.
  await refreshBadges();

  // ============================================================
  //  CLICK-OVERRIDE for collaborators
  // ============================================================
  // For collaborators clicking a tile:
  //   - If the tile is one of THEIR pending-mine cards → cancel popover
  //   - Otherwise → comments panel (instead of the engine edit modal)
  // Owners get the engine edit modal as usual; ghost click → approval popover.
  if (!isOwner && window.Roadbook?.modal?.open) {
    const originalOpen = window.Roadbook.modal.open.bind(window.Roadbook.modal);
    window.Roadbook.modal.open = function (itemId) {
      const card = document.querySelector(`.card[data-id="${itemId}"]`);
      if (card && card.classList.contains("pending-mine")) {
        const proposalId = card.dataset.proposalId;
        const proposal = pendingProposals.find((p) => p.id === proposalId);
        if (proposal) { openCancelPopover(proposal, card); return; }
      }
      openCommentsPanel(itemId);
    };
    window.Roadbook.modal._originalOpen = originalOpen;
  }

  // Expose a manual opener so the engine or future code can invoke comments.
  window.RoadbookCollab.openComments = openCommentsPanel;
  window.RoadbookCollab.openShare = openShareModal;
  window.RoadbookCollab.refreshBadges = refreshBadges;
  window.RoadbookCollab.refreshProposals = refreshProposals;
  window.RoadbookCollab.toast = toast;

  // Close panels on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (openPopover) closePopover();
      if (commentsPanel.classList.contains("open")) closeCommentsPanel();
      if (shareOverlay && shareOverlay.classList.contains("show")) closeShareModal();
    }
  });
})();
