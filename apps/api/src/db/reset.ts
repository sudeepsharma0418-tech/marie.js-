import pg from 'pg';
import { runMigrations } from './migrate';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
if (process.env.NODE_ENV === 'production' || /prod/i.test(new URL(url).pathname)) {
  throw new Error('db:reset is disabled for production databases');
}
const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query(
  'drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;',
);
await client.end();
await runMigrations(url);
console.log('Database reset and migrated. Run pnpm db:seed to load demo data.');
