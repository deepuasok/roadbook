// Copy to config.js (gitignored) and fill in your Supabase project values.
// For Vercel deploys, set SUPABASE_URL + SUPABASE_ANON_KEY as env vars instead —
// tools/build.mjs reads them and writes dist/config.js at build time.
window.ROADBOOK_CONFIG = {
  SUPABASE_URL: "https://YOUR_PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "YOUR_ANON_PUBLIC_KEY"
};
