// @ts-check
import { expect, test } from '@playwright/test';

/** @typedef {import('@playwright/test').APIRequestContext} APIRequestContext */

/** @param {APIRequestContext} request @param {string} url @param {object} [data] */
async function post(request, url, data) {
  const res = await request.post(url, { data });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

/** A birthday `days` from today, in 1990 (local date). @param {number} days */
function inDays(days) {
  const t = new Date();
  const d = new Date(t.getFullYear(), t.getMonth(), t.getDate() + days);
  return `1990-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test('Set up Home: greeting, favourites, upcoming birthdays and quick capture; remove it again', async ({ page, request }) => {
  // Plain "Birthdays" sorts before other specs' "Birthdays <id>", so the starter picks this one.
  const birthdays = (await post(request, '/api/pages', { title: 'Birthdays', kind: 'database' })).id;
  const born = (await post(request, `/api/databases/${birthdays}/properties`, { name: 'Born', type: 'date' })).id;
  await post(request, `/api/databases/${birthdays}/rows`, { title: 'Far off', props: { [born]: inDays(90) } });
  await post(request, `/api/databases/${birthdays}/rows`, { title: 'Next week', props: { [born]: inDays(7) } });
  await post(request, `/api/databases/${birthdays}/rows`, { title: 'Tomorrow', props: { [born]: inDays(1) } });
  const notes = (await post(request, '/api/pages', { title: 'Notes', kind: 'database' })).id;
  const starred = (await post(request, '/api/pages', { title: 'Starred for home' })).id;
  expect((await request.patch(`/api/pages/${starred}`, { data: { favorite: true } })).ok()).toBe(true);

  await page.goto('/');
  await page.getByRole('button', { name: 'Set up Home' }).click();

  const editor = page.locator('.papier-editor');
  await expect(editor.getByText(/^Good (morning|afternoon|evening), E2E$/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Home', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(editor.getByRole('button', { name: 'Starred for home' })).toBeVisible();

  // The linked view: this database's birthdays in the next 30 days, soonest first.
  const linked = editor.locator('[data-type="linkedDatabase"]');
  await expect(linked.getByRole('button', { name: 'Birthdays' })).toBeVisible();
  await expect(linked.locator('[data-row-id]').filter({ hasText: /Tomorrow|Next week|Far off/ })).toHaveCount(2);
  await expect(linked.getByText('Far off')).toHaveCount(0);
  await expect(linked.locator('[data-row-id]').first()).toContainText('Tomorrow');

  // Quick capture: adds a row to Notes and opens it in the peek.
  await editor.getByRole('button', { name: 'New in Notes' }).click();
  await expect(page).toHaveURL(/[?&]peek=/);
  const rows = await (await request.post(`/api/databases/${notes}/query`, { data: {} })).json();
  expect(rows.total).toBe(1);

  // Home survives a reload; then remove it from the page menu.
  await page.goto('/');
  await expect(editor.getByText(/^Good (morning|afternoon|evening), E2E$/)).toBeVisible();
  await page.getByRole('button', { name: 'Page actions' }).click();
  await page.getByRole('button', { name: 'Remove as Home' }).click();
  await expect(page.getByRole('button', { name: 'Set up Home' })).toBeVisible();
});
