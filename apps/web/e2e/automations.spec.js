// @ts-check
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

/** @typedef {import('@playwright/test').APIRequestContext} APIRequestContext */
/** @typedef {{ id: string, name: string, type: string }} Prop */

/** @param {APIRequestContext} request @param {string} url @param {object} [data] */
async function post(request, url, data) {
  const res = await request.post(url, { data });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

/** The viewer's local date, as the automation will see it. */
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test('when Done is checked, set Completed to today', async ({ page, request }) => {
  const db = /** @type {{ id: string }} */ (await post(request, '/api/pages', { title: `Tasks ${randomUUID().slice(0, 6)}`, kind: 'database' })).id;
  const done = /** @type {Prop} */ (await post(request, `/api/databases/${db}/properties`, { name: 'Done', type: 'checkbox' }));
  const completed = /** @type {Prop} */ (await post(request, `/api/databases/${db}/properties`, { name: 'Completed', type: 'date' }));
  const row = (await post(request, `/api/databases/${db}/rows`, { title: 'Write tests' })).id;

  await page.goto(`/?p=${db}`);
  await expect(page.getByRole('tab', { selected: true })).toBeVisible();
  await page.getByRole('button', { name: 'Automations' }).click();
  await page.locator('[data-popover]').getByRole('button', { name: 'New automation' }).click();

  const editor = page.locator('[data-popover]');
  await editor.getByLabel('Automation name').fill('Stamp completion');
  await editor.getByLabel('Watched property').selectOption({ label: 'Done' });
  await editor.getByRole('button', { name: 'Only when it becomes…' }).click();
  await editor.getByLabel('Add an action').selectOption({ label: 'Set a date to today' });
  await expect
    .poll(async () => (await (await request.get(`/api/databases/${db}/automations`)).json())[0])
    .toMatchObject({
      name: 'Stamp completion',
      trigger: { type: 'prop_changed', propId: done.id, when: { propId: done.id, op: 'is', value: true } },
      actions: [{ type: 'set_today', propId: completed.id }],
    });
  await page.keyboard.press('Escape');

  // Tick the box in the table: the date appears.
  await page.locator(`[role=row][data-row-id="${row}"] [data-col="${done.id}"] [role=button]`).click();
  await expect
    .poll(async () => (await post(request, `/api/databases/${db}/query`, {})).rows[0].props[completed.id])
    .toBe(localToday());
  await expect(page.locator(`[role=row][data-row-id="${row}"] [data-col="${completed.id}"]`)).toHaveText('Today');
});
