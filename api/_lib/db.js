import { neon } from '@neondatabase/serverless';

export const sql = neon(process.env.DATABASE_URL);

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
