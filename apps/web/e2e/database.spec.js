// @ts-check
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { openPage } from './helpers.js';

/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {import('@playwright/test').APIRequestContext} APIRequestContext */
/** @typedef {{ id: string, name: string, config: { options?: { id: string, name: string }[] } }} Prop */

const uid = () => randomUUID().slice(0, 6);

/**
 * A database with a Status select (Todo / Doing / Done), a Points number, and rows.
 * @param {APIRequestContext} request
 * @param {{ title: string, status?: 'Todo' | 'Doing' | 'Done', points?: number }[]} rows
 */
async function seedDatabase(request, rows) {
  const db = /** @type {{ id: string }} */ (await (await request.post('/api/pages', { data: { title: `DB ${uid()}`, kind: 'database' } })).json());
  const status = /** @type {Prop} */ (
    await (await request.post(`/api/databases/${db.id}/properties`, {
      data: { name: 'Status', type: 'select', config: { options: [{ name: 'Todo' }, { name: 'Doing' }, { name: 'Done' }] } },
    })).json()
  );
  const points = /** @type {Prop} */ (await (await request.post(`/api/databases/${db.id}/properties`, { data: { name: 'Points', type: 'number' } })).json());
  const optionId = (/** @type {string} */ name) => status.config.options?.find((o) => o.name === name)?.id;
  for (const r of rows) {
    const props = { ...(r.status ? { [status.id]: optionId(r.status) } : {}), ...(r.points !== undefined ? { [points.id]: r.points } : {}) };
    const res = await request.post(`/api/databases/${db.id}/rows`, { data: { title: r.title, props } });
    expect(res.ok()).toBe(true);
  }
  return { id: db.id, status, points, optionId };
}

/** Row titles as the table shows them, top to bottom. @param {Page} page */
const tableTitles = (page) => page.locator('[role=row][data-row-id] [data-title]').allTextContents();

/** Rows from the API, manual order. @param {APIRequestContext} request @param {string} dbId */
async function apiRows(request, dbId) {
  const res = await request.post(`/api/databases/${dbId}/query`, { data: {} });
  return /** @type {{ title: string, props: Record<string, unknown> }[]} */ ((await res.json()).rows);
}

/** Open a full-page database and wait for its table. @param {Page} page @param {string} id */
async function openDatabase(page, id) {
  await page.goto(`/?p=${id}`);
  await expect(page.getByRole('tab', { selected: true })).toBeVisible();
}

test('adds a row and edits its cells', async ({ page, request }) => {
  const db = await seedDatabase(request, []);
  await openDatabase(page, db.id);

  await page.getByRole('button', { name: 'New', exact: true }).last().click();
  const title = page.getByPlaceholder('Untitled');
  await expect(title).toBeFocused();
  await title.fill('Write tests');
  await title.press('Enter');
  await expect.poll(async () => (await apiRows(request, db.id)).map((r) => r.title)).toEqual(['Write tests']);

  const row = page.locator('[role=row][data-row-id]').first();
  await row.locator(`[data-col="${db.status.id}"] [role=button]`).click();
  await page.locator('[data-popover]').getByRole('button', { name: 'Doing' }).click();

  await row.locator(`[data-col="${db.points.id}"] [role=button]`).click();
  await page.keyboard.type('5');
  await page.keyboard.press('Enter');

  await expect.poll(async () => (await apiRows(request, db.id))[0]?.props).toEqual({
    [db.status.id]: db.optionId('Doing'),
    [db.points.id]: 5,
  });
});

