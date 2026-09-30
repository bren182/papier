// @ts-check
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { openPage } from './helpers.js';

/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {import('@playwright/test').APIRequestContext} APIRequestContext */

// Tests share one server, so page names are unique per test.
const uid = () => randomUUID().slice(0, 6);

/** @param {APIRequestContext} request @param {string} title @param {string | null} [parentId] */
async function newPage(request, title, parentId = null) {
  const res = await request.post('/api/pages', { data: { title, parentId } });
  expect(res.ok()).toBe(true);
  return /** @type {{ id: string }} */ (await res.json()).id;
}

/** A sidebar row by its page title. @param {Page} page @param {string} title */
const row = (page, title) =>
  page.getByRole('tree', { name: 'Pages' }).locator('[data-page-id]').filter({ hasText: new RegExp(`^${title}$`) });

/**
 * Titles of a page's children, from the API (the tree the sidebar shows).
 * @param {APIRequestContext} request @param {string} parentId
 */
async function childTitles(request, parentId) {
  const res = await request.get(`/api/pages?parent=${parentId}`);
  return /** @type {{ title: string }[]} */ (await res.json()).map((p) => p.title);
}

/**
 * Drag one sidebar row onto another: `before` / `after` its edges, or `inside`.
 * Resolves once the move is saved.
 * @param {Page} page @param {string} from @param {string} to @param {'before' | 'inside' | 'after'} where
 */
async function dragRow(page, from, to, where) {
  // Other tests' pages fill the tree too: bring both rows on screen first.
  await row(page, to).scrollIntoViewIfNeeded();
  await row(page, from).scrollIntoViewIfNeeded();
  const source = await row(page, from).boundingBox();
  const target = await row(page, to).boundingBox();
  if (!source || !target) throw new Error('row not on screen');
  const y = target.y + target.height * (where === 'before' ? 0.1 : where === 'after' ? 0.9 : 0.5);
  const moved = page.waitForResponse((r) => r.url().includes('/move') && r.request().method() === 'POST');
  await page.mouse.move(source.x + 60, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + 60, y, { steps: 8 });
  await page.mouse.up();
  expect((await moved).ok()).toBe(true);
}

test('drag a page into another, and back out to the top level', async ({ page, request }) => {
  const [a, b] = [`A ${uid()}`, `B ${uid()}`];
  await newPage(request, a);
  const bId = await newPage(request, b);
  await page.goto('/');

  await dragRow(page, a, b, 'inside');
  await expect.poll(() => childTitles(request, bId)).toEqual([a]);

  // The parent's content now holds the sub-page as a page block.
  await openPage(page, bId);
  await expect(page.locator('.papier-editor .pb-page-title')).toHaveText(a);

  // Breadcrumbs of the moved page go through its new parent.
  await row(page, a).click();
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveText(new RegExp(`${b}.*${a}`));

  await dragRow(page, a, b, 'after');
  await expect(row(page, a)).toBeVisible();
  await expect.poll(() => childTitles(request, bId)).toEqual([]);
  await row(page, b).click();
  await expect(page.locator('.papier-editor .pb-page')).toHaveCount(0);
});

test('reorder pages among siblings', async ({ page, request }) => {
  const parent = `Parent ${uid()}`;
  const parentId = await newPage(request, parent);
  const [one, two, three] = ['One', 'Two', 'Three'].map((t) => `${t} ${uid()}`);
  for (const t of [one, two, three]) await newPage(request, t, parentId);
  await page.goto(`/?p=${parentId}`);
  await page.getByRole('button', { name: `Expand ${parent}` }).click();
  await expect.poll(() => childTitles(request, parentId)).toEqual([one, two, three]);

  await dragRow(page, three, one, 'before');
  await expect.poll(() => childTitles(request, parentId)).toEqual([three, one, two]);
  await dragRow(page, three, two, 'after');
  await expect.poll(() => childTitles(request, parentId)).toEqual([one, two, three]);
});

test('a page can’t be dropped into its own sub-page', async ({ page, request }) => {
  const [top, sub] = [`Top ${uid()}`, `Sub ${uid()}`];
  const topId = await newPage(request, top);
  await newPage(request, sub, topId);
  await page.goto('/');
  await page.getByRole('button', { name: `Expand ${top}` }).click();

  const source = await row(page, top).boundingBox();
  const target = await row(page, sub).boundingBox();
  if (!source || !target) throw new Error('row not on screen');
  await page.mouse.move(source.x + 60, source.y + 15);
  await page.mouse.down();
  await page.mouse.move(target.x + 60, target.y + 15, { steps: 8 });
  await expect(row(page, sub)).not.toHaveClass(/bg-accent-soft/);
  await page.mouse.up();
  await expect.poll(() => childTitles(request, topId)).toEqual([sub]);
});

test('`/page` makes a sub-page; deleting its block trashes it, undo brings it back', async ({ page, request }) => {
  const parent = `Home ${uid()}`;
  const parentId = await newPage(request, parent);
  await openPage(page, parentId);

  await page.locator('.papier-editor').click();
  await page.keyboard.type('/page');
  await expect(page.getByRole('option', { name: /Page/ }).first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).not.toHaveURL(new RegExp(parentId));

  const kid = `Kid ${uid()}`;
  await expect(page.getByLabel('Page title')).toBeFocused(); // a new page's title takes focus
  await page.keyboard.type(kid);
  await expect.poll(() => childTitles(request, parentId)).toEqual([kid]);

  await page.goBack();
  await expect(page.locator('.papier-editor .pb-page-title')).toHaveText(kid);

  // Select the page block and delete it: the sub-page goes to the trash.
  const saved = () => page.waitForResponse((r) => r.url().endsWith('/blocks/batch'));
  await page.locator('.papier-editor .pb-page').hover();
  await page.getByRole('button', { name: 'Drag to move, click for options' }).click();
  let save = saved();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await save;
  await expect.poll(() => childTitles(request, parentId)).toEqual([]);

  save = saved();
  await page.keyboard.press('Control+z');
  await save;
  await expect(page.locator('.papier-editor .pb-page-title')).toHaveText(kid);
  await expect.poll(() => childTitles(request, parentId)).toEqual([kid]);
});

test('“Move to…” picks a new parent by search', async ({ page, request }) => {
  const [mover, dest] = [`Mover ${uid()}`, `Dest ${uid()}`];
  await newPage(request, mover);
  const destId = await newPage(request, dest);
  await page.goto('/');

  await row(page, mover).hover();
  await page.getByRole('button', { name: `Move ${mover}` }).click();
  const box = page.getByRole('combobox');
  await box.fill(dest);
  await expect(page.getByRole('option').nth(1)).toContainText(dest); // after "Top level"
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(() => childTitles(request, destId)).toEqual([mover]);
});
