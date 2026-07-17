# Business Website Lead Agent

Finds local businesses that have **no website** on Google Maps, filters them for quality,
and hands them to your team as leads — **never the same business twice**.

Employees log in, pull fresh leads, work them through a pipeline, and log every call.
An **AI business development executive** can then cold-call the leads: it pitches in
Banglish with the employee's cloned voice and trained script, handles objections, sends
the portfolio over WhatsApp mid-call, files a report on every call, and emails the
manager when a call goes well.

Built with **Next.js (App Router)** on Vercel + Neon Postgres.

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
| `TAVILY_API_KEY` | Social lookup, free tier (1,000/month, resets). |
| `SERPER_API_KEY` | Social lookup, paid overflow (~$1/1,000). |
| `VAPI_API_KEY` / `VAPI_PHONE_NUMBER_ID` / `VAPI_WEBHOOK_SECRET` | The AI call engine — see **AI caller** below. |
| `ELEVENLABS_API_KEY` | Voice cloning for the AI caller (Starter plan, $5/mo). |
| `ANTHROPIC_API_KEY` | Powers "Improve from my calls" in the Train AI tab. Optional. |
| `AI_CALL_MONTHLY_BUDGET` / `AI_CALL_DAILY_MAX` / `AI_CALL_MAX_MINUTES` | Server-side safety caps (defaults 50 / 15 / 8). |
| `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_TEMPLATE_NAME` / `PORTFOLIO_URL` | Mid-call portfolio sending — see **WhatsApp** below. Optional. |

> **Generate secrets, don't paste the command.** `SESSION_SECRET` and
> `CRON_SECRET` must be the *output* of the command below, not the command
> itself — that string is published in this repo and would let anyone forge a
> login. The **Setup** tab flags this if it happens.
>
> ```bash
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
> ```

> After adding or changing env vars in Vercel you must **redeploy** for them to take effect.

### 2. Database

```bash
npm install
node scripts/migrate.mjs   # creates `leads` + `lead_notes`; safe to re-run
```

### 3. Run

