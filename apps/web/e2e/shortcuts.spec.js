// @ts-check
import { expect, test } from '@playwright/test';

test('Ctrl+/ lists the keyboard shortcuts, with a filter', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeVisible();

  await page.keyboard.press('Control+/');
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('region')).toHaveCount(6); // General, Navigation, Editing, Turn into, Formatting, Markdown

  await dialog.getByLabel('Filter shortcuts').fill('strike');
  await expect(dialog.getByRole('listitem')).toHaveCount(1);
  await expect(dialog.getByRole('listitem')).toContainText('Strikethrough');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // Also from the sidebar.
  await page.getByRole('button', { name: /Keyboard shortcuts/ }).click();
  await expect(dialog).toBeVisible();
});
