// @ts-check
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createPage, openPage } from './helpers.js';

/** @typedef {import('@playwright/test').APIRequestContext} APIRequestContext */
/** @typedef {{ id: string, name: string, config: { options?: { id: string, name: string }[] } }} Prop */

const uid = () => randomUUID().slice(0, 6);

/** @param {APIRequestContext} request @param {string} url @param {object} [data] */
async function post(request, url, data) {
  const res = await request.post(url, { data });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

/** @param {APIRequestContext} request @param {string} db */
const apiRows = async (request, db) => /** @type {{ id: string, title: string, props: Record<string, unknown> }[]} */ ((await post(request, `/api/databases/${db}/query`, {})).rows);

/** Local YYYY-MM-DD of a date. @param {Date} d */
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

test('"> " makes a toggle that folds its children away', async ({ page, request }) => {
  const id = await createPage(request, `Toggles ${uid()}`, [{ text: '' }]);
  await openPage(page, id);
  await page.locator('.papier-editor > .pb').first().click();
  await page.keyboard.type('> Details');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Hidden inside');
  const child = page.locator('.papier-editor > .pb').filter({ hasText: 'Hidden inside' });
  await expect(child).toHaveAttribute('data-indent', '1');
  await expect(child).toBeVisible();

  await page.locator('.papier-editor').getByRole('button', { name: 'Collapse', exact: true }).click();
  await expect(child).toBeHidden();
  await page.locator('.papier-editor').getByRole('button', { name: 'Expand', exact: true }).click();
  await expect(child).toBeVisible();
});

test('calendar: add a row on a day, then drag it to another day', async ({ page, request }) => {
  const db = /** @type {{ id: string }} */ (await post(request, '/api/pages', { title: `Events ${uid()}`, kind: 'database' })).id;
  const when = /** @type {Prop} */ (await post(request, `/api/databases/${db}/properties`, { name: 'When', type: 'date' }));
  await post(request, `/api/databases/${db}/views`, { name: 'Calendar', type: 'calendar' });

  await page.goto(`/?p=${db}`);
  await page.getByRole('tab', { name: 'Calendar' }).click();
  const now = new Date();
  const day = iso(new Date(now.getFullYear(), now.getMonth(), 10));
  const other = iso(new Date(now.getFullYear(), now.getMonth(), 12));
  await page.locator(`[data-day="${day}"]`).hover();
  await page.getByRole('button', { name: `New on ${day}` }).click();
  await expect.poll(async () => (await apiRows(request, db)).map((r) => r.props[when.id])).toEqual([day]);

  const card = page.locator(`[data-day="${day}"] [data-row-id]`);
  await expect(card).toHaveCount(1);
  await card.dragTo(page.locator(`[data-day="${other}"]`));
  await expect.poll(async () => (await apiRows(request, db)).map((r) => r.props[when.id])).toEqual([other]);
});

test('group a table by Status', async ({ page, request }) => {
  const db = /** @type {{ id: string }} */ (await post(request, '/api/pages', { title: `Grouped ${uid()}`, kind: 'database' })).id;
  const status = /** @type {Prop} */ (await post(request, `/api/databases/${db}/properties`, { name: 'Status', type: 'select', config: { options: [{ name: 'Todo' }, { name: 'Done' }] } }));
  const [todo, done] = (status.config.options ?? []).map((o) => o.id);
  await post(request, `/api/databases/${db}/rows`, { title: 'Write', props: { [status.id]: todo } });
  await post(request, `/api/databases/${db}/rows`, { title: 'Ship', props: { [status.id]: done } });
  await post(request, `/api/databases/${db}/rows`, { title: 'Loose' });

  await page.goto(`/?p=${db}`);
  await page.getByRole('button', { name: 'Group', exact: true }).click();
  await page.locator('[data-popover]').getByRole('button', { name: 'Status' }).click();
  await page.keyboard.press('Escape');

  const section = (/** @type {string} */ name) => page.getByRole('region', { name });
  await expect(section('Todo')).toContainText('Write');
  await expect(section('Done')).toContainText('Ship');
  await expect(section('No Status')).toContainText('Loose');

  // "New" in a group starts the row in it.
  await section('Done').getByRole('button', { name: 'New', exact: true }).click();
  await expect.poll(async () => (await apiRows(request, db)).filter((r) => r.props[status.id] === done).length).toBe(2);
});
