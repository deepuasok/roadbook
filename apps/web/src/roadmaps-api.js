// CRUD over the `roadmaps` Supabase table. All requests go through RLS so the
// auth.uid() implicitly scopes results to the signed-in user.
(function () {
  function sb() { return window.RoadbookAuth.getClient(); }

  async function list() {
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
    const client = sb();
    if (!client) return false;
    const { error } = await client.from("roadmaps").delete().eq("id", id);
    if (error) { console.error(error); return false; }
    return true;
  }

  window.RoadbookAPI = { list, get, create, update, remove };
})();
