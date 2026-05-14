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

  // ----- Role detection (Cut A) -----
  // If the signed-in user is the roadmap owner, behavior is unchanged.
  // If they're a collaborator, gate every mutation and skip the autosave
  // hook entirely (RLS would reject the UPDATE anyway).
  const isOwner = row.user_id === user.id;
  const role = isOwner ? "owner" : "collaborator";

  // Expose context for collaboration.js (share modal, comments panel) and
  // for any future UI code that needs to branch on role.
  window.RoadbookCollab = {
    roadmapId,
    role,
    isOwner,
    isCollaborator: !isOwner,
    ownerId: row.user_id,
    currentUser: user
  };
  // Notify collaboration.js (which may already be waiting) and any future
  // listeners. The CustomEvent fires once the context is fully populated.
  document.dispatchEvent(new CustomEvent("roadbook:collab-ready", { detail: window.RoadbookCollab }));

  if (!isOwner) {
    // Block all engine mutations for collaborators in Cut A. Cut B/C will
    // capture intents as proposals via a richer hook.
    window.Roadbook.state.setCanCommit(() => false);
    setSaveStatus("readonly", "Read-only");
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
    const updated = await window.RoadbookAPI.update(roadmapId, { title, data: payload });
    inflight = false;
    if (updated) {
      setSaveStatus("saved", "Saved");
      // If another change came in while we were saving, kick another flush.
      if (dirty) schedule();
    } else {
      setSaveStatus("error", "Save failed — will retry");
      // Auto-retry once after 2s
      setTimeout(() => { if (dirty) schedule(); else { dirty = true; schedule(); } }, 2000);
    }
  }

  if (isOwner) {
    // Flush on page unload (best-effort) — owner only
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
