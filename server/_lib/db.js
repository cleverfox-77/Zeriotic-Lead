import { neon } from '@neondatabase/serverless';

// Lazy: `next build` imports every route to collect metadata, and DATABASE_URL
// isn't guaranteed to exist on the build machine. Connecting at module load
// crashed the Vercel build ("No database connection string was provided");
// connecting on first query never runs at build time.
let client;
const db = () => (client ??= neon(process.env.DATABASE_URL));

export function sql(strings, ...values) {
  return db()(strings, ...values);
}
sql.query = (text, params) => db().query(text, params);

export const STATUSES = [
  'new',            // delivered, nobody has touched it
  'contacted',      // reached out
  'callback',       // asked to be called back
  'interested',     // wants to hear more
  'quoted',         // price/proposal sent
  'unqualified',    // bad fit: too small, no budget, already has a site, wrong business
  'not_interested', // reached, said no
  'won',
  'lost',
];
