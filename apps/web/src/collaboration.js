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

  // Observe DOM for engine re-renders (full + incremental).
  const stageRoot = document.querySelector("main, .stage, body") || document.body;
  const mo = new MutationObserver(() => {
    paintBadges();
  });
  mo.observe(stageRoot, { childList: true, subtree: true });

  // Kick off initial badge fetch.
  await refreshBadges();

  // ============================================================
  //  CLICK-OVERRIDE for collaborators
  // ============================================================
  // For collaborators: clicking a tile opens the comments panel instead of
  // the edit modal. We accomplish this by wrapping window.Roadbook.modal.open.
  // Owners get the edit modal as usual; the badge they click goes through a
  // separate path that opens comments directly.
  if (!isOwner && window.Roadbook?.modal?.open) {
    const originalOpen = window.Roadbook.modal.open.bind(window.Roadbook.modal);
    window.Roadbook.modal.open = function (itemId) {
      openCommentsPanel(itemId);
    };
    // Keep the original accessible in case we ever need it
    window.Roadbook.modal._originalOpen = originalOpen;
  }

  // Expose a manual opener so the engine or future code can invoke comments.
  window.RoadbookCollab.openComments = openCommentsPanel;
  window.RoadbookCollab.openShare = openShareModal;
  window.RoadbookCollab.refreshBadges = refreshBadges;

  // Close panels on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (commentsPanel.classList.contains("open")) closeCommentsPanel();
      if (shareOverlay && shareOverlay.classList.contains("show")) closeShareModal();
    }
  });
})();