test('sorts and filters in the view', async ({ page, request }) => {
  const db = await seedDatabase(request, [
    { title: 'A', points: 2 },
    { title: 'B', points: 8 },
    { title: 'C', points: 5 },
  ]);
  await openDatabase(page, db.id);
  await expect.poll(() => tableTitles(page)).toEqual(['A', 'B', 'C']);

  // Sort by Points, descending.
  await page.locator(`[data-col="${db.points.id}"][role=columnheader] button`).first().click();
  await page.getByRole('button', { name: 'Sort descending' }).click();
  await expect.poll(() => tableTitles(page)).toEqual(['B', 'C', 'A']);

  // Filter Points > 3.
  await page.getByRole('button', { name: /^Filter/ }).click();
  await page.getByRole('button', { name: 'Add filter' }).click();
  const pop = page.locator('[data-popover]');
  await pop.getByLabel('Property').selectOption({ label: 'Points' });
  await pop.getByLabel('Condition').selectOption('>');
  await pop.getByLabel('Value').fill('3');
  await expect.poll(() => tableTitles(page)).toEqual(['B', 'C']);

  // The view keeps it.
  await page.reload();
  await expect.poll(() => tableTitles(page)).toEqual(['B', 'C']);
});

test('dragging a card to another board column sets its value', async ({ page, request }) => {
  const db = await seedDatabase(request, [
    { title: 'Card one', status: 'Todo' },
    { title: 'Card two', status: 'Doing' },
  ]);
  await request.post(`/api/databases/${db.id}/views`, { data: { name: 'Board', type: 'board', config: { groupBy: db.status.id } } });
  await openDatabase(page, db.id);
  await page.getByRole('tab', { name: 'Board' }).click();

  const card = page.locator('[data-row-id]').filter({ hasText: 'Card one' });
  // Doing is fully on screen (Done may sit past the board's horizontal scroll).
  const doing = page.getByRole('region', { name: 'Doing' });
  await expect(card).toBeVisible();

  const saved = page.waitForResponse((r) => r.url().endsWith('/props') && r.request().method() === 'PATCH');
  // Drop below the cards: the end of the column.
  const box = await doing.boundingBox();
  await card.dragTo(doing, { targetPosition: { x: 40, y: /** @type {{ height: number }} */ (box).height - 12 } });
  await saved;
  await expect(doing.locator('[data-row-id]')).toHaveText(['Card two', 'Card one']);

  await page.reload();
  await page.getByRole('tab', { name: 'Board' }).click();
  await expect(page.getByRole('region', { name: 'Doing' }).locator('[data-row-id]')).toHaveText(['Card two', 'Card one']);
  expect((await apiRows(request, db.id)).find((r) => r.title === 'Card one')?.props[db.status.id]).toBe(db.optionId('Doing'));
});

test('an inline database lives in its block: delete trashes it, undo restores it', async ({ page, request }) => {
  const host = /** @type {{ id: string }} */ (await (await request.post('/api/pages', { data: { title: `Host ${uid()}` } })).json());
  await request.post(`/api/pages/${host.id}/blocks/batch`, {
    data: { upserts: [{ id: randomUUID(), type: 'paragraph', parentId: null, order: 'a0', content: [] }] },
  });
  await openPage(page, host.id);

  await page.locator('.papier-editor .pb-c').first().click();
  const created = page.waitForResponse((r) => r.url().endsWith('/api/pages') && r.request().method() === 'POST');
  await page.keyboard.type('/database');
  await page.keyboard.press('Enter');
  const dbId = /** @type {{ id: string }} */ (await (await created).json()).id;

  const inline = page.locator(`[data-database="${dbId}"]`);
  await expect(inline).toBeVisible();
  await inline.getByLabel('Database title').fill('Reading list');
  await inline.getByLabel('Database title').press('Enter');

  // Saved as a database block in the host page.
  await expect
    .poll(async () => (await (await request.get(`/api/pages/${host.id}/blocks`)).json()).map((/** @type {{ type: string }} */ b) => b.type))
    .toEqual(['database']);

  // Delete the block from its handle menu → the database goes to the trash.
  await page.locator('.papier-editor > .pb[data-type=databaseBlock]').hover({ position: { x: 20, y: 10 } });
  await page.getByRole('button', { name: 'Drag to move, click for options' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect.poll(async () => (await request.get(`/api/databases/${dbId}`)).status()).toBe(404);

  // Undo brings the block, and the database, back.
  await page.locator('.papier-editor').focus();
  await page.keyboard.press('Control+z');
  await expect(page.locator(`[data-database="${dbId}"]`)).toBeVisible();
  await expect.poll(async () => (await request.get(`/api/databases/${dbId}`)).status()).toBe(200);
});
