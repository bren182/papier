// @ts-check
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createPage, openPage } from './helpers.js';

/** @typedef {import('@playwright/test').APIRequestContext} APIRequestContext */
/** @typedef {{ id: string, name: string, type: string, config: Record<string, any> }} Prop */

const uid = () => randomUUID().slice(0, 6);

/** @param {APIRequestContext} request @param {string} url @param {object} [data] */
async function post(request, url, data) {
  const res = await request.post(url, { data });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

/** @param {APIRequestContext} request @param {string} db */
const rows = async (request, db) =>
  /** @type {{ title: string, props: Record<string, unknown> }[]} */ ((await post(request, `/api/databases/${db}/query`, {})).rows);

test('a Celebrate button moves the reminder on a year, and Undo puts it back', async ({ page, request }) => {
  const db = /** @type {{ id: string }} */ (await post(request, '/api/pages', { title: `Birthdays ${uid()}`, kind: 'database' })).id;
  const reminder = /** @type {Prop} */ (await post(request, `/api/databases/${db}/properties`, { name: 'Reminder', type: 'date' }));
  await post(request, `/api/databases/${db}/rows`, { title: 'Ana', props: { [reminder.id]: '2026-02-28' } });

  await page.goto(`/?p=${db}`);
  await expect(page.getByRole('tab', { selected: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add a property' }).click();
  await page.locator('[data-popover]').getByRole('button', { name: 'Button' }).click();

  const menu = page.locator('[data-popover]');
  await menu.getByLabel('Button label').fill('Celebrate');
  await menu.getByLabel('Add an action').selectOption({ label: 'Move a date' });
  await menu.getByLabel('Unit').selectOption('year');
  // Settings save after a short pause.
  await expect
    .poll(async () => (/** @type {{ properties: Prop[] }} */ (await (await request.get(`/api/databases/${db}`)).json())).properties.find((p) => p.type === 'button')?.config)
    .toMatchObject({ label: 'Celebrate', actions: [{ type: 'shift_date', propId: reminder.id, amount: 1, unit: 'year' }] });
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Celebrate' }).click();
  const toast = page.getByRole('status').filter({ hasText: 'Reminder →' });
  await expect(toast).toBeVisible();
  await expect.poll(async () => (await rows(request, db))[0]?.props[reminder.id]).toBe('2027-02-28');

  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await rows(request, db))[0]?.props[reminder.id]).toBe('2026-02-28');
});

test('a button block in a page adds a row to a database', async ({ page, request }) => {
  const title = `Workouts ${uid()}`;
  const db = /** @type {{ id: string }} */ (await post(request, '/api/pages', { title, kind: 'database' })).id;
  const id = await createPage(request, `Home ${uid()}`, [{ text: '' }]);
  await openPage(page, id);

  await page.locator('.papier-editor > .pb').first().click();
  await page.keyboard.type('/button');
  await page.keyboard.press('Enter');

  const settings = page.locator('[data-popover]');
  await settings.getByLabel('Button label').fill('Log a run');
  await settings.getByLabel('Add an action').selectOption({ label: 'Add a row to a database' });
  await settings.getByLabel('Database').selectOption({ label: title });
  await settings.getByLabel('Title').fill('Run');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Log a run' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Added a row' })).toBeVisible();
  await expect.poll(async () => (await rows(request, db)).map((r) => r.title)).toEqual(['Run']);
});
