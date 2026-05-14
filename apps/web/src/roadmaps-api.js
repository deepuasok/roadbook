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
    const { data, error } = await client
      .from("roadmaps")
      .select("id, title, data, created_at, updated_at")
      .order("updated_at", { ascending: false });
    if (error) { console.error(error); return []; }
    return data || [];
  }

  async function get(id) {
    if (isLocal()) return lsRead().find((r) => r.id === id) || null;
    const client = sb();
    if (!client) return null;
    const { data, error } = await client
      .from("roadmaps")
      .select("id, title, data, created_at, updated_at")
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

  window.RoadbookAPI = { list, get, create, update, remove };
})();
