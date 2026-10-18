import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'apps/api/drizzle/**', '.claude/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  { files: ['apps/web/public/sw.js'], languageOptions: { globals: globals.serviceworker } },
  { files: ['apps/web/**/*.{ts,tsx}'], languageOptions: { globals: globals.browser } },
  {
    // UI pages read API JSON loosely; a generated typed API client is planned (docs/KNOWN_LIMITATIONS.md)
    files: ['apps/web/src/pages/**/*.tsx'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    // tests read loosely typed JSON responses
    files: ['**/test/**/*.ts', '**/*.test.ts', '**/*.test.tsx', 'e2e/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
