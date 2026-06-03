// cloud-sync.js — wraps the OSS engine for cloud-backed mode.
//
// 1. Reads the roadmap id from `location.hash` (e.g. `#abc-123`).
// 2. Auth-gates: redirects to / if not signed in.
// 3. Fetches the roadmap from Supabase and feeds it into state.replaceAll.
// 4. Switches state to "memory" mode so the engine stops writing to localStorage.
// 5. Hooks setOnPersist for debounced updates back to Supabase.
// 6. Mirrors the OSS title edits to the `title` column.
//
// Runs AFTER the engine init (engine self-mounts on DOMContentLoaded), so we
// override its state in a microtask once everything is loaded.
(async function () {
  // The engine init is wrapped in DOMContentLoaded too — defer to next tick to
  // make sure window.Roadbook is fully wired before we touch anything.
  await new Promise((r) => (document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", r, { once: true })
    : setTimeout(r, 0)));
  // One extra microtask so the engine's own DOMContentLoaded init runs first.
  await new Promise((r) => setTimeout(r, 0));

  if (!window.RoadbookAuth || !window.RoadbookAPI || !window.Roadbook?.state) {
    console.error("Roadbook cloud: missing dependencies");
    return;
  }

  const localMode = window.RoadbookAuth.isLocalMode && window.RoadbookAuth.isLocalMode();
  if (!localMode) {
    const sb = window.RoadbookAuth.getClient();
    if (!sb) {
      location.href = "/";
      return;
    }
  }

  // Auth gate
  const session = await window.RoadbookAuth.requireAuth();
  if (!session) return;
  const user = session.user;

  // Shell user avatar
  const avatar = document.getElementById("shellAvatar");
  if (avatar && user.user_metadata?.avatar_url) {
    avatar.style.backgroundImage = `url(${user.user_metadata.avatar_url})`;
  }

  // Roadmap id from hash
  const roadmapId = (location.hash || "").replace(/^#/, "").trim();
  if (!roadmapId) {
    location.href = "/app.html";
    return;
  }

  // Hide the first-run template overlay that the OSS init may have queued
  const tplOverlay = document.getElementById("templateOverlay");
  if (tplOverlay) tplOverlay.classList.remove("show");

  // Switch the engine into memory mode
  window.Roadbook.state.setStorageMode("memory");

  // Load the roadmap
  setSaveStatus("loading", "Loading…");
  const row = await window.RoadbookAPI.get(roadmapId);
  if (!row) {
    alert("Roadmap not found, or you don't have access.");
    location.href = "/app.html";
    return;
  }

  // Adopt the data
  try {
    if (row.data) {
      // Ensure the title in `data.title` matches the row title — the engine
      // shows `state.title` in the H1.
      const payload = row.data;
      if (row.title) payload.title = row.title;
      window.Roadbook.state.replaceAll(payload);
    } else {
      // Fresh row with no JSON — seed defaults via blank
      const blank = (window.ROADBOOK_TEMPLATES || {}).blank;
      if (blank) {
        blank.title = row.title || "Untitled";
        window.Roadbook.state.replaceAll(blank);
      }
    }
  } catch (err) {
    console.error("Failed to load roadmap payload:", err);
  }
  // Re-render with the loaded data
  window.Roadbook.app.fullRender();

  // Track the row's updated_at for the clobber guard (optimistic concurrency).
  // Every successful save refreshes it; a stale value on save = someone else
  // edited in the meantime.
  let lastUpdatedAt = row.updated_at || null;

  // ----- Role detection (Cut A + editor role) -----
  // Owner: full edit, unchanged. Collaborators have a role:
  //   'editor'   → full edit (direct mutations, autosave, undo/redo)
  //   'proposer' → propose-and-approve (mutations blocked, become proposals)
  // canEdit collapses owner + editor into the same editing path.
  const isOwner = row.user_id === user.id;
  let collabRole = null;
  if (!isOwner) {
    collabRole = await window.RoadbookAPI.myRole(roadmapId);
  }
  const canEdit = isOwner || collabRole === "editor";
  const role = isOwner ? "owner" : (collabRole || "collaborator");

  // Expose context for collaboration.js (share modal, comments panel) and
  // for any future UI code that needs to branch on role.
  window.RoadbookCollab = {
    roadmapId,
    role,
    isOwner,
    isCollaborator: !isOwner,
    canEdit,
    ownerId: row.user_id,
    currentUser: user
  };
  // Notify collaboration.js (which may already be waiting) and any future
  // listeners. The CustomEvent fires once the context is fully populated.
  document.dispatchEvent(new CustomEvent("roadbook:collab-ready", { detail: window.RoadbookCollab }));

  if (!canEdit) {
    // Proposers: block any mutation that goes through state.commit
    // directly (modal saves, title edits, year changes, etc.). Drag and
    // resize actions are intercepted earlier by setOnDropIntent below and
    // turned into proposals; they never reach state.commit at all.
    window.Roadbook.state.setCanCommit(() => false);
    setSaveStatus("readonly", "Read-only · changes go to owner");

    // Disable undo/redo — collaborators have no history to undo (their
    // drags become proposals, never commits). Pressing Cmd+Z would pop a
    // stale state and corrupt the view.
    const noop = () => false;
    window.Roadbook.state.undo = noop;
    window.Roadbook.state.redo = noop;
    // Mark body so we can hide the undo/redo buttons via CSS
    document.body.classList.add("collab-mode");

    // The drag-intent handler is wired in collaboration.js, where we have
    // direct access to the pendingProposals array and the paint pipeline.
    // That avoids the round-trip flicker: we add an optimistic local
    // proposal on drop, paint immediately, and reconcile with the real
    // row when the API responds.
  } else {
    setSaveStatus("saved", "Saved");
  }

  // ----- Debounced sync to Supabase on any state change (owner only) -----
  const DEBOUNCE_MS = 800;
  let pending = null;
  let inflight = false;
  let dirty = false;

  function schedule() {
    dirty = true;
    setSaveStatus("dirty", "Saving…");
    if (pending) clearTimeout(pending);
    pending = setTimeout(flush, DEBOUNCE_MS);
  }

  async function flush() {
    if (inflight) return; // a save is in progress; next change will reschedule on save complete
    if (!dirty) return;
    inflight = true;
    dirty = false;
    setSaveStatus("saving", "Saving…");
    const payload = window.Roadbook.state.exportJSON();
    const title = payload.title || "Untitled";
    const updated = await window.RoadbookAPI.update(roadmapId, { title, data: payload }, lastUpdatedAt);
    inflight = false;
    if (updated && updated.conflict) {
      // Someone else saved since we loaded. Don't overwrite silently.
      setSaveStatus("error", "Conflict — another session edited this");
      handleConflict();
      return;
    }
    if (updated) {
      lastUpdatedAt = updated.updated_at || lastUpdatedAt;
      setSaveStatus("saved", "Saved");
      // If another change came in while we were saving, kick another flush.
      if (dirty) schedule();
    } else {
      setSaveStatus("error", "Save failed — will retry");
      // Auto-retry once after 2s
      setTimeout(() => { if (dirty) schedule(); else { dirty = true; schedule(); } }, 2000);
    }
  }

  // Clobber-guard resolution. The roadmap saves as one blob, so a concurrent
  // save can't be auto-merged — we let the user choose: reload and take
  // theirs (losing the last debounced edit), or keep mine and overwrite.
  function handleConflict() {
    const reload = confirm(
      "This roadmap was changed in another session.\n\n" +
      "OK — reload and get the latest version (your last few unsaved edits are lost).\n" +
      "Cancel — keep your version and overwrite theirs on the next save."
    );
    if (reload) {
      location.reload();
    } else {
      // User chose to overwrite — drop the guard for the next save, then
      // re-arm it once that save returns a fresh updated_at.
      lastUpdatedAt = null;
      dirty = true;
      schedule();
    }
  }

  if (canEdit) {
    // Flush on page unload (best-effort) — owner + editor collaborators
    window.addEventListener("beforeunload", () => { if (dirty && !inflight) flush(); });
    window.Roadbook.state.setOnPersist(schedule);
  }

  // ----- Save indicator helpers -----
  function setSaveStatus(kind, label) {
    const pill = document.getElementById("savePill");
    const text = document.getElementById("savePillLabel");
    if (!pill || !text) return;
    pill.classList.remove("saving", "saved", "dirty", "error", "loading", "readonly");
    pill.classList.add(kind);
    text.textContent = label;
  }
})();
