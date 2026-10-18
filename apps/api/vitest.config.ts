import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // integration tests share one database, so run files one at a time
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
