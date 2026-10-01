// @ts-check
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createPage, openPage, outline } from './helpers.js';

/** @typedef {import('@playwright/test').APIRequestContext} APIRequestContext */

const uid = () => randomUUID().slice(0, 6);
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test('save a page as a template, then start a new page from it', async ({ page, request }) => {
  const title = `Standup ${uid()}`;
  const id = await createPage(request, title, [{ text: 'Yesterday' }, { text: 'Today' }, { text: 'Blockers', indent: 1 }]);
  await openPage(page, id);

  await page.getByRole('button', { name: 'Page actions' }).click();
  await page.getByRole('button', { name: 'Save as template' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved to templates');

  await page.getByRole('button', { name: 'Templates' }).click();
  const library = page.getByRole('dialog', { name: 'Templates' });
  const item = library.getByRole('listitem').filter({ hasText: title });
  await item.getByRole('button', { name: 'Use' }).click();

  await expect(library).toBeHidden();
  await expect(page).not.toHaveURL(new RegExp(id));
  await expect.poll(() => outline(page)).toEqual(['Yesterday@0', 'Today@0', 'Blockers@1']);
  await expect(page.getByRole('note')).toHaveCount(0); // a normal page, no template banner
});

test('“Today ↻” in a template becomes the day it is used', async ({ page, request }) => {
  const title = `Journal ${uid()}`;
  const res = await request.post('/api/pages', { data: { title } });
  const { id } = await res.json();
  await request.post(`/api/pages/${id}/blocks/batch`, {
    data: { upserts: [{ id: randomUUID(), type: 'paragraph', parentId: null, order: 'a0', content: [{ type: 'text', text: 'Written ' }, { type: 'date', props: { date: '@today' } }] }] },
  });
  const template = await (await request.post(`/api/pages/${id}/duplicate`, { data: { asTemplate: true, today: localToday() } })).json();

  // The template shows the dynamic date as such…
  await openPage(page, template.id);
  await expect(page.getByRole('note')).toContainText('Template');
  await expect(page.locator('.papier-editor .papier-date')).toHaveText('@Today ↻');

  // …and a page made from it gets the real date.
  await page.getByRole('button', { name: 'Use template' }).click();
  await expect(page).not.toHaveURL(new RegExp(template.id));
  await expect(page.locator('.papier-editor .papier-date')).toHaveText('@Today');
});

test('database templates: New uses the view’s default template', async ({ page, request }) => {
  const db = await (await request.post('/api/pages', { data: { title: `Tasks ${uid()}`, kind: 'database' } })).json();
  const status = await (
    await request.post(`/api/databases/${db.id}/properties`, { data: { name: 'Status', type: 'select', config: { options: [{ name: 'Todo' }, { name: 'Doing' }] } } })
  ).json();
  await page.goto(`/?p=${db.id}`);

  // + New template → opens the template (in the side peek) to fill in.
  const peek = page.getByRole('complementary', { name: 'Side peek' });
  await page.getByRole('button', { name: 'New from template' }).click();
  await page.getByRole('button', { name: 'New template' }).click();
  await expect(peek.getByRole('note')).toContainText('Template in');
  await peek.locator('[data-prop="Status"]').click();
  await page.locator('[data-popover]').getByRole('button', { name: 'Doing' }).click();
  await expect(peek.locator('[data-prop="Status"]')).toHaveText('Doing');

  // Back in the database: make it the default, then New.
  await peek.getByRole('button', { name: 'Close side peek' }).click();
  await expect(peek).toHaveCount(0);
  await page.getByRole('button', { name: 'New from template' }).click();
  const menu = page.locator('[data-popover]');
  await menu.getByText('Untitled template').hover();
  await menu.getByRole('button', { name: 'Set default' }).click();
  // Exact: while hovered, the row also shows “Unset default”.
  await expect(menu.getByText('Default', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'New', exact: true }).first().click();
  // A templated row opens straight away, already filled in.
  await expect(peek.locator('[data-prop="Status"]')).toHaveText('Doing');
  await expect(peek.getByRole('note')).toHaveCount(0);

  const rows = (await (await request.post(`/api/databases/${db.id}/query`, { data: {} })).json()).rows;
  expect(rows.map((/** @type {{ props: Record<string, unknown> }} */ r) => r.props[status.id])).toEqual([status.config.options[1].id]);
});
