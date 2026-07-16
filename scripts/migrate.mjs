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
];

for (const s of statements) {
  await sql.query(s);
  console.log('✓', s.split('\n')[0].trim().slice(0, 70));
}

const [{ count: leadCount }] = await sql`select count(*)::int as count from leads`;
const [{ count: noteCount }] = await sql`select count(*)::int as count from lead_notes`;
console.log(`\n✅ Schema ready. leads=${leadCount} rows, lead_notes=${noteCount} rows.`);
