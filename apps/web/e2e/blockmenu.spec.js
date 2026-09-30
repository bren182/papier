// @ts-check
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { block, createPage, openPage, outline } from './helpers.js';

const uid = () => randomUUID().slice(0, 6);

test('right-click a block opens its menu at the pointer', async ({ page, request }) => {
  const id = await createPage(request, `Menu ${uid()}`, [{ text: 'One' }, { text: 'Two' }]);
  await openPage(page, id);

  await block(page, 'Two').locator('.pb-c').click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: /^H1 ?Heading 1$/ }).click();
  await expect(page.locator('.papier-editor > .pb[data-type=heading]')).toHaveText('Two');
});

test('turn a block into a page: its children move into the new page', async ({ page, request }) => {
  const id = await createPage(request, `Turn ${uid()}`, [{ text: 'Intro' }, { text: 'Trip plan' }, { text: 'Flights', indent: 1 }, { text: 'Hotel', indent: 2 }, { text: 'After' }]);
  await openPage(page, id);

  const saved = page.waitForResponse((r) => r.url().endsWith(`/pages/${id}/blocks/batch`) && r.request().method() === 'POST');
  await block(page, 'Trip plan').locator('.pb-c').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Page' }).click();
  await saved;

  // The page block shows the new page's title, and the nested blocks are gone from here.
  await expect(page.locator('.papier-editor > .pb[data-type=pageBlock]')).toHaveText('Trip plan');
  expect(await outline(page)).toEqual(['Intro@0', 'Trip plan@0', 'After@0']);

  // …and live in the new page, one level up.
  const children = /** @type {{ id: string, title: string }[]} */ (await (await request.get(`/api/pages?parent=${id}`)).json());
  expect(children.map((c) => c.title)).toEqual(['Trip plan']);
  await page.locator('.papier-editor > .pb[data-type=pageBlock] .pb-page').click();
  await expect.poll(() => outline(page)).toEqual(['Flights@0', 'Hotel@1']);
});

test('the sidebar collapses and comes back', async ({ page, request }) => {
  const id = await createPage(request, `Side ${uid()}`, [{ text: 'x' }]);
  await openPage(page, id);
  const sidebar = page.getByRole('navigation', { name: 'Workspace' });

  await page.keyboard.press('Control+Backslash');
  await expect(sidebar).not.toBeInViewport();
  await page.getByRole('button', { name: 'Show sidebar' }).click();
  await expect(sidebar).toBeInViewport();

  await sidebar.hover();
  await page.getByRole('button', { name: 'Hide sidebar' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Show sidebar' })).toBeVisible(); // remembered
});
