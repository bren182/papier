// @ts-check
import { expect, test } from '@playwright/test';

test('landing page — aligned nav and hero on a wide viewport', async ({ page }) => {
  // Visit as unauthenticated user
  await page.context().clearCookies();
  await page.goto('/');

  // Wait for landing page to paint
  await expect(page.getByRole('heading', { name: 'Papier', exact: true }).first()).toBeVisible();
  await page.waitForTimeout(1200);

  // Scroll down slowly so the viewer can see the full page
  await page.evaluate(() => window.scrollTo({ top: 300, behavior: 'smooth' }));
  await page.waitForTimeout(1000);

  await page.evaluate(() => window.scrollTo({ top: 700, behavior: 'smooth' }));
  await page.waitForTimeout(1000);

  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await page.waitForTimeout(800);

  // Switch install tabs to show the page interaction
  await page.getByRole('button', { name: 'Linux' }).click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'Docker' }).click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'Windows' }).click();
  await page.waitForTimeout(1000);
});
