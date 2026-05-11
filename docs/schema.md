# Roadbook data schema

A Roadbook is a single JSON document. Export with the **Export** button; import with **Import**; or version it in git and load via the file picker.

## Top-level

| Field | Type | Required | Description |
|---|---|---|---|
| `roadbookVersion` | number | yes | Schema version. Currently `2` (months). v1 files using quarters auto-migrate on import. |
| `title` | string | yes | Roadmap title (header). Max 120 chars. |
| `eyebrow` | string | no | Subtitle / kicker above the title. Max 80 chars. |
| `activeYear` | `"2026"` \| `"2027"` | yes | Which year tab is selected on load. |
| `data["2026"]` | `YearData` | yes | Year-2026 lanes and items. |
| `data["2027"]` | `YearData` | yes | Year-2027 lanes and items. |

## `YearData`

```ts
{
  granularity: "month",  // optional; defaults to "month" — legacy "quarter" data migrates on load
  lanes: Lane[],
  items: Item[]
}
```

## `Lane`

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Unique within the year. Used by `Item.laneId`. |
| `name` | string | yes | Shown in the lane head. Inline-editable in the UI. |
| `description` | string | no | Optional subtitle under the name. |
| `color` | enum | no | One of: `cream`, `sage`, `blush`, `mint`, `peach`, `rose`, `sky`, `lavender`, `lemon`, `coral`, `stone`, `periwinkle`. Defaults round-robin by lane index. |

## `Item`

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Unique within the year. |
| `laneId` | string | yes | Must match a `Lane.id` in the same year. |
| `title` | string | yes | Card label. |
| `start` | 1–12 | yes | Month the item starts in (1 = Jan). |
| `span` | 1–12 | yes | Number of months the item covers. `start + span - 1` ≤ 12. |
| `row` | int ≥ 0 | yes | Vertical position within the lane (0 = top). Multiple items can occupy the same lane on different rows. |
| `status` | enum | yes | `planned`, `funded`, `soon`, `pending`, `conditional`. |
| `type` | enum | yes | `other`, `build`, `data`, `polish`. Drives the left color stripe. |
| `due` | ISO date string | no | `YYYY-MM-DD`. Empty string for no due date. |
| `complete` | 0–100 | no | Completion percentage. Renders as a fill behind the card. |

## Status semantics

- `planned` — committed, not started
- `funded` — has resourcing
- `soon` — coming this release / quarter
- `pending` — funding or approval pending
- `conditional` — only if capacity / dependent on another bet

## Type semantics

These are generic. Repurpose them by editing the labels in `src/index.template.html` and the validator in `src/state.js`:

- `build` — engineering capability
- `data` — research, analysis, integration
- `polish` — UX / quality / cleanup
- `other` — no stripe color

## Minimal example

```json
{
  "roadbookVersion": 1,
  "title": "Q1 2026",
  "eyebrow": "Plan",
  "activeYear": "2026",
  "data": {
    "2026": {
      "lanes": [
        { "id": "build", "name": "Build", "color": "sage" }
      ],
      "items": [
        {
          "id": "x", "laneId": "build", "title": "Ship",
          "start": 1, "span": 4, "row": 0,
          "status": "planned", "type": "build",
          "due": "", "complete": 0
        }
      ]
    },
    "2027": { "lanes": [], "items": [] }
  }
}
```
