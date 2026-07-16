import { neon } from '@neondatabase/serverless';

export const sql = neon(process.env.DATABASE_URL);

export const STATUSES = ['new', 'contacted', 'callback', 'interested', 'not_interested', 'won', 'lost'];
