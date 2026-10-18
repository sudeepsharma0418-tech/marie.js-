import { createDb } from './client';
import { DEMO_PASSWORD, seedDemo } from './seed-data';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true') {
  throw new Error(
    'Refusing to load demo data in production (set ALLOW_DEMO_SEED=true only for a demo instance).',
  );
}
const { db, pool } = createDb(url, 2);
try {
  await seedDemo(db);
  console.log('Demo data loaded. All demo accounts use the password:', DEMO_PASSWORD);
  console.log('  owner@demo.local, procurement@demo.local, hub@demo.local, driver@demo.local');
  console.log('  manager@tinau.demo.local, purchase@tinau.demo.local, store@tinau.demo.local');
  console.log('  manager@lumbini.demo.local, manager@hills.demo.local');
} finally {
  await pool.end();
}
