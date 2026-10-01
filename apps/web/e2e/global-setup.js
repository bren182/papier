// @ts-check
// Signs the e2e run in once: creates the owner on the fresh in-memory server and
// saves the session cookie, which every test's `page` and `request` then share.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { request } from '@playwright/test';

export const SETUP_TOKEN = 'e2e-setup';
export const STATE = 'e2e/.auth/state.json';
export const OWNER = { email: 'e2e@example.com', name: 'E2E', password: 'e2e password' };

/** @param {import('@playwright/test').FullConfig} config */
export default async function globalSetup(config) {
  const baseURL = config.projects[0]?.use.baseURL;
  const ctx = await request.newContext({ baseURL, extraHTTPHeaders: { 'x-papier': '1' } });
  const res = await ctx.post('/api/auth/setup', { data: { ...OWNER, setupToken: SETUP_TOKEN } });
  if (!res.ok()) throw new Error(`e2e setup failed: ${res.status()} ${await res.text()}`);
  mkdirSync(dirname(STATE), { recursive: true });
  await ctx.storageState({ path: STATE });
  await ctx.dispose();
}
