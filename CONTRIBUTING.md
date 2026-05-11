# Contributing to Roadbook

Thanks for considering a contribution. The goal of this project is to stay a single, fork-friendly HTML file for product managers — please keep that in mind when proposing changes.

## Dev loop

```bash
git clone https://github.com/<you>/roadbook
cd roadbook
node tools/build.mjs   # one-shot build
npm run dev            # build + serve at http://localhost:5173
```

Edit anything under `src/` or `templates/`, re-run `node tools/build.mjs`, refresh the browser.

There is **no bundler**. The build script concatenates `src/styles.css` and the JS modules in a fixed order into `index.html`. If you need to add a new JS module, append its filename to `JS_ORDER` in `tools/build.mjs`.

## What we welcome

- **New templates** — drop a JSON in `templates/`, add a meta entry in `src/templates.js`. Keep them generic; no real-company or internal-project names.
- **Bug fixes** — open an issue first with steps to reproduce.
- **Accessibility** improvements — keyboard nav, screen reader labels, contrast.
- **Performance** improvements — render path, drag latency, large-roadmap behavior.

## What to discuss before opening a PR

- **New dependencies.** The project intentionally has zero npm runtime deps. `html2canvas` is loaded lazily from CDN. Anything else needs a strong case.
- **Big features.** Real-time collab, accounts, server sync, integrations (Jira, Linear). These are interesting but explicitly out of scope for v0.x. File an issue and let's talk.
- **Significant restyling.** The design intent is "clean, conference-deck-ready." Pastel lane colors with white card area. PRs that change the visual language need a screenshot and a reason.

## Code style

- Vanilla JS in IIFE modules that attach to `window.Roadbook.*`.
- No build-time transforms. The browser sees the code you wrote.
- Plain CSS with custom properties for theming. No CSS-in-JS, no preprocessors.
- Two-space indent, double quotes, semicolons.

## Templates

A template is a JSON file matching the schema in [`docs/schema.md`](docs/schema.md). Keep items realistic but generic (no real product names, no internal project codes). Aim for 8–15 items so the layout feels populated but not cluttered.

## Releases

Tagged releases ship a copy of `index.html` as a release asset, so a PM can grab a single file and run it locally without npm.
