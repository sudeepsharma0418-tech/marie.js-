import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/db/migrate.ts', 'src/db/seed.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // bundle the workspace package, keep real npm deps external
  noExternal: ['@hp/shared'],
});
