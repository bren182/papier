// @ts-check
import { expect, test } from '@playwright/test';
import { OWNER } from './global-setup.js';

// ---------------------------------------------------------------------------
// Invite flow
// ---------------------------------------------------------------------------

test('owner creates an invite link; invitee joins and signs in', async ({ page, browser }) => {
  await page.goto('/');
  // Wait for the app to be fully loaded (signed-in state)
  await expect(page.getByRole('button', { name: 'Settings' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).first().click();

  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Account' }).click();

  await dialog.getByRole('button', { name: 'Invite someone…' }).click();
  // Wait for the invite URL span to appear
  const linkSpan = dialog.locator('span.font-mono');
  await expect(linkSpan).toBeVisible();
  const fullUrl = await linkSpan.textContent();
  expect(fullUrl).toBeTruthy();
  // Extract the token from the /?join=<token> URL
  const token = new URL(/** @type {string} */ (fullUrl)).searchParams.get('join');
  expect(token).toBeTruthy();

  // Open a fresh incognito context — no session cookie
  const incognito = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const joinPage = await incognito.newPage();
  await joinPage.goto(`/?join=${token}`);

  await expect(joinPage.getByRole('heading', { name: 'Create your account' })).toBeVisible();

  await joinPage.getByLabel('Your name').fill('Invitee User');
  await joinPage.getByLabel('Email').fill('invitee@example.com');
  await joinPage.getByLabel('Password').fill('invitee-password-123');
  await joinPage.getByRole('button', { name: 'Create account' }).click();

  // After joining the main app should be visible
  await expect(joinPage.getByRole('button', { name: 'Settings' }).first()).toBeVisible();

  await incognito.close();

  // The invite is now consumed — revisiting should show "Invite expired"
  const incognito2 = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const expiredPage = await incognito2.newPage();
  await expiredPage.goto(`/?join=${token}`);
  await expect(expiredPage.getByRole('heading', { name: 'Invite expired' })).toBeVisible();
  await incognito2.close();
});

test('rate limit blocks repeated failed accept attempts', async ({ request }) => {
  // Use a fake non-existent token with a valid body — each attempt hits the
  // preCheck (token not found), calls throttle.fail(), and returns 410.
  // After 3 free failures the 4th attempt should be 429.
  const fakeToken = 'a'.repeat(64);
  let lastStatus = 0;
  for (let i = 0; i < 4; i++) {
    const res = await request.post(`/api/invites/${fakeToken}/accept`, {
      data: { name: 'X', email: `ratelimit${i}@example.com`, password: 'validpassword123' },
      headers: { 'x-papier': '1' },
      failOnStatusCode: false,
    });
    lastStatus = res.status();
  }
  expect(lastStatus).toBe(429);
});

// ---------------------------------------------------------------------------
// Sign in / sign out
// ---------------------------------------------------------------------------

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('shows the landing page, navigates to sign-in, signs in, and signs out', async ({ page }) => {
    await page.goto('/');
    // Landing page is shown first to unauthenticated visitors
    await expect(page.getByRole('button', { name: 'Sign in' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Sign in' }).first().click();

    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    await page.getByLabel('Email').fill(OWNER.email);
    await page.getByLabel('Password').fill('not the password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toHaveText('Wrong email or password');

    await page.getByLabel('Password').fill(OWNER.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('button', { name: 'Settings' }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Settings' }).first().click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    // After sign-out the landing page should be shown
    await expect(page.getByRole('button', { name: 'Sign in' }).first()).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Sign in' }).first()).toBeVisible();
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
