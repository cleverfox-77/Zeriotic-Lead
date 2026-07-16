# Business Website Lead Agent

Finds local businesses that have **no website** on Google Maps, filters them for quality,
and hands them to your team as leads — **never the same business twice**.

Employees log in, pull fresh leads, work them through a pipeline, and log every call.

## How it works

1. **Scan** — geocodes your target area, pulls businesses from Google Places (New).
2. **Filter** — drops anything with a website, plus your quality rules (min reviews, min rating, must have a phone, exclude closed).
3. **Dedup** — checks the shared `leads` table. Any business the team has *ever* been given is skipped.
4. **Classify** — guesses domain names from the business name and DNS-checks them:
   - **True lead** — no same-name domain resolves.
   - **Verify** — a same-name domain exists; worth a manual look before pitching.
   Generic single-word domains (`glam.com`, `signature.com`) are treated as low-signal and **never** hide a lead.
5. **Deliver** — new leads are written to the shared pipeline, owned by whoever ran the scan.

## Setup

### 1. Environment variables

Set these in **Vercel → Project → Settings → Environment Variables** (and in `.env` for local dev):

| Variable | What it is |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string (pooled endpoint). |
| `GOOGLE_MAPS_API_KEY` | Google key with **Places API (New)** + **Geocoding API** enabled and billing on. Server-side only — never sent to the browser. |
| `TEAM_PASSWORD` | The shared password your employees type to sign in. |
| `SESSION_SECRET` | Random string used to sign session tokens. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

> After adding or changing env vars in Vercel you must **redeploy** for them to take effect.

### 2. Database

```bash
npm install
node scripts/migrate.mjs   # creates `leads` + `lead_notes`; safe to re-run
```

### 3. Run

```bash
npm run dev      # frontend only (API routes need `vercel dev`)
vercel dev       # full stack locally, including /api
npm run build    # production build
```

## Security notes

- The Google key lives **only** in a server env var. `/api/scan` calls Google; the browser never sees the key.
- All `/api/*` routes except `login` require a signed bearer token.
- `TEAM_PASSWORD` is the only thing standing between the public and your Google billing — use a strong one.

## API

| Route | Method | Purpose |
|---|---|---|
| `/api/login` | POST | `{name, password}` → session token |
| `/api/scan` | POST | Run the agent; returns + records new leads |
| `/api/leads` | GET | List/filter leads |
| `/api/leads` | PATCH | Change a lead's status |
| `/api/notes` | GET/POST | Read / append the activity trail |
| `/api/report` | GET | Pipeline, per-employee and activity rollups |

## Lead statuses

`new` → `contacted` → `callback` / `interested` / `not_interested` → `won` / `lost`
