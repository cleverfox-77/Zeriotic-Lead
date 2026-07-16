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

### Domain suffixes

Suffixes are appended as plain strings, so multi-part ones work like any other —
`greenleaf` + `.com.bd` → `greenleaf.com.bd`. This matters: most Bangladeshi
businesses sit on `.com.bd`, and an engine that only appends `.com`/`.net` calls
every one of them a "true lead" when they already have a website.

Defaults are tuned for Bangladesh (`.com.bd .com .net .org .xyz .bd`). Pick more
in the scan panel — but every suffix multiplies DNS lookups, so selecting all of
them makes scans slower. Lookups are capped at 80 per business.

### Lead statuses

`new` → `contacted` → `callback` / `interested` → `quoted` → `won` / `lost`,
plus `unqualified` (bad fit) and `not_interested` (reached, said no).

## Setup

### 1. Environment variables

Set these in **Vercel → Project → Settings → Environment Variables** (and in `.env` for local dev):

| Variable | What it is |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string (pooled endpoint). |
| `GOOGLE_MAPS_API_KEY` | Google key with **Places API (New)** + **Geocoding API** enabled and billing on. Server-side only — never sent to the browser. |
| `TEAM_PASSWORD` | The shared password your employees type to sign in. |
| `SESSION_SECRET` | Signs session tokens. Must be long and random — a short one can be brute-forced to forge logins. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | Email sending. For Gmail use `smtp.gmail.com` / `465` and an **App Password** (2FA required) — not your Google password. |
| `SMTP_FROM` | From address (defaults to `SMTP_USER`). |
| `MANAGER_EMAIL` | Who receives reports. |
| `CRON_SECRET` | Guards the weekly cron route so strangers can't trigger report emails. |

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
| `/api/places-autocomplete` | GET | Location suggestions for the scan box |
| `/api/leads` | GET | List/filter leads |
| `/api/leads` | PATCH | Change a lead's status |
| `/api/notes` | GET/POST | Read / append the activity trail |
| `/api/report` | GET | Pipeline, per-employee and activity rollups |
| `/api/socials` | POST | Find Facebook/Instagram pages for a batch of leads |
| `/api/health` | GET | Which providers the server resolved + search quota left |
| `/api/report-email` | POST | Email the report to `MANAGER_EMAIL` now |
| `/api/cron/weekly-report` | GET | Weekly email (Vercel Cron, Mondays 04:00 UTC) |

## Social lookup — the "HOT" signal

A business with **an active Facebook page but no website** is the best lead there
is: already selling online, visibly missing a real site. Those are tagged **HOT**
and filterable in the pipeline.

Detection uses a **web search API**, not Facebook directly — facebook.com returns
HTTP 400 with a byte-identical body for real and fake pages when called from a
datacenter IP, and instagram.com returns the same login wall for both. A direct
check is a coin flip; a search API is not.

### Setting up Google Custom Search (the default provider)

1. Enable **Custom Search API** in Google Cloud → set `GOOGLE_CSE_API_KEY`.
2. Create an engine at [programmablesearchengine.google.com](https://programmablesearchengine.google.com)
   → copy the **Search engine ID** into `GOOGLE_CSE_ID`.
3. Under **Sites to search**, add:
   - `facebook.com`
   - `instagram.com`

**You do not need "Search the entire web."** That toggle is often unavailable,
and it isn't wanted here: the app discards every result that isn't a Facebook or
Instagram URL, so an engine restricted to those two sites returns *better* top-10
results, not worse.

> A CSE with **no sites** and entire-web off searches nothing and silently returns
> zero results — which looks identical to "this business has no Facebook page".
> Verify with the self-test below.

Cost: 100 queries/day free, then $5/1,000 (~$0.30 per 60-lead scan).

### Brave (optional)

Set `BRAVE_SEARCH_API_KEY` to spend Brave's free 2,000/month before Google's
quota. It's optional — Brave requires a payment method on file even for the $0
tier, and the app works fine on Google alone.

When set, Brave is used until this month's count passes `BRAVE_MONTHLY_LIMIT`
(default 1900), then Google takes over automatically. It also falls over to
Google immediately if Brave errors or rate-limits. Usage is counted per provider
per month in the `api_usage` table, so the switch survives restarts.

Brave's free tier allows **1 query/second** — that limit is why social lookup runs
**after** the scan in batches rather than inline: 60 businesses inline would need
60s and exceed the function timeout.

### Verifying your setup

```
GET /api/health                      # what the server resolved + quota left
GET /api/health?test=Daraz&city=Dhaka   # runs ONE real search, shows raw URLs
```

The `test` form costs one query and returns the raw result URLs, so a
misconfigured engine shows up immediately instead of as a silent "no socials
found" on every lead.
