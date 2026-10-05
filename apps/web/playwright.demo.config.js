// @ts-check
import { defineConfig, devices } from '@playwright/test';
import { SETUP_TOKEN, STATE } from './e2e/demo-global-setup.js';

// Separate ports so demo recording never collides with the test suite or dev server.
const API_PORT = Number(process.env.DEMO_API_PORT ?? 3200);
const WEB_PORT = Number(process.env.DEMO_WEB_PORT ?? 5175);

export default defineConfig({
  testDir: 'e2e/demos',
  testMatch: '**/*.demo.js',
  fullyParallel: false,
  forbidOnly: false,
  retries: 0,
  reporter: 'list',
  globalSetup: './e2e/demo-global-setup.js',
  outputDir: 'e2e/demos/videos',
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    storageState: STATE,
    extraHTTPHeaders: { 'x-papier': '1' },
    video: 'on',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: 'demo-chrome',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        launchOptions: { slowMo: 40 },
      },
    },
  ],
  webServer: [
    {
      command: 'node src/index.ts',
      cwd: '../server',
      env: { PORT: String(API_PORT), DATABASE_PATH: ':memory:', PAPIER_SETUP_TOKEN: SETUP_TOKEN },
      url: `http://127.0.0.1:${API_PORT}/api/health`,
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
