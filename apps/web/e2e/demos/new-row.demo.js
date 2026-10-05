// @ts-check
import { expect, test } from '@playwright/test';

test('new row UX — focus lands on title, row scrolls into view', async ({ page, request }) => {
  // Create a database with a handful of rows
  const res = await request.post('/api/pages', { data: { title: 'Task tracker', kind: 'database' } });
  const { id: dbId } = await res.json();

  for (let i = 1; i <= 5; i++) {
    await request.post(`/api/databases/${dbId}/rows`, { data: { title: `Task ${i}` } });
  }

  await page.goto(`/?p=${dbId}`);
  // Scope rows and buttons to the page content area (not sidebar)
  const pageArea = page.locator('[data-page-scroll]');
  const rows = pageArea.locator('[role=row][data-row-id]');
  await rows.first().waitFor();
  await expect(rows).toHaveCount(5);
  await page.waitForTimeout(800);

  // Click the "New" button in the database toolbar
  await pageArea.getByRole('button', { name: 'New' }).first().click();
  await page.waitForTimeout(1200);

  // A new row appears immediately in edit mode — title input is auto-focused
  await expect(rows).toHaveCount(6, { timeout: 6000 });
  const titleInput = page.locator('input[placeholder="Untitled"]');
  await expect(titleInput).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(400);

  // Type a name for the new row
  await titleInput.fill('New task from New button');
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);

  // Row is now saved with its new title
  await expect(page.getByText('New task from New button')).toBeVisible();
  await page.waitForTimeout(800);
});
