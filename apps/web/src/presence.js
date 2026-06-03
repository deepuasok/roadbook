// presence.js — live "who's here" avatar stack (Google-Docs style).
//
// Uses Supabase Realtime Presence: everyone viewing the same roadmap joins a
// channel keyed to its id and broadcasts ephemeral { name, avatar } state.
// Nothing is persisted — presence is purely in-memory on the Realtime server,
// so this needs no database table or migration. Renders into #presenceStack
// in the editor shell. Relies on RoadbookCollab (published by cloud-sync.js).
(async function () {
  // Wait for DOM.
  await new Promise((r) => (document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", r, { once: true })
    : setTimeout(r, 0)));

  // Wait for cloud-sync to publish RoadbookCollab (same handshake as collaboration.js).
  if (!window.RoadbookCollab) {
    await new Promise((resolve) => {
      let done = false;
      const fire = () => { if (!done) { done = true; resolve(); } };
      document.addEventListener("roadbook:collab-ready", fire, { once: true });
      let elapsed = 0;
      const iv = setInterval(() => {
        elapsed += 100;
        if (window.RoadbookCollab) { clearInterval(iv); fire(); }
        else if (elapsed >= 15000) { clearInterval(iv); fire(); }
      }, 100);
    });
  }
  if (!window.RoadbookCollab || !window.RoadbookAuth) return;

  const { roadmapId, currentUser } = window.RoadbookCollab;
  // Editors only (owner + 'editor' collaborators). Proposers neither broadcast
  // their presence nor see the stack — they get a read-only/propose view.
  const canEdit = window.RoadbookCollab.canEdit != null
    ? window.RoadbookCollab.canEdit
    : window.RoadbookCollab.isOwner;
  if (!canEdit) return;

  const sb = window.RoadbookAuth.getClient && window.RoadbookAuth.getClient();
  const stack = document.getElementById("presenceStack");
  const wrap = document.getElementById("presenceWrap");
  const countEl = document.getElementById("presenceCount");
  if (!sb || !roadmapId || !currentUser || !stack) return;

  const me = {
    id: currentUser.id,
    name: currentUser.user_metadata?.full_name || currentUser.email || "Someone",
    avatar: currentUser.user_metadata?.avatar_url || "",
    email: currentUser.email || ""
  };

  function monogram(name) {
    const parts = String(name || "?").trim().split(/[\s.@]+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (parts[0] || "?").slice(0, 2).toUpperCase();
  }

  const MAX_SHOWN = 5;

  function render() {
    // presenceState() → { presenceKey: [ {meta}, ... ], ... }. One key per
    // user (we key by user id), but a user with two tabs has two entries —
    // take the first per key so each person shows once.
    const state = channel.presenceState();
    const people = Object.keys(state)
      .map((key) => (state[key] && state[key][0]) || null)
      .filter(Boolean);
    // Me first, then everyone else.
    people.sort((a, b) => (a.id === me.id ? -1 : b.id === me.id ? 1 : 0));

    stack.innerHTML = "";
    people.slice(0, MAX_SHOWN).forEach((p) => {
      const el = document.createElement("div");
      el.className = "presence-avatar" + (p.id === me.id ? " is-me" : "");
      el.title = (p.id === me.id ? p.name + " (you)" : p.name) + (p.email ? " · " + p.email : "");
      if (p.avatar) {
        el.style.backgroundImage = `url("${p.avatar}")`;
      } else {
        el.classList.add("no-img");
        el.textContent = monogram(p.name);
      }
      stack.appendChild(el);
    });
    if (people.length > MAX_SHOWN) {
      const more = document.createElement("div");
      more.className = "presence-avatar presence-more";
      more.textContent = "+" + (people.length - MAX_SHOWN);
      more.title = people.length - MAX_SHOWN + " more here";
      stack.appendChild(more);
    }
    // "N viewing" count label.
    if (countEl) countEl.textContent = people.length + " viewing";
    // Hide the whole presence widget when you're the only editor here.
    if (wrap) wrap.classList.toggle("solo", people.length <= 1);
  }

  const channel = sb.channel("presence:roadmap:" + roadmapId, {
    config: { presence: { key: currentUser.id } }
  });

  channel
    .on("presence", { event: "sync" }, render)
    .on("presence", { event: "join" }, render)
    .on("presence", { event: "leave" }, render)
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({
          id: me.id,
          name: me.name,
          avatar: me.avatar,
          email: me.email,
          online_at: new Date().toISOString()
        });
      }
    });

  window.addEventListener("beforeunload", () => {
    try { channel.untrack(); sb.removeChannel(channel); } catch (_) { /* noop */ }
  });
})();
