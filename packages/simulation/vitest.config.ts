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
    },
  },
  resolve: {
    // Strip .js extensions added for ESM interop so Vitest can resolve TS files
    alias: [
      { find: /^(\.{1,2}\/.+)\.js$/, replacement: '$1' },
    ],
  },
});
