# Roadbook

A fork-friendly, offline-first roadmap builder for product managers.

One file. No backend. No accounts. Drag chips across swim lanes, share as PNG / SVG / link, version the JSON in git.

![Roadbook hero](docs/screenshots/hero.png)

## Why

Most roadmap tools are either Miro plugins (overkill) or enterprise software (Aha!, Productboard — login, seats, lock-in). Roadbook is the middle ground: an HTML file you can open locally, deploy on GitHub Pages, or fork and customize for your team.

Built for the case where the PM just needs a clean swim-lane roadmap they can edit fast and drop into a deck.

## Quick start

**Use it (no install):** open [the hosted version](#) or download `index.html` and double-click.

**Fork and host:**
```bash
git clone https://github.com/<you>/roadbook
cd roadbook
node tools/build.mjs   # builds index.html from src/
# open index.html
```

**Develop:**
```bash
npm run dev   # builds + serves on http://localhost:5173
```

## Features

- **Drag chips** across quarters and rows. **Resize** by dragging the right edge.
- **Click to edit** title, due date, status, type, completion %.
- **Inline edits** for roadmap title, eyebrow, lane names, and lane descriptions — just click and type.
- **Year switcher** — 2026 / 2027 with independent storage.
- **12 pastel lane colors** — folder-style container with color band per lane.
- **Undo / redo** — `⌘Z` / `⌘⇧Z`, 50 steps.
- **Keyboard nav** — `Tab` cycles chips; `Enter` edits; arrows move; `Shift+arrow` resizes; `Delete` removes.
- **Dark mode** — toggle in the header. Persists.
- **Mobile responsive** — horizontal scroll on small screens; sticky lane labels.
- **Accent color** — pick any hex; replaces the indigo focus ring across the app.
- **Export PNG** (clipboard) and **SVG** (download). Print stylesheet for landscape A4/Letter.
- **Share link** — encodes the whole roadmap into the URL hash. No backend. Paste in Slack and the recipient sees the same roadmap.
- **JSON import / export** — your roadmap is a single `.roadbook.json` file. Version it in git, diff it, branch it.
- **Templates** — 4 starters (Blank, Product Launch, SaaS Quarterly, Engineering Sprint). Add your own in `templates/`.

## Data model

A roadbook export looks like this:

```json
{
  "roadbookVersion": 1,
  "title": "My Product Roadmap",
  "eyebrow": "Q1–Q4 2026",
  "activeYear": "2026",
  "data": {
    "2026": {
      "lanes": [
        { "id": "now", "name": "Now", "description": "...", "color": "sage" }
      ],
      "items": [
        {
          "id": "x1",
          "laneId": "now",
          "title": "Ship MVP",
          "start": 1, "span": 2, "row": 0,
          "status": "funded",
          "type": "build",
          "due": "2026-03-31",
          "complete": 40
        }
      ]
    },
    "2027": { "lanes": [], "items": [] }
  }
}
```

See [`docs/schema.md`](docs/schema.md) for full field reference.

## Project layout

```
roadbook/
├── index.html              # built, single-file deliverable
├── src/                    # source — edit here, then run `node tools/build.mjs`
│   ├── index.template.html
│   ├── styles.css
│   ├── state.js            # data model + undo/redo + persistence
│   ├── drag.js             # pointer-event drag/resize (mouse + touch)
│   ├── modal.js            # edit dialog + focus trap
│   ├── share.js            # PNG / SVG / JSON / URL-hash share
│   ├── templates.js        # first-run picker
│   ├── defaults.js         # blank-state lanes
│   └── app.js              # render + wiring
├── templates/              # bundled starter JSONs
├── tools/build.mjs         # inlines everything into index.html
└── docs/
    ├── schema.md
    └── customizing.md
```

## Customizing

To rebrand for your team — fork, then edit:

- **Title / eyebrow defaults** — `src/defaults.js`
- **Type colors** (Build / Data / Polish) — `src/styles.css`, `--type-*` tokens
- **Lane pastels** — `src/styles.css`, `--lane-*` tokens
- **Add a template** — drop a JSON into `templates/`, add a `META` entry in `src/templates.js`
- **Status set** — modify `<select id="fStatus">` in `src/index.template.html` and the `normalizeYear` whitelist in `src/state.js`

See [`docs/customizing.md`](docs/customizing.md) for full guide.

## Browser support

Modern Chromium, Firefox, Safari. Uses `pointer events`, `ClipboardItem`, `TextEncoder`. Optional `html2canvas` loaded from CDN for PNG export (falls back to SVG download if offline).

## Contributing

PRs welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md). The bar is a clean roadmap tool that stays a single HTML file. No build chain heavier than `node tools/build.mjs`.

## License

MIT — see [`LICENSE`](LICENSE).
