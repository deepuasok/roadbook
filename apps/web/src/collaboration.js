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
  //  PROPOSALS (modal-driven flow + owner review panel)
  // ============================================================
  // Cut B v2: collaborators don't drag-to-propose. They click a tile and
  // use the same edit modal as the owner. Their Save button is labeled
  // "Propose changes" and intercepted at capture phase to build a
  // proposal payload from the form values instead of committing.
  //
  // Owners get a dedicated "Pending" button in the shell that opens a
  // side panel listing every pending proposal with Approve/Reject.
  // Items with pending proposals get a small badge inline.
  //
  // Proposals coalesce server-side via a partial unique index on
  // (roadmap, kind, target, author) where status=pending — re-proposing
  // updates the existing row instead of duplicating.
  let pendingProposals = [];
  let openPopover = null;
  let modalEditingId = null;

  function closePopover() {
    if (openPopover) {
      openPopover.remove();
      openPopover = null;
    }
  }

  function pendingForItemByAuthor(itemId, authorId) {
    return pendingProposals.find(
      (p) => p.kind === "update-item" && p.target_id === itemId && p.author_id === authorId
    );
  }

  async function refreshProposals() {
    pendingProposals = await window.RoadbookAPI.listProposals(roadmapId, "pending");
    paintPendingBadges();
    if (isOwner) renderPendingPanelContent();
  }

  // ----- Item-level "Pending" badge -----
  // Owner and collaborator both see it. Shows there's an unresolved
  // proposal on this item without revealing the proposed delta inline.
  function paintPendingBadges() {
    document.querySelectorAll(".pending-badge").forEach((b) => b.remove());
    const counts = {};
    for (const p of pendingProposals) {
      if (p.kind !== "update-item" || !p.target_id) continue;
      counts[p.target_id] = (counts[p.target_id] || 0) + 1;
    }
    for (const itemId of Object.keys(counts)) {
      const card = document.querySelector(`.card[data-id="${itemId}"]`);
      if (!card) continue;
      const badge = document.createElement("div");
      badge.className = "pending-badge";
      badge.textContent = counts[itemId] > 1 ? `${counts[itemId]} pending` : "Pending";
      badge.title = `${counts[itemId]} pending change${counts[itemId] > 1 ? "s" : ""}`;
      card.appendChild(badge);
    }
  }

  // ----- Modal interception (collaborator's Save becomes Propose) -----
  // Wrap window.Roadbook.modal.open so we know what item is being edited
  // and can customize the modal for collaborators (button label, hide
  // delete, pre-fill with pending proposal values).
  const originalModalOpen = window.Roadbook?.modal?.open;
  if (originalModalOpen) {
    window.Roadbook.modal.open = function (itemId) {
      modalEditingId = itemId;
      originalModalOpen.call(window.Roadbook.modal, itemId);
      // Defer customization so the engine's open() has finished setting form values
      Promise.resolve().then(() => customizeEditModal(itemId));
    };
  }

  function customizeEditModal(itemId) {
    const saveBtn = document.getElementById("mSave");
    const deleteBtn = document.getElementById("mDelete");
    if (!saveBtn) return;
    if (!isOwner) {
      // Collaborator: relabel save, hide delete
      saveBtn.textContent = "Propose changes";
      saveBtn.classList.add("propose-btn");
      if (deleteBtn) deleteBtn.style.display = "none";
      // If a pending proposal exists, pre-fill dates with proposed values
      const existing = pendingForItemByAuthor(itemId, currentUser.id);
      if (existing) {
        const p = existing.payload || {};
        if (p.startDate) document.getElementById("fStartDate").value = p.startDate;
        if (p.endDate) document.getElementById("fEndDate").value = p.endDate;
        if (p.title) document.getElementById("fTitle").value = p.title;
        if (typeof p.complete === "number") {
          const compInput = document.getElementById("fComplete");
          if (compInput) {
            compInput.value = p.complete;
            const valLabel = document.getElementById("fCompleteVal");
            if (valLabel) valLabel.textContent = p.complete + "%";
          }
        }
      }
    } else {
      // Owner: ensure label is back to default (in case button was hijacked)
      saveBtn.textContent = "Save";
      saveBtn.classList.remove("propose-btn");
      if (deleteBtn) deleteBtn.style.display = "";
    }
  }

  // Capture-phase click handler on the Save button. For collaborators we
  // build a proposal from the form values and upsert it; for owners we
  // step out and let the engine's bubble-phase handler do its thing.
  const mSaveBtn = document.getElementById("mSave");
  if (mSaveBtn) {
    mSaveBtn.addEventListener("click", async (e) => {
      if (isOwner) return; // let engine.save() handle it
      if (!modalEditingId) return;
      const item = window.Roadbook.state.findItem(modalEditingId);
      if (!item) return;
      // Stop the engine's save() from also running
      e.stopImmediatePropagation();
      e.preventDefault();

      const form = readModalForm(item);
      const changed = Object.keys(form).some((k) => form[k] !== item[k]);
      if (!changed) {
        if (window.Roadbook?.modal?.close) window.Roadbook.modal.close();
        modalEditingId = null;
        toast("No changes to propose");
        return;
      }

      const baseSnapshot = {
        title: item.title,
        startDate: item.startDate,
        endDate: item.endDate,
        laneId: item.laneId,
        row: item.row,
        status: item.status,
        type: item.type,
        complete: item.complete
      };
      const proposed = { ...baseSnapshot, ...form };

      // Lock the button while saving
      mSaveBtn.disabled = true;
      const result = await window.RoadbookAPI.createProposal(roadmapId, {
        kind: "update-item",
        target_id: item.id,
        payload: proposed,
        base_snapshot: baseSnapshot,
        note: null
      });
      mSaveBtn.disabled = false;

      if (result.error) { toast(result.error, true); return; }
      toast(result.updated ? "Proposal updated" : "Proposal sent");
      if (window.Roadbook?.modal?.close) window.Roadbook.modal.close();
      modalEditingId = null;
      refreshProposals();
    }, true /* capture phase — runs before engine handler */);
  }

  // Read the engine modal form into the same shape as an item record
  function readModalForm(item) {
    const dates = window.Roadbook?.dates;
    let startDate = document.getElementById("fStartDate")?.value || item.startDate;
    let endDate = document.getElementById("fEndDate")?.value || item.endDate;
    if (dates && dates.diffDays(startDate, endDate) < 0) endDate = startDate;
    return {
      title: (document.getElementById("fTitle")?.value || item.title).trim(),
      startDate,
      endDate,
      status: getChipGroupValue("fStatusGroup", item.status),
      type: getChipGroupValue("fTypeGroup", item.type),
      complete: parseInt(document.getElementById("fComplete")?.value, 10) || 0
    };
  }

  function getChipGroupValue(groupId, fallback) {
    const sel = document.querySelector(`#${groupId} .chip[aria-checked="true"]`);
    if (sel && sel.dataset.value) return sel.dataset.value;
    const sel2 = document.querySelector(`#${groupId} .chip.selected`);
    if (sel2 && sel2.dataset.value) return sel2.dataset.value;
    return fallback;
  }

  // ----- Owner: Pending Proposals side panel -----
  // Adds a "Pending (N)" button to the editor shell that toggles a side
  // panel listing every pending proposal with Approve/Reject.
  let pendingPanel = null;
  let pendingBtn = null;

  if (isOwner) {
    pendingBtn = document.createElement("button");
    pendingBtn.className = "shell-btn pending-shell-btn";
    pendingBtn.type = "button";
    pendingBtn.id = "pendingProposalsBtn";
    pendingBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h10M3 8h10M3 12h6"/></svg><span>Pending</span><span class="pending-count" id="pendingCount">0</span>';
    const inviteBtnEl = document.getElementById("inviteBtn");
    if (inviteBtnEl && inviteBtnEl.parentElement) {
      inviteBtnEl.parentElement.insertBefore(pendingBtn, inviteBtnEl);
    }

    pendingPanel = document.createElement("div");
    pendingPanel.id = "pendingPanel";
    pendingPanel.className = "pending-panel";
    pendingPanel.setAttribute("aria-hidden", "true");
    pendingPanel.innerHTML = `
      <div class="comments-head">
        <div class="comments-title">Pending proposals</div>
        <button class="comments-close" id="pendingClose" type="button" aria-label="Close">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>
        </button>
      </div>
      <div class="pending-list" id="pendingList"></div>
    `;
    document.body.appendChild(pendingPanel);

    pendingBtn.addEventListener("click", openPendingPanel);
    document.getElementById("pendingClose").addEventListener("click", closePendingPanel);
  }

  function openPendingPanel() {
    if (!pendingPanel) return;
    pendingPanel.classList.add("open");
    pendingPanel.setAttribute("aria-hidden", "false");
    renderPendingPanelContent();
  }
  function closePendingPanel() {
    if (!pendingPanel) return;
    pendingPanel.classList.remove("open");
    pendingPanel.setAttribute("aria-hidden", "true");
  }

  function renderPendingPanelContent() {
    const updateProposals = pendingProposals.filter((p) => p.kind === "update-item");
    const countEl = document.getElementById("pendingCount");
    if (countEl) countEl.textContent = updateProposals.length;
    if (pendingBtn) {
      pendingBtn.classList.toggle("empty", updateProposals.length === 0);
      pendingBtn.classList.toggle("has-pending", updateProposals.length > 0);
    }

    const listEl = document.getElementById("pendingList");
    if (!listEl) return;
    if (updateProposals.length === 0) {
      listEl.innerHTML = '<div class="comments-empty">No pending proposals.</div>';
      return;
    }
    listEl.innerHTML = "";
    for (const p of updateProposals) {
      const item = window.Roadbook?.state?.findItem?.(p.target_id);
      if (!item) continue;
      const row = document.createElement("div");
      row.className = "pending-row";
      row.innerHTML = `
        <div class="pending-row-head">
          <span class="ghost-monogram"></span>
          <span class="pending-row-name"></span>
          <span class="pending-row-time"></span>
        </div>
        <div class="pending-row-item"></div>
        <div class="pending-row-delta"></div>
        <div class="pending-row-actions">
          <button class="ap-reject" type="button">Reject</button>
          <button class="ap-approve" type="button">Approve</button>
        </div>
      `;
      row.querySelector(".ghost-monogram").textContent = monogramForUser(p.author_id);
      row.querySelector(".pending-row-name").textContent = nameForUser(p.author_id);
      row.querySelector(".pending-row-time").textContent = fmtTime(p.created_at);
      row.querySelector(".pending-row-item").textContent = "On: " + item.title;
      row.querySelector(".pending-row-delta").textContent = formatDelta(item, p.payload || {});
      row.querySelector(".ap-approve").addEventListener("click", async () => {
        // Apply the patch via the engine
        window.Roadbook.state.commit(() => {
          const payload = p.payload || {};
          Object.keys(payload).forEach((k) => {
            if (k in item) item[k] = payload[k];
          });
        });
        if (window.Roadbook?.app?.fullRender) window.Roadbook.app.fullRender();
        await window.RoadbookAPI.decideProposal(p.id, "accepted", null);
        toast("Approved");
        refreshProposals();
      });
      row.querySelector(".ap-reject").addEventListener("click", async () => {
        await window.RoadbookAPI.decideProposal(p.id, "rejected", null);
        toast("Rejected");
        refreshProposals();
      });
      listEl.appendChild(row);
    }
  }

  function formatDelta(item, payload) {
    const parts = [];
    if (payload.title && payload.title !== item.title) parts.push(`Title: "${item.title}" → "${payload.title}"`);
    if (payload.startDate && payload.startDate !== item.startDate) parts.push(`Start: ${fmtDateShort(item.startDate)} → ${fmtDateShort(payload.startDate)}`);
    if (payload.endDate && payload.endDate !== item.endDate) parts.push(`End: ${fmtDateShort(item.endDate)} → ${fmtDateShort(payload.endDate)}`);
    if (payload.status && payload.status !== item.status) parts.push(`Status: ${item.status} → ${payload.status}`);
    if (payload.type && payload.type !== item.type) parts.push(`Type: ${item.type} → ${payload.type}`);
    if (typeof payload.complete === "number" && payload.complete !== item.complete) parts.push(`Done: ${item.complete}% → ${payload.complete}%`);
    return parts.join("\n") || "(no visible field changes)";
  }
  // ----- Drag DISABLED for collaborators -----
  // Cut B v2: collaborators don't propose via drag anymore. They must
  // open the edit modal to propose changes. To avoid silent confusion,
  // we register a no-op intent handler that returns false so drag
  // attempts snap back without doing anything.
  // (The visual feedback during drag still happens — only the drop is
  //  blocked. We could fully kill drag by removing the pointerdown
  //  listeners from cards, but that's invasive on engine code.)
  if (!isOwner && window.Roadbook?.drag?.setOnDropIntent) {
    window.Roadbook.drag.setOnDropIntent(() => false);
  }

  // ----- DEAD CODE: drag-to-propose + ghost rendering + cancel popover -----
  /* eslint-disable */ if (false) { /*
  if (!isOwner && window.Roadbook?.drag?.setOnDropIntent) {
    window.Roadbook.drag.setOnDropIntent((item, kind, patch) => {
      const baseSnapshot = {
        startDate: item.startDate,
        endDate: item.endDate,
        laneId: item.laneId,
        row: item.row
      };
      const proposed = { ...baseSnapshot, ...patch };

      // 1. Optimistic local proposal so paintProposalGhosts moves the card.
      const tempId = addOptimisticProposal({
        kind: "update-item",
        target_id: item.id,
        author_id: currentUser.id,
        payload: proposed,
        base_snapshot: baseSnapshot
      });

      // 2. Engine is about to call replaceCard, which recreates the card at
      //    its (unchanged) original position. Defer paint to after that.
      Promise.resolve().then(() => {
        paintProposalGhosts();
        // Adjust lane heights to fit moved cards
        if (window.Roadbook?.app?.resizeLaneBody) {
          if (baseSnapshot.laneId) window.Roadbook.app.resizeLaneBody(baseSnapshot.laneId);
          if (proposed.laneId && proposed.laneId !== baseSnapshot.laneId)
            window.Roadbook.app.resizeLaneBody(proposed.laneId);
        }
      });

      // 3. Fire API call; reconcile when it responds.
      window.RoadbookAPI.createProposal(roadmapId, {
        kind: "update-item",
        target_id: item.id,
        payload: proposed,
        base_snapshot: baseSnapshot,
        note: null
      }).then((result) => {
        if (result.error) {
          // Roll back the optimistic update
          removeProposal(tempId);
          paintProposalGhosts();
          toast(result.error, true);
        } else {
          replaceOptimistic(tempId, result.row);
          const label = kind === "move" ? "Move suggested"
            : kind === "resize-end" ? "Resize suggested"
            : kind === "resize-start" ? "Resize suggested"
            : "Change suggested";
          toast(label);
        }
      }).catch((e) => {
        console.error("createProposal failed", e);
        removeProposal(tempId);
        paintProposalGhosts();
        toast("Could not send proposal", true);
      });

      return false; // block the engine's commit
    });
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

  */ } /* eslint-enable */
  // ----- end dead code -----

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

  // Observe DOM for engine re-renders (full + incremental). Re-paint
  // comment badges AND pending-proposal badges. The observer disconnects
  // during paint to avoid an infinite loop.
  const stageRoot = document.getElementById("lanes") || document.querySelector(".page") || document.body;
  let repaintTimer = null;
  function scheduleRepaint() {
    if (repaintTimer) return;
    repaintTimer = setTimeout(() => {
      repaintTimer = null;
      try {
        mo.disconnect();
        paintBadges();
        paintPendingBadges();
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

  // (Tile clicks now go to the engine's edit modal for both roles. The
  // collaborator's Save button is intercepted above to become Propose.
  // Comments stay accessible via the comment-count badge on each tile.)

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
