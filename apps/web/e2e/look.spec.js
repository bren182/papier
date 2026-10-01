// @ts-check
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createPage, openPage } from './helpers.js';

const uid = () => randomUUID().slice(0, 6);

test('delete a page, then restore it from the trash', async ({ page, request }) => {
  const title = `Doomed ${uid()}`;
  const id = await createPage(request, title, [{ text: 'Keep me' }]);
  await openPage(page, id);

  await page.getByRole('button', { name: 'Page actions' }).click();
  await page.locator('[data-popover]').getByRole('button', { name: 'Delete' }).click();
  const sidebar = page.getByRole('tree', { name: 'Pages' });
  await expect(sidebar.getByRole('button', { name: title, exact: true })).toHaveCount(0);

  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Trash' }).click();
  const trash = page.getByRole('dialog', { name: 'Trash' });
  await trash.getByLabel('Filter the trash').fill(title);
  const row = trash.getByRole('listitem').filter({ hasText: title });
  await expect(row).toContainText('Deleted just now');
  await row.getByRole('button', { name: 'Restore' }).click();
  await expect(trash.getByText('Nothing in the trash matches.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sidebar.getByRole('button', { name: title, exact: true })).toBeVisible();
});

test('a page gets an icon (shown in the sidebar) and a cover', async ({ page, request }) => {
  const title = `Decorated ${uid()}`;
  const id = await createPage(request, title, [{ text: 'Hello' }]);
  await openPage(page, id);

  await page.getByRole('button', { name: '☺ Add icon' }).click();
  await page.getByLabel('Search emoji').fill('rocket');
  await page.getByLabel('Search emoji').press('Enter');
  await expect(page.getByRole('button', { name: 'Change icon' })).toHaveText('🚀');
  await expect(page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem').filter({ hasText: title })).toContainText('🚀');

  await page.getByRole('button', { name: '▭ Add cover' }).click();
  await page.getByRole('button', { name: 'Cover Dawn' }).click();
  await expect(page.locator('[data-cover="dawn"]')).toBeVisible();
  await expect.poll(async () => (await (await request.get(`/api/pages/${id}`)).json()).page).toMatchObject({ icon: '🚀', appearance: { cover: 'dawn' } });
});

test('the command palette runs commands: new page, theme', async ({ page, request }) => {
  const id = await createPage(request, `Start ${uid()}`, [{ text: 'x' }]);
  await openPage(page, id);

  await page.keyboard.press('Control+k');
  await page.keyboard.type('> new page');
  await expect(page.getByRole('option', { name: 'New page' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect.poll(() => new URL(page.url()).searchParams.get('p')).not.toBe(id);
  // The new page's title takes focus; let it, so it doesn't take it back from the palette.
  await expect(page.getByLabel('Page title')).toBeFocused();

  await page.keyboard.press('Control+k');
  await expect(page.getByRole('combobox', { name: 'Search pages' })).toBeFocused();
  await page.keyboard.type('theme dusk');
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dusk');
});
