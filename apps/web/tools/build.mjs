#!/usr/bin/env node
// Build the hosted Roadbook (apps/web). Outputs a `dist/` directory ready to
// serve from any static host (Vercel, Netlify, Surge…). Reuses the OSS engine
// from ../../src and templates from ../../templates so the hosted app stays in
// sync with the open-source single-file build.
//
// No npm dependencies. Run from apps/web: `node tools/build.mjs`

import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB = join(__dirname, "..");
const REPO = join(WEB, "..", "..");
const ENGINE_SRC = join(REPO, "src");
const TEMPLATES = join(REPO, "templates");
const DIST = join(WEB, "dist");

const JS_ORDER = ["state.js", "drag.js", "modal.js", "share.js", "templates.js", "defaults.js", "app.js"];

function read(p) { return readFileSync(p, "utf8"); }

function loadTemplates() {
  const out = {};
  for (const f of readdirSync(TEMPLATES)) {
    if (!f.endsWith(".json")) continue;
    out[f.replace(/\.json$/, "")] = JSON.parse(read(join(TEMPLATES, f)));
  }
  return out;
}

function extractBody(html) {
  const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!m) throw new Error("Engine template missing <body>");
  // Strip the inline script blocks that hold the INJECT markers — we re-inject
  // them through external script tags in the cloud editor.
  return m[1]
    .replace(/<script>[\s\S]*?\/\* INJECT:TEMPLATES \*\/[\s\S]*?<\/script>/g, "")
    .replace(/<script>[\s\S]*?\/\* INJECT:JS \*\/[\s\S]*?<\/script>/g, "");
}

mkdirSync(DIST, { recursive: true });

// Engine assets
const engineCss = read(join(ENGINE_SRC, "styles.css"));
const engineJs = JS_ORDER.map((f) => read(join(ENGINE_SRC, f))).join("\n\n");
const engineBody = extractBody(read(join(ENGINE_SRC, "index.template.html")));
const templates = loadTemplates();
const templatesJs = `window.ROADBOOK_TEMPLATES = ${JSON.stringify(templates)};`;

writeFileSync(join(DIST, "engine.css"), engineCss);
writeFileSync(join(DIST, "engine.js"), engineJs);
writeFileSync(join(DIST, "templates.js"), templatesJs);

// Cloud shell + editor wrapper
const shellCss = read(join(WEB, "src", "shell.css"));
const editorShellCss = read(join(WEB, "src", "editor-shell.css"));
const collabCss = read(join(WEB, "src", "collaboration.css"));
const supabaseClient = read(join(WEB, "src", "supabase-client.js"));
const roadmapsApi = read(join(WEB, "src", "roadmaps-api.js"));
const cloudSync = read(join(WEB, "src", "cloud-sync.js"));
const collaboration = read(join(WEB, "src", "collaboration.js"));
const editorTemplate = read(join(WEB, "src", "editor.template.html"));

const editorHtml = editorTemplate
  .replace("/* INJECT:ENGINE_CSS */", engineCss)
  .replace("/* INJECT:EDITOR_SHELL_CSS */", editorShellCss)
  .replace("/* INJECT:COLLAB_CSS */", collabCss)
  .replace("<!-- INJECT:ENGINE_BODY -->", engineBody)
  .replace("/* INJECT:TEMPLATES */", templatesJs)
  .replace("/* INJECT:ENGINE_JS */", engineJs)
  .replace("/* INJECT:SUPABASE_CLIENT */", supabaseClient)
  .replace("/* INJECT:ROADMAPS_API */", roadmapsApi)
  .replace("/* INJECT:CLOUD_SYNC */", cloudSync)
  .replace("/* INJECT:COLLABORATION */", collaboration);

writeFileSync(join(DIST, "editor.html"), editorHtml);

// Landing + dashboard — already complete HTML files, just copy
for (const f of ["index.html", "app.html"]) {
  const src = read(join(WEB, f));
  // Inline shell.css so the static host doesn't need a separate request
  const inlined = src.replace(
    '<link rel="stylesheet" href="/src/shell.css">',
    `<style>\n${shellCss}\n</style>`
  );
  writeFileSync(join(DIST, f), inlined);
}

// Copy templates.js as a sibling for app.html
copyFileSync(join(DIST, "templates.js"), join(DIST, "templates.js"));

// Config — prefer a local apps/web/config.js (gitignored) for dev; fall back
// to env vars (Vercel build) so the same build script works in both contexts.
const LOCAL_CONFIG = join(WEB, "config.js");
let SUPABASE_URL = "";
let SUPABASE_ANON_KEY = "";
let configSource = "EMPTY";
if (existsSync(LOCAL_CONFIG)) {
  const raw = read(LOCAL_CONFIG);
  const urlM = raw.match(/SUPABASE_URL\s*:\s*["']([^"']*)["']/);
  const keyM = raw.match(/SUPABASE_ANON_KEY\s*:\s*["']([^"']*)["']/);
  if (urlM) SUPABASE_URL = urlM[1];
  if (keyM) SUPABASE_ANON_KEY = keyM[1];
  if (SUPABASE_URL && SUPABASE_ANON_KEY) configSource = "apps/web/config.js";
}
if (!SUPABASE_URL) SUPABASE_URL = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || "";
if (!SUPABASE_ANON_KEY) SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY || "";
if (configSource === "EMPTY" && SUPABASE_URL && SUPABASE_ANON_KEY) configSource = "env vars";
const configJs = `window.ROADBOOK_CONFIG = {
  SUPABASE_URL: ${JSON.stringify(SUPABASE_URL)},
  SUPABASE_ANON_KEY: ${JSON.stringify(SUPABASE_ANON_KEY)}
};`;
writeFileSync(join(DIST, "config.js"), configJs);

// supabase-client + roadmaps-api need to be served as standalone files for the
// landing + dashboard pages.
writeFileSync(join(DIST, "supabase-client.js"), supabaseClient);
writeFileSync(join(DIST, "roadmaps-api.js"), roadmapsApi);

// Fix the script paths in dist/index.html and dist/app.html
function rewireScripts(file) {
  let html = read(join(DIST, file));
  html = html.replace(/\/src\/supabase-client\.js/g, "/supabase-client.js");
  html = html.replace(/\/src\/roadmaps-api\.js/g, "/roadmaps-api.js");
  writeFileSync(join(DIST, file), html);
}
rewireScripts("index.html");
rewireScripts("app.html");

console.log(`Built apps/web/dist/`);
console.log(`  index.html      (landing)`);
console.log(`  app.html        (dashboard)`);
console.log(`  editor.html     (cloud editor)`);
console.log(`  engine.css/.js  (OSS engine reused)`);
console.log(`  templates.js    (${Object.keys(templates).length} templates)`);
console.log(`  config.js       (${configSource === "EMPTY" ? "EMPTY — set SUPABASE_URL/SUPABASE_ANON_KEY or create apps/web/config.js" : "from " + configSource})`);
