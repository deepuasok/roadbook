// Thin wrapper around the Supabase JS client. Reads credentials from
// window.ROADBOOK_CONFIG which is injected at build time (or via config.js).
//
// Local dev mode: when SUPABASE_URL / SUPABASE_ANON_KEY are missing, auth is
// stubbed with a synthetic local session so the app is usable end-to-end
// without a Supabase project. Roadmaps fall back to localStorage in that mode.
(function () {
  const LOCAL_SESSION = {
    user: {
      id: "local-dev",
      email: "local@roadbook.dev",
      user_metadata: { full_name: "Local Dev", avatar_url: "" }
    },
    access_token: "local-dev",
    token_type: "bearer"
  };

  function isLocalMode() {
    const cfg = window.ROADBOOK_CONFIG || {};
    return !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY;
  }

  function getClient() {
    if (isLocalMode()) return null;
    if (window.__roadbookSb) return window.__roadbookSb;
    if (!window.supabase || !window.supabase.createClient) {
      console.error("Roadbook: Supabase JS library not loaded.");
      return null;
    }
    const cfg = window.ROADBOOK_CONFIG;
    const client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    window.__roadbookSb = client;
    return client;
  }

  async function getSession() {
    if (isLocalMode()) return LOCAL_SESSION;
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
    if (isLocalMode()) { location.href = "/app.html"; return; }
    const sb = getClient();
    if (!sb) {
      const msg = "Supabase JS failed to load. Check your network or rebuild.";
      console.error(msg);
      alert(msg);
      return;
    }
    const redirectTo = `${location.origin}/app.html`;
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo }
    });
    if (error) {
      console.error("Google sign-in failed:", error);
      alert("Sign-in failed: " + error.message);
    }
  }

  async function signOut() {
    if (isLocalMode()) { location.href = "/"; return; }
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
    requireAuth, bounceIfAuthed,
    isLocalMode
  };
})();
