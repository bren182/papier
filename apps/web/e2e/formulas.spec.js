// @ts-check
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

/** @typedef {import('@playwright/test').APIRequestContext} APIRequestContext */
/** @typedef {{ id: string, name: string, type: string, config: Record<string, unknown> }} Prop */

/** @param {APIRequestContext} request @param {string} url @param {object} [data] */
async function post(request, url, data) {
  const res = await request.post(url, { data });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

test('a formula column counts the days to the next birthday, and sorts by it', async ({ page, request }) => {
  const db = /** @type {{ id: string }} */ (await post(request, '/api/pages', { title: `Birthdays ${randomUUID().slice(0, 6)}`, kind: 'database' })).id;
  const born = /** @type {Prop} */ (await post(request, `/api/databases/${db}/properties`, { name: 'Birthdate', type: 'date' }));
  const today = new Date();
  /** A birthday `days` from today, in 1990. @param {number} days */
  const inDays = (days) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
    return `1990-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  await post(request, `/api/databases/${db}/rows`, { title: 'Later', props: { [born.id]: inDays(40) } });
  await post(request, `/api/databases/${db}/rows`, { title: 'Soon', props: { [born.id]: inDays(3) } });

  await page.goto(`/?p=${db}`);
  await page.getByRole('button', { name: 'Add a property' }).click();
  await page.locator('[data-popover]').getByRole('button', { name: 'Formula' }).click();
  const menu = page.locator('[data-popover]');
  await menu.getByLabel('Property name').fill('Days to go');
  await menu.getByLabel('Property name').press('Tab');
  const editor = menu.getByLabel('Formula', { exact: true });
  await editor.fill('dateBetween(nextAnniversary(prop("Birthdate")), today(), "days")');
  await expect(menu.getByText('→ number')).toBeVisible();

  // A mistake shows what's wrong.
  await editor.fill('dateBetween(prop("Birthdate"), today()');
  await expect(menu.getByText('Missing “)” at the end')).toBeVisible();
  await editor.fill('dateBetween(nextAnniversary(prop("Birthdate")), today(), "days")');

  const schema = async () => /** @type {Prop[]} */ ((await (await request.get(`/api/databases/${db}`)).json()).properties);
  await expect.poll(async () => (await schema()).find((p) => p.type === 'formula')?.config).toMatchObject({ resultType: 'number' });
  await page.keyboard.press('Escape');
  const formula = /** @type {Prop} */ ((await schema()).find((p) => p.type === 'formula'));

  const cell = (/** @type {string} */ title) => page.locator('[role=row]').filter({ hasText: title }).locator(`[data-col="${formula.id}"]`);
  await expect(cell('Soon')).toHaveText('3');
  await expect(cell('Later')).toHaveText('40');

  await page.locator(`[data-col="${formula.id}"][role=columnheader] button`).first().click();
  await page.getByRole('button', { name: 'Sort ascending' }).click();
  await expect.poll(() => page.locator('[role=row][data-row-id] [data-title]').allTextContents()).toEqual(['Soon', 'Later']);
});
