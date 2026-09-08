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
    maxWorkers: 1,
    minWorkers: 1,
    // Each integration file owns a temporary PGlite directory and removes it
    // during cleanup. Keeping every file in one fork leaves later files with
    // the first file's cached database runtime and lets the worker exit after
    // its directory is removed. Isolate files at the worker boundary instead.
    poolOptions: { forks: { singleFork: false } },
  },
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
      // The test runner has no React Server Component boundary.
      'server-only': path.resolve(process.cwd(), 'tests/stubs/empty.ts'),
    },
  },
});
