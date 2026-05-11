# Roadbook — hosted version

A Google-login, per-user version of Roadbook backed by **Supabase** for auth + storage and deployed as a static site on **Vercel**.

The hosted app reuses the same engine as the OSS single-file build (`../../src/`). The only "backend" is Supabase — there are no serverless functions to maintain. RLS policies on the `roadmaps` table mean every user can only see their own data.

## What you get

- **Sign in with Google** (handled by Supabase Auth)
- **Dashboard** listing all your roadmaps with title, last-updated, and a tiny preview
- **"+ Create roadmap"** that opens a template picker (Blank, Product Launch, SaaS Quarterly, Engineering Sprint)
- **Editor** that's the same as the OSS one, with a save-status pill in the header that auto-saves to Supabase (800ms debounce)
- **Rename / delete** roadmaps from the dashboard
- All data is **scoped per user** via Postgres RLS — no cross-user leakage

## One-time setup (~10 minutes)

### 1. Create a Supabase project

1. Go to <https://supabase.com>, sign up, and create a new project.
2. Wait for it to provision (1–2 minutes).
3. Open **SQL Editor → New query** and paste the contents of `supabase/schema.sql`. Run it. This creates the `roadmaps` table, the `updated_at` trigger, and RLS policies.

### 2. Turn on Google sign-in

1. In Supabase: **Authentication → Providers → Google → Enable**.
2. Note the **Callback URL** Supabase shows (looks like `https://YOUR_PROJECT.supabase.co/auth/v1/callback`). You'll paste this into Google in step 3.
3. In <https://console.cloud.google.com/apis/credentials>:
   - Create a new project (or pick an existing one).
   - **Configure OAuth consent screen** → User type "External". Add your email as a test user. App name: "Roadbook" or whatever you like.
   - **Credentials → Create credentials → OAuth client ID** → "Web application".
   - **Authorized JavaScript origins**: `https://YOUR_VERCEL_DOMAIN.vercel.app` (you'll know this after step 4), and `http://localhost:5174` for local dev.
   - **Authorized redirect URIs**: the Supabase callback URL from step 2.
   - Save and copy the **Client ID** and **Client secret**.
4. Back in Supabase Google provider settings: paste the **Client ID** and **Client secret**. Save.

### 3. Grab Supabase credentials

In Supabase: **Project Settings → API**. You need:

- `Project URL` → `SUPABASE_URL`
- `anon public key` → `SUPABASE_ANON_KEY`

These are safe to ship to the browser — RLS does the actual access control.

### 4. Deploy to Vercel

```bash
cd apps/web
npx vercel              # first time: log in, link to a project (use defaults)
```

Then in the Vercel dashboard for your project → **Settings → Environment Variables**, add:

| Name | Value |
|---|---|
| `SUPABASE_URL` | from step 3 |
| `SUPABASE_ANON_KEY` | from step 3 |

Trigger a redeploy. Vercel will run `node tools/build.mjs`, which reads those env vars and writes them into `dist/config.js`.

After deploy, Vercel gives you a URL like `roadbook-xyz.vercel.app`. Go back to **Google Cloud → OAuth client → Authorized JavaScript origins** and add that URL.

That's it. Open the URL in a clean browser, click "Continue with Google", create your first roadmap.

## Local development

```bash
cd apps/web
cp config.example.js config.js
# edit config.js with your Supabase URL + anon key
npm run dev
# opens http://localhost:5174
```

For Google sign-in to work on `http://localhost:5174`, the Vercel-domain steps above (adding the origin in Google Cloud) need to include `http://localhost:5174` as well.

## File layout

```
apps/web/
├── README.md             # this file
├── package.json          # build + dev scripts (no runtime deps)
├── vercel.json           # static deploy config
├── config.example.js     # template for local SUPABASE_URL + ANON_KEY
├── supabase/schema.sql   # paste into Supabase SQL editor
├── index.html            # landing / sign-in page
├── app.html              # dashboard
├── src/
│   ├── shell.css         # landing + dashboard styles
│   ├── editor-shell.css  # cloud header above the OSS editor
│   ├── supabase-client.js  # window.RoadbookAuth wrapper
│   ├── roadmaps-api.js   # window.RoadbookAPI CRUD
│   ├── cloud-sync.js     # wires the OSS engine to Supabase
│   └── editor.template.html  # editor wrapper (concatenates engine + cloud sync)
└── tools/
    └── build.mjs         # generates dist/ from src + ../../src + ../../templates
```

## How the engine integrates

The hosted editor (`editor.html` in `dist/`) embeds the full OSS engine (CSS + JS + body markup) and then wires in the cloud layer:

1. `state.js` was extended with `setStorageMode("memory")` and `setOnPersist(cb)`. When called, the engine stops touching `localStorage` and routes every commit through a callback.
2. `cloud-sync.js` fetches the roadmap row from Supabase by id (the URL hash), calls `state.replaceAll(...)` with the payload, and registers a debounced save callback.
3. The dashboard creates a new row via `RoadbookAPI.create()` and redirects to `editor.html#<id>`.

The OSS build at the repo root is unaffected — `setStorageMode` defaults to `"local"` (today's behavior).

## What's deliberately NOT included (v0.1 hosted)

- **Sharing.** No public read-only URLs yet. The OSS share-link still works in cloud mode (encodes the data into a hash), but copying the editor URL doesn't grant another user access — RLS will reject them.
- **Collaboration.** One owner per roadmap.
- **Soft delete / trash.** Delete is permanent.
- **Roadmap thumbnails on the dashboard** are computed live from the JSON, not stored.
- **Custom domain.** Vercel subdomain is fine for v0.1; add a custom domain later via Vercel + DNS.
