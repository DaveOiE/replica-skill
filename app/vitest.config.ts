import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'], testTimeout: 120_000, hookTimeout: 120_000, fileParallelism: false,
    coverage: {
      provider: 'v8', reporter: ['text-summary', 'text'],
      // The money engine must be fully covered: every branch of rounding, tax, discount, coupons, refunds and re-pricing.
      include: ['src/domain/engine/**/*.ts'], exclude: ['src/domain/engine/index.ts'],
      thresholds: { lines: 100, functions: 100, statements: 100, branches: 100 },
    },
  },
});
