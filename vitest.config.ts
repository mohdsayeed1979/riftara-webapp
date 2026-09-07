import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: true,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
      // The test runner has no React Server Component boundary.
      'server-only': path.resolve(process.cwd(), 'tests/stubs/empty.ts'),
    },
  },
});
