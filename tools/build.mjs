#!/usr/bin/env node
// Concatenate src/ files into a single self-contained index.html.
// No npm dependencies. Run: node tools/build.mjs

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");

const JS_ORDER = [
  "state.js",
  "drag.js",
  "modal.js",
  "share.js",
  "templates.js",
  "defaults.js",
  "app.js"
];

function read(name) {
  return readFileSync(join(SRC, name), "utf8");
}

function loadTemplates() {
  const tplDir = join(ROOT, "templates");
  const out = {};
  for (const f of readdirSync(tplDir)) {
    if (!f.endsWith(".json")) continue;
    const key = f.replace(/\.json$/, "");
    out[key] = JSON.parse(readFileSync(join(tplDir, f), "utf8"));
  }
  return out;
}

const template = read("index.template.html");
const css = read("styles.css");
const js = JS_ORDER.map(read).join("\n\n");
const templates = loadTemplates();

const inlined = template
  .replace("/* INJECT:CSS */", css)
  .replace("/* INJECT:TEMPLATES */", `window.ROADBOOK_TEMPLATES = ${JSON.stringify(templates)};`)
  .replace("/* INJECT:JS */", js);

writeFileSync(join(ROOT, "index.html"), inlined);
console.log(`Built index.html (${(inlined.length / 1024).toFixed(1)} KB)`);
console.log(`  styles.css: ${(css.length / 1024).toFixed(1)} KB`);
console.log(`  js modules: ${(js.length / 1024).toFixed(1)} KB`);
console.log(`  templates:  ${Object.keys(templates).length} (${Object.keys(templates).join(", ")})`);
