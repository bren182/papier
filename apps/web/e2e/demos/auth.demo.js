// @ts-check
import { expect, test } from '@playwright/test';

test('invite flow — generate a link in settings, join as a new user', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).first().waitFor();

  // Let the viewer see the home screen briefly
  await page.waitForTimeout(1000);

  // Open Settings
  await page.getByRole('button', { name: 'Settings' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Account' }).click();
  await page.waitForTimeout(800);

  // Generate invite link
  await dialog.getByRole('button', { name: 'Invite someone…' }).click();
  const linkSpan = dialog.locator('span.font-mono');
  await expect(linkSpan).toBeVisible();

  // Pause so the viewer can read the generated link
  await page.waitForTimeout(2000);

  // Extract token and close settings
  const fullUrl = await linkSpan.textContent();
  const token = new URL(/** @type {string} */ (fullUrl)).searchParams.get('join');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);

  // Clear session to simulate the invitee (a different, unauthenticated user) opening the link
  await page.context().clearCookies();
  await page.goto(`/?join=${token}`);
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await page.waitForTimeout(1000);

  // Fill in the form slowly so the viewer can follow
  await page.getByLabel('Your name').click();
  await page.keyboard.type('Alex Designer', { delay: 60 });
  await page.waitForTimeout(400);

  await page.getByLabel('Email').click();
  await page.keyboard.type('alex@example.com', { delay: 50 });
  await page.waitForTimeout(400);

  await page.getByLabel('Password').click();
  await page.keyboard.type('my-secure-pass-123', { delay: 40 });
  await page.waitForTimeout(600);

  await page.getByRole('button', { name: 'Create account' }).click();

  // Wait for the app to load as the new user
  await expect(page.getByRole('button', { name: 'Settings' }).first()).toBeVisible();
  await page.waitForTimeout(2000);
});
