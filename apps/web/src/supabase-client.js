// Thin wrapper around the Supabase JS client. Reads credentials from
// window.ROADBOOK_CONFIG which is injected at build time (or via config.js).
(function () {
  function getClient() {
    if (window.__roadbookSb) return window.__roadbookSb;
    const cfg = window.ROADBOOK_CONFIG || {};
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
      console.warn("Roadbook: Supabase config missing — set window.ROADBOOK_CONFIG before loading this script.");
      return null;
    }
    if (!window.supabase || !window.supabase.createClient) {
      console.error("Roadbook: Supabase JS library not loaded.");
      return null;
    }
    const client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    window.__roadbookSb = client;
    return client;
  }

  async function getSession() {
    const sb = getClient();
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return data.session || null;
  }

  async function getUser() {
    const session = await getSession();
    return session ? session.user : null;
  }

  async function signInWithGoogle() {
    const sb = getClient();
    if (!sb) return;
    const redirectTo = `${location.origin}/app.html`;
    await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo }
    });
  }

  async function signOut() {
    const sb = getClient();
    if (!sb) return;
    await sb.auth.signOut();
    location.href = "/";
  }

  // Redirect helpers
  async function requireAuth() {
    const session = await getSession();
    if (!session) { location.href = "/"; return null; }
    return session;
  }

  async function bounceIfAuthed() {
    const session = await getSession();
    if (session) location.href = "/app.html";
  }

  window.RoadbookAuth = {
    getClient, getSession, getUser,
    signInWithGoogle, signOut,
    requireAuth, bounceIfAuthed
  };
})();
