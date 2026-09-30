// @ts-check
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

/** @typedef {import('@playwright/test').APIRequestContext} APIRequestContext */
/** @typedef {{ id: string, name: string, config: { options?: { id: string, name: string }[] } }} Prop */

const uid = () => randomUUID().slice(0, 6);

/** @param {APIRequestContext} request @param {string} url @param {object} [data] */
async function post(request, url, data) {
  const res = await request.post(url, { data });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

/** A database with Status (select) and Points (number), rows A–D. @param {APIRequestContext} request */
async function seed(request, title = `Rows ${uid()}`) {
  const db = /** @type {{ id: string }} */ (await post(request, '/api/pages', { title, kind: 'database' })).id;
  const status = /** @type {Prop} */ (await post(request, `/api/databases/${db}/properties`, { name: 'Status', type: 'select', config: { options: [{ name: 'Todo' }, { name: 'Done' }] } }));
  const points = /** @type {Prop} */ (await post(request, `/api/databases/${db}/properties`, { name: 'Points', type: 'number' }));
  const ids = [];
  for (const t of ['A', 'B', 'C', 'D']) ids.push((await post(request, `/api/databases/${db}/rows`, { title: t, props: t === 'A' ? { [points.id]: 5 } : {} })).id);
  return { db, title, status, points, ids };
}

/** @param {APIRequestContext} request @param {string} db */
const apiRows = async (request, db) => /** @type {{ id: string, title: string, props: Record<string, unknown> }[]} */ ((await post(request, `/api/databases/${db}/query`, {})).rows);

test('select rows with Shift, set a property on all, then delete them', async ({ page, request }) => {
  const s = await seed(request);
  await page.goto(`/?p=${s.db}`);
  await page.getByLabel('Select A', { exact: true }).click({ force: true });
  await page.getByLabel('Select C', { exact: true }).click({ modifiers: ['Shift'] });
  const bar = page.getByRole('toolbar', { name: 'Selected rows' });
  await expect(bar).toContainText('3 selected');

  await bar.getByRole('button', { name: 'Set property…' }).click();
  await page.locator('[data-popover]').getByRole('button', { name: 'Status' }).click();
  await page.locator('[data-popover]').getByText('Pick a value…').click();
  await page.locator('[data-popover]').last().getByRole('button', { name: 'Done' }).click();
  const done = s.status.config.options?.find((o) => o.name === 'Done')?.id;
  await expect.poll(async () => (await apiRows(request, s.db)).map((r) => r.props[s.status.id] ?? null)).toEqual([done, done, done, null]);

  await bar.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(async () => (await apiRows(request, s.db)).map((r) => r.title)).toEqual(['D']);
});

test('drag the fill handle to copy a value down', async ({ page, request }) => {
  const s = await seed(request);
  await page.goto(`/?p=${s.db}`);
  const cell = (/** @type {string} */ id) => page.locator(`[role=row][data-row-id="${id}"] [data-col="${s.points.id}"]`);
  await cell(s.ids[0] ?? '').hover();
  const handle = cell(s.ids[0] ?? '').getByTitle('Drag to fill');
  const from = await handle.boundingBox();
  const to = await cell(s.ids[2] ?? '').boundingBox();
  if (!from || !to) throw new Error('no boxes');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await apiRows(request, s.db)).map((r) => r.props[s.points.id] ?? null)).toEqual([5, 5, 5, null]);
  await expect(page.getByRole('status').filter({ hasText: 'Filled Points into 2 rows' })).toBeVisible();
});

test('right-click a row and move it to another database', async ({ page, request }) => {
  const s = await seed(request);
  const targetTitle = `Standups ${uid()}`;
  const target = /** @type {{ id: string }} */ (await post(request, '/api/pages', { title: targetTitle, kind: 'database' })).id;
  await post(request, `/api/databases/${target}/properties`, { name: 'Points', type: 'number' });

  await page.goto(`/?p=${s.db}`);
  await page.locator(`[role=row][data-row-id="${s.ids[0]}"]`).click({ button: 'right', position: { x: 200, y: 10 } });
  await page.locator('[data-popover]').getByRole('button', { name: 'Move to…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Move to' });
  await dialog.getByLabel('Find a database').fill(targetTitle);
  await dialog.getByRole('button', { name: targetTitle }).click();
  await expect(dialog.getByLabel('Preview')).toContainText('Points → Points');
  await expect(dialog.getByLabel('Preview')).toContainText('Dropped (no property with that name there): Status');
  await dialog.getByRole('button', { name: 'Move', exact: true }).click();

  await expect(page.getByRole('status').filter({ hasText: 'Moved 1 row' })).toBeVisible();
  await expect.poll(async () => (await apiRows(request, s.db)).map((r) => r.title)).toEqual(['B', 'C', 'D']);
  await expect.poll(async () => (await apiRows(request, target)).map((r) => r.title)).toEqual(['A']);
});
