// @ts-check
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { request } from '@playwright/test';

export const SETUP_TOKEN = 'demo-setup';
export const STATE = 'e2e/.auth/demo-state.json';
export const OWNER = { email: 'demo@example.com', name: 'Demo', password: 'demo password' };

/** @param {import('@playwright/test').FullConfig} config */
export default async function globalSetup(config) {
  const baseURL = config.projects[0]?.use.baseURL;
  const ctx = await request.newContext({ baseURL, extraHTTPHeaders: { 'x-papier': '1' } });
  const res = await ctx.post('/api/auth/setup', { data: { ...OWNER, setupToken: SETUP_TOKEN } });
  if (!res.ok()) throw new Error(`demo setup failed: ${res.status()} ${await res.text()}`);
  mkdirSync(dirname(STATE), { recursive: true });
  await ctx.storageState({ path: STATE });
  await ctx.dispose();
}
