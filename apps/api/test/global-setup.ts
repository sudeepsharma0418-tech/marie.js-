import pg from 'pg';
import { runMigrations } from '../src/db/migrate';

/** Rebuilds the test database schema once per test run. */
export default async function setup() {
  const url =
    process.env.TEST_DATABASE_URL ?? 'postgresql://hp:hp_dev_password@localhost:5432/hotelproc_test';
  if (!/test/i.test(new URL(url).pathname))
    throw new Error('TEST_DATABASE_URL must point to a database whose name contains "test"');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query(
    'drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;',
  );
  await client.end();
  await runMigrations(url);
}
