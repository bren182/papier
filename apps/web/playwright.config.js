// @ts-check
import { defineConfig, devices } from '@playwright/test';

// Own ports so e2e runs never touch a `pnpm dev` session or its database.
// Overridable when those ports are taken (E2E_API_PORT / E2E_WEB_PORT).
const API_PORT = Number(process.env.E2E_API_PORT ?? 3100);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5174);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }],
  webServer: [
    {
      // A fresh in-memory database per run; each test makes its own pages.
      command: 'node src/index.ts',
      cwd: '../server',
      env: { PORT: String(API_PORT), DATABASE_PATH: ':memory:' },
      url: `http://127.0.0.1:${API_PORT}/api/pages`,
      reuseExistingServer: false,
    },
    {
      command: `pnpm exec vite --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      env: { PAPIER_API_URL: `http://127.0.0.1:${API_PORT}` },
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
    },
  ],
});
