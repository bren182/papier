// @ts-check
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createPage, openPage } from './helpers.js';

/** @typedef {import('@playwright/test').APIRequestContext} APIRequestContext */

const uid = () => randomUUID().slice(0, 6);

/** @param {APIRequestContext} request @param {string} url @param {object} [data] */
async function post(request, url, data) {
  const res = await request.post(url, { data });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

test('rows open in a side peek, step through the view, and open as a page', async ({ page, request }) => {
  const db = (await post(request, '/api/pages', { title: `Peek ${uid()}`, kind: 'database' })).id;
  const ids = [];
  for (const t of ['Alpha', 'Beta', 'Gamma']) ids.push((await post(request, `/api/databases/${db}/rows`, { title: t })).id);
  await page.goto(`/?p=${db}`);

  const row = page.locator(`[role=row][data-row-id="${ids[0]}"]`);
  await row.hover();
  await row.getByRole('button', { name: 'Open' }).click();
  const peek = page.getByRole('complementary', { name: 'Side peek' });
  await expect(peek.locator('.page-title')).toHaveText('Alpha');
  await expect(page).toHaveURL(new RegExp(`p=${db}.*peek=${ids[0]}`));

  await peek.getByRole('button', { name: 'Next row' }).click();
  await expect(peek.locator('.page-title')).toHaveText('Beta');
  await peek.getByRole('button', { name: 'Previous row' }).click();
  await expect(peek.locator('.page-title')).toHaveText('Alpha');

  // Esc outside a text field closes it; Back reopens nothing (the peek had its own entry).
  await peek.getByRole('button', { name: 'Next row' }).focus();
  await page.keyboard.press('Escape');
  await expect(peek).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`p=${db}$`));

  await row.hover();
  await row.getByRole('button', { name: 'Open' }).click();
  await peek.getByRole('button', { name: 'Open as page' }).click();
  await expect(page).toHaveURL(new RegExp(`p=${ids[0]}$`));
  await expect(peek).toHaveCount(0);
});

test('star a page into Favourites, then unstar it from the sidebar', async ({ page, request }) => {
  const title = `Fav ${uid()}`;
  const id = await createPage(request, title, [{ text: 'hello' }]);
  await openPage(page, id);
  await page.getByRole('button', { name: 'Add to favourites' }).click();
  const favourites = page.getByRole('region', { name: 'Favourites' });
  await expect(favourites.getByText(title)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Recent' }).getByText(title)).toBeVisible();

  await favourites.getByText(title).hover();
  await favourites.getByRole('button', { name: `Remove ${title} from favourites` }).click();
  await expect(favourites.getByText(title)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add to favourites' })).toBeVisible();
});

test('[[ links a page inline; the link follows renames and opens the page', async ({ page, request }) => {
  const target = `Target ${uid()}`;
  const targetId = await createPage(request, target, [{ text: 'over here' }]);
  const id = await createPage(request, `Links ${uid()}`, [{ text: 'see ' }]);
  await openPage(page, id);
  await page.locator('.papier-editor .pb').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(`[[${target.slice(0, 10)}`);
  await page.getByRole('option', { name: new RegExp(target) }).click();
  const link = page.locator('.papier-editor .papier-page-link');
  await expect(link).toHaveText(new RegExp(target));

  // Saved as an inline page node.
  await expect
    .poll(async () => JSON.stringify((await (await request.get(`/api/pages/${id}/blocks`)).json())[0]?.content))
    .toContain(`"type":"page","props":{"pageId":"${targetId}"}`);

  await request.patch(`/api/pages/${targetId}`, { data: { title: `${target} renamed` } });
  await page.reload();
  await expect(link).toHaveText(new RegExp(`${target} renamed`));
  await link.click();
  await expect(page).toHaveURL(new RegExp(`p=${targetId}`));
});

test('board cards: right-click for the row menu, + in a column header adds a card', async ({ page, request }) => {
  const db = (await post(request, '/api/pages', { title: `Board ${uid()}`, kind: 'database' })).id;
  const status = await post(request, `/api/databases/${db}/properties`, { name: 'Status', type: 'select', config: { options: [{ name: 'Todo' }] } });
  await post(request, `/api/databases/${db}/rows`, { title: 'Card one', props: { [status.id]: status.config.options[0].id } });
  const { views } = await (await request.get(`/api/databases/${db}`)).json();
  await request.patch(`/api/databases/${db}/views/${views[0].id}`, { data: { type: 'board' } });
  await page.goto(`/?p=${db}`);

  await page.locator('[data-card]').getByText('Card one').click({ button: 'right' });
  const menu = page.locator('[data-popover]');
  await expect(menu.getByRole('button', { name: 'Move to…' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'New in Todo' }).click();
  await expect(page.getByLabel('Card title')).toBeFocused();
});
