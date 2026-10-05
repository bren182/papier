// @ts-check
import { expect, test } from '@playwright/test';

test('date labels — weekday names for near dates, absolute for distant ones', async ({ page, request }) => {
  // Create a page with date mentions across the range
  const today = new Date();
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  const iso = (/** @type {Date} */ d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (/** @type {number} */ n) => {
    const d = new Date(today);
    d.setDate(d.getDate() + n);
    return d;
  };

  const blocks = [
    { text: 'Today', type: 'heading' },
    // Build content via the editor rather than raw blocks for date nodes:
    // we'll type them in the editor below
    { text: 'Upcoming and past dates:' },
  ];

  const res = await request.post('/api/pages', { data: { title: 'Date label showcase' } });
  const { id } = await res.json();

  await page.goto(`/?p=${id}`);
  await page.locator('.papier-editor').waitFor();
  await page.waitForTimeout(800);

  // Click last block and type date mentions
  const editor = page.locator('.papier-editor');
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');

  // Insert a "Tomorrow" date via @ mention
  await page.keyboard.type('@tomorrow');
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);

  await page.keyboard.press('Enter');
  await page.keyboard.type('@yesterday');
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);

  // A date 3 days from now (shows weekday name)
  await page.keyboard.press('Enter');
  await page.keyboard.type(`@${iso(addDays(3))}`);
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);

  // A date 3 weeks out (shows "In 3 weeks")
  await page.keyboard.press('Enter');
  await page.keyboard.type(`@${iso(addDays(21))}`);
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);

  // Pause to let viewer read the labels
  await page.waitForTimeout(2000);

  // Verify the weekday label appears (3 days from now)
  const expectedWeekday = addDays(3).toLocaleDateString(undefined, { weekday: 'long' });
  await expect(editor.getByText(expectedWeekday)).toBeVisible();
});
