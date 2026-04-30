import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/index.ts', 'src/seed.ts'],
      // Phase 2 task 2.1 — thresholds inform `npm run test:coverage`. CI
      // wiring lands in Phase 8, at which point a regression below these
      // numbers will fail the build. Defaults reflect the post-Phase-2
      // expected floor; raise as more tests land.
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
    },
  },
  resolve: {
    // Strip .js extensions added for ESM interop so Vitest can resolve TS files
    alias: [
      { find: /^(\.{1,2}\/.+)\.js$/, replacement: '$1' },
    ],
  },
});
