# Customizing Roadbook

Roadbook is meant to be forked. Here are the most common knobs.

## Rebrand

| Change | File | Look for |
|---|---|---|
| Default title / eyebrow | `src/defaults.js` | `BLANK_2026.title` (it's the inline-editable title — change in UI or here) |
| Page `<title>` | `src/index.template.html` | `<title>Roadbook</title>` |
| Footer link | `src/index.template.html` | `<footer class="footer">` |
| Accent color (cyan) | `src/styles.css` | `--accent` token, or use the in-app color picker (Accent color button) |

## Status / type sets

These are not pure data — they have CSS dots / stripes and a `<select>` in the modal.

To change them, edit **three** spots:

1. `src/index.template.html` — `<select id="fStatus">` and `<select id="fType">` options
2. `src/state.js` — the whitelist in `normalizeYear()` for `status` and `type`
3. `src/styles.css` — the `.dot-*` / `.stripe-*` rules and `--status-*` / `--type-*` tokens

Then rebuild: `node tools/build.mjs`.

## Quarters → months / weeks

The grid is hardcoded to 4 quarters. Changing this is a bigger surgery — you'd touch:

- `.axis` grid-template in `styles.css`
- the `25%` math in `.card` `left`/`width` and the ghost positioning
- the `start + span - 1 ≤ 4` clamp in `state.js` and the drag/keyboard handlers in `drag.js` and `app.js`

A month-based variant works fine if you scale the values consistently (12 columns instead of 4).

## Add a template

1. Drop `templates/your-template.json` matching the schema in `docs/schema.md`.
2. Add an entry to `TEMPLATES_META` in `src/templates.js`:

```js
{ key: "your-template", title: "Your Template", desc: "What it's for." }
```

3. `node tools/build.mjs` and you're done. The template appears in the picker.

## Add a new lane color

1. Pick a hex.
2. In `src/styles.css`, add a new `--lane-{name}` token to both `[data-theme="light"]` and `[data-theme="dark"]` blocks, and a `.lane[data-color="{name}"]` rule.
3. In `src/state.js`, add `"{name}"` to the `PALETTE` array.

Rebuild and the new swatch appears in the color picker.

## Deploy

GitHub Pages: `index.html` lives at the repo root. Enable Pages → "Deploy from a branch" → `main`, `/` (root). Done.

Surge / Netlify / Vercel: drag-and-drop the repo folder or point at the repo. `index.html` is the entrypoint.

Anywhere: it's one file — copy it onto an S3 bucket, your intranet, a USB drive.

## Self-hosting `html2canvas`

By default PNG export lazy-loads `html2canvas` from cdnjs. If you can't reach a CDN:

1. Download `html2canvas.min.js` and drop it next to `index.html`.
2. In `src/share.js`, set `HTML2CANVAS_CDN = "./html2canvas.min.js";`
3. Rebuild.
