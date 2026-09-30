import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Playwright specs run in a real browser via `pnpm test:e2e`, not here.
    exclude: [...configDefaults.exclude, '**/e2e/**'],
  },
});
