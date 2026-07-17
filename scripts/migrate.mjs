// Creates / updates the Neon schema. Safe to re-run.
//   node scripts/migrate.mjs
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';

// Minimal .env loader (no dotenv dependency).
try {
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

const sql = neon(process.env.DATABASE_URL);

const statements = [
  // ── Shared lead ledger ──────────────────────────────────────────────────────
  // One row per Google place_id ever delivered to the team. Its existence is what
  // makes dedup work: a place_id in here is never handed out again.
  `create table if not exists leads (
     place_id        text primary key,
     name            text not null,
     address         text,
     phone           text,
     type            text,
     rating          numeric,
     reviews         integer,
     maps_url        text,
     g_search        text,
     search_location text,
     search_query    text,
     confidence      text,
     found_domains   text[] default '{}',
     weak_domains    text[] default '{}',
     delivered_to    text,
     delivered_at    timestamptz not null default now(),
     status          text not null default 'new',
     updated_at      timestamptz not null default now()
   )`,
  `create index if not exists leads_delivered_at_idx on leads (delivered_at desc)`,
  `create index if not exists leads_delivered_to_idx on leads (delivered_to)`,
  `create index if not exists leads_status_idx       on leads (status)`,

  // ── CRM activity log ────────────────────────────────────────────────────────
  // Append-only. Every status change / call outcome an employee records.
  `create table if not exists lead_notes (
     id         bigserial primary key,
     place_id   text not null references leads(place_id) on delete cascade,
     author     text not null,
     status     text,
     note       text not null default '',
     created_at timestamptz not null default now()
   )`,
  `create index if not exists lead_notes_place_id_idx   on lead_notes (place_id, created_at desc)`,
  `create index if not exists lead_notes_author_idx     on lead_notes (author)`,
  `create index if not exists lead_notes_created_at_idx on lead_notes (created_at desc)`,

  // ── Social presence ─────────────────────────────────────────────────────────
  // A business with an active Facebook page but no website is the strongest
  // pitch signal we have: they already sell online and visibly need a real site.
  `alter table leads add column if not exists facebook_url       text`,
  `alter table leads add column if not exists instagram_url      text`,
  `alter table leads add column if not exists socials_checked_at timestamptz`,
  `create index if not exists leads_facebook_idx on leads (facebook_url) where facebook_url is not null`,

  // ── Search API quota ────────────────────────────────────────────────────────
  // Counts queries per provider per month so we can spend Brave's free 2,000
  // first and fall over to Google Custom Search once it runs low.
  `create table if not exists api_usage (
     provider text not null,
     month    text not null,
     count    integer not null default 0,
     primary key (provider, month)
   )`,

  // ── AI caller ───────────────────────────────────────────────────────────────
  // Leads who told the AI (or a human) to stop calling are never dialed again.
  `alter table leads add column if not exists do_not_call boolean not null default false`,

  // One row per employee who trained a voice clone. voice_id is ElevenLabs'.
  `create table if not exists voice_profiles (
     owner      text primary key,
     voice_id   text not null,
     voice_name text,
     created_at timestamptz not null default now()
   )`,

  // Versioned pitch personas. The AI-improve flow writes drafts; only a human
  // activating a draft changes what the caller actually says.
  `create table if not exists personas (
     id          bigserial primary key,
     owner       text not null,
     version     integer not null default 1,
     script      text not null default '',
     style_notes text not null default '',
     qa_pairs    jsonb not null default '[]',
     status      text not null default 'active',
     source      text not null default 'manual',
     created_at  timestamptz not null default now()
   )`,
  `create index if not exists personas_owner_idx on personas (owner, created_at desc)`,

  // One row per AI call. vapi_call_id is unique so webhook retries stay idempotent.
  `create table if not exists ai_calls (
     id               bigserial primary key,
     vapi_call_id     text unique,
     place_id         text references leads(place_id) on delete set null,
     lead_name        text,
     phone            text,
     started_by       text not null,
     is_test          boolean not null default false,
     status           text not null default 'queued',
     ended_reason     text,
     outcome          text,
     interest_level   integer,
     summary          text,
     transcript       text,
     recording_url    text,
     duration_seconds integer,
     cost_usd         numeric not null default 0,
     whatsapp_sent    boolean not null default false,
     whatsapp_number  text,
     callback_at      text,
     manager_emailed  boolean not null default false,
     created_at       timestamptz not null default now(),
     updated_at       timestamptz not null default now()
   )`,
  `create index if not exists ai_calls_created_idx on ai_calls (created_at desc)`,
  `create index if not exists ai_calls_place_idx   on ai_calls (place_id)`,

  // Everything the AI sent over WhatsApp, success or failure.
  `create table if not exists wa_sends (
     id         bigserial primary key,
     place_id   text,
     to_number  text not null,
     kind       text not null default 'portfolio',
     status     text not null,
     error      text,
     created_at timestamptz not null default now()
   )`,
];

for (const s of statements) {
  await sql.query(s);
  console.log('✓', s.split('\n')[0].trim().slice(0, 70));
}

const [{ count: leadCount }] = await sql`select count(*)::int as count from leads`;
const [{ count: noteCount }] = await sql`select count(*)::int as count from lead_notes`;
console.log(`\n✅ Schema ready. leads=${leadCount} rows, lead_notes=${noteCount} rows.`);
