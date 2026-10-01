// @ts-check
import { expect, test } from '@playwright/test';
import { OWNER } from './global-setup.js';

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('shows the sign-in, signs in, and signs out', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    await page.getByLabel('Email').fill(OWNER.email);
    await page.getByLabel('Password').fill('not the password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toHaveText('Wrong email or password');

    await page.getByLabel('Password').fill(OWNER.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('[data-settings-anchor]')).toBeVisible();

    await page.locator('[data-settings-anchor]').click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });
});

test('a session that ends mid-use asks to sign in again and keeps the edit', async ({ page, request, context }) => {
  const res = await request.post('/api/pages', { data: { title: 'Session edit' } });
  const { id } = await res.json();
  await page.goto(`/?p=${id}`);
  const editor = page.locator('.papier-editor');
  await expect(editor).toBeVisible();

  // Sign out behind the app's back: its cookie is dead from here on.
  await context.clearCookies();
  await editor.click();
  await page.keyboard.type('typed while signed out');
  await expect(page.getByRole('dialog', { name: 'Sign in again' })).toBeVisible();

  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByLabel('Password').fill(OWNER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('dialog', { name: 'Sign in again' })).toBeHidden();

  await expect
    .poll(async () => JSON.stringify(await (await page.request.get(`/api/pages/${id}/blocks`)).json()))
    .toContain('typed while signed out');
});
