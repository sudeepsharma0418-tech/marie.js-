import { execSync } from 'node:child_process';

export default function setup() {
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    DATABASE_URL:
      process.env.E2E_DATABASE_URL ?? 'postgresql://hp:hp_dev_password@localhost:5432/hotelproc_e2e',
  };
  execSync('pnpm --filter @hp/api exec tsx src/db/reset.ts', { env, stdio: 'inherit' });
  execSync('pnpm --filter @hp/api exec tsx src/db/seed.ts', { env, stdio: 'inherit' });
}