```bash
npm run dev      # full stack — Next.js serves the UI and /api routes together
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
| `/api/calls` | GET/POST | AI call history + usage / start an AI call (`{place_id}` or `{test_number}`) |
| `/api/vapi-webhook` | POST | Vapi call reports (secret-verified, idempotent) |
| `/api/vapi-tools` | POST | Mid-call tools: WhatsApp send, do-not-call flag |
| `/api/voice` | GET/POST/DELETE | Voice-clone profile per employee |
| `/api/persona` | GET/POST/PATCH | Pitch script versions + AI improvement drafts |

## AI caller

The AI cold-caller behaves like a junior BDE: it pitches in **Banglish**, in the
**employee's cloned voice**, follows the **trained script**, answers objections
from the trained Q&A, and knows when to stop.

### How a call flows

1. An employee opens a lead in the Pipeline and presses **AI Call** (or a test
   call from the Setup tab rings their own phone first — do this before ever
   dialing a real lead).
2. The server builds a one-off Vapi assistant: system prompt = trained persona +
   this lead's data (name, category, rating, "has Facebook but no website"), voice
   = the employee's ElevenLabs clone, plus two tools the model may call mid-conversation.
3. Vapi dials via the attached phone number. If the lead asks for the portfolio,
   the AI first asks **whether this number has WhatsApp** — if not, it asks for
   one that does — then calls the `send_whatsapp_materials` tool.
4. When the call ends, Vapi posts a report: transcript, recording, cost, and a
   structured outcome (`interested` / `callback` / `not_interested` / …). The
   server files a note on the lead, moves its pipeline status (never overwriting
   `won`/`lost`/`quoted`), and **emails the manager if the outcome is positive**.
5. In the **Train AI** tab, "Improve from my calls" has Claude read recent
   transcripts + outcomes and propose a sharper script. The proposal is a
   **draft** — nothing changes until a human activates it.

### Safety rails (all server-side)

- Monthly **dollar cap** (`AI_CALL_MONTHLY_BUDGET`, default $50) computed from
  Vapi's actual per-call cost, plus a reservation for in-flight calls.
- **Daily cap** (default 15) and **one call at a time**.
- Calls only during **10:00–19:00 Dhaka time, never Friday**. Test calls to your
  own phone are exempt.
- A lead who says "don't call me" gets a permanent `do_not_call` flag — set by
  the AI itself via the `flag_do_not_call` tool, enforced by the server.
- If asked whether it's an AI, it answers honestly.
- Webhook processing is idempotent — Vapi retries can't double-file reports or
  double-email the manager.

### Setup (one-time)

1. **Vapi** ([vapi.ai](https://vapi.ai)) — create an account, copy the API key.
   Buy a Twilio number (~$1/mo) and import it into Vapi, or buy a number from
   Vapi directly; copy the **Phone Number ID**. Generate `VAPI_WEBHOOK_SECRET`
   the same way as `SESSION_SECRET`.
2. **ElevenLabs** ([elevenlabs.io](https://elevenlabs.io)) — Starter plan
   ($5/mo) includes instant voice cloning; copy the API key. Each employee then
   records ~90 seconds in the **Train AI** tab.
3. Set the env vars, redeploy, run `npm run migrate` once, then use **Setup →
   AI caller → Call me** to hear the agent on your own phone.

> **Reality check on Banglish:** speech recognition quality on Dhaka accents is
> the biggest unknown. That's exactly what the test call is for — tune
> `VAPI_TRANSCRIBER_JSON` / `VAPI_VOICE_JSON` from Vercel (no redeploy of code
> needed) until the conversation feels right, before spending budget on leads.
>
> **Caller ID:** Twilio has no Bangladeshi numbers, so calls show a foreign
> number. If pickup rates suffer, the upgrade path is a local BD SIP trunk
> imported into Vapi.

### WhatsApp (optional — calls work without it)

Mid-call portfolio sending uses the **Meta WhatsApp Cloud API**, which requires:
Meta Business verification, a WhatsApp Business number (one **not** registered
in the WhatsApp app), and **one approved template** with a DOCUMENT header and a
`{{1}}` body variable (the business name). Attach your portfolio PDF's public
URL as `PORTFOLIO_URL`.

Until it's configured, the AI still handles the conversation — it tells the lead
the portfolio is on its way and files a **"SEND MANUALLY"** note on the lead so
a human follows up.

## Social lookup — the "HOT" signal

A business with **an active Facebook page but no website** is the best lead there
is: already selling online, visibly missing a real site. Those are tagged **HOT**
and filterable in the pipeline.

Detection uses a **web search API**, not Facebook directly — facebook.com returns
HTTP 400 with a byte-identical body for real and fake pages when called from a
datacenter IP, and instagram.com returns the same login wall for both. A direct
check is a coin flip; a search API is not.

### Providers

> **Do not use Google Custom Search or Brave.** The Custom Search JSON API is
> closed to new Google Cloud projects — a new key returns `403 forbidden` no
> matter how correctly the API, key restrictions and engine are configured, and
> there is no way to fix it from the console. Brave retired its free tier in
> early 2026 and now requires a card with metered billing. Both were evaluated
> and dropped.

1. **Tavily** — 1,000 free credits per month, **resets monthly**, no card.
   Spent first. Sign up at [tavily.com](https://tavily.com) → `TAVILY_API_KEY`.
2. **Serper** — 2,500 free credits, then ~$1 per 1,000 (~$0.06 per 60-lead scan).
   Takes over automatically once Tavily's monthly quota is gone, or if Tavily
   errors. Sign up at [serper.dev](https://serper.dev) → `SERPER_API_KEY`.

Either works alone; both together gives free-first with cheap overflow. Both are
told to restrict to `facebook.com`/`instagram.com` (Tavily via `include_domains`,
Serper via Google `site:` operators), so no result filtering is wasted.

Usage is counted per provider per month in the `api_usage` table, so the switch
survives restarts and cold starts.

Social lookup runs **after** the scan in batches rather than inline, so a scan of
60 businesses can't exceed the function timeout, and employees see progress.

### Verifying your setup

```
GET /api/health                      # what the server resolved + quota left
GET /api/health?test=Daraz&city=Dhaka   # runs ONE real search, shows raw URLs
```

The `test` form costs one query and returns the raw result URLs, so a
misconfigured engine shows up immediately instead of as a silent "no socials
found" on every lead.
