// @ts-check
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { block, createPage, openPage } from './helpers.js';

// Every test's pages share one server, so words are made unique per test.
const word = () => `zq${randomUUID().slice(0, 8)}`;

test('Ctrl+K finds a block and opens the page at it', async ({ page, request }) => {
  const w = word();
  const filler = Array.from({ length: 40 }, (_, i) => ({ text: `filler line ${i}` }));
  const id = await createPage(request, 'Deep page', [...filler, { text: `the ${w} is down here` }]);
  const home = await createPage(request, 'Home', [{ text: 'start' }]);
  await openPage(page, home);

  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Search' });
  await dialog.getByRole('combobox').fill(w.slice(0, 6)); // a prefix is enough
  const hit = dialog.getByRole('option').first();
  await expect(hit).toContainText('Deep page');
  await expect(hit.locator('mark')).toHaveText(w);

  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`[?&]p=${id}(&|$)`));
  const target = block(page, `the ${w} is down here`);
  await expect(target).toBeInViewport();
  await expect(page.locator('.papier-flash')).toBeVisible();
  // The caret is at the start of the block: typing lands there.
  await page.keyboard.type('X');
  await expect(page.locator('.papier-editor > .pb').last()).toHaveText(`Xthe ${w} is down here`);
  expect(new URL(page.url()).searchParams.has('b')).toBe(false);
});

test('finds text typed a moment ago, and titles', async ({ page, request }) => {
  const w = word();
  const id = await createPage(request, `Title ${w}`, [{ text: 'hello' }]);
  await openPage(page, id);

  await block(page, 'hello').locator('.pb-c').click();
  const saved = page.waitForResponse((r) => r.url().endsWith('/blocks/batch'));
  await page.keyboard.press('End');
  await page.keyboard.type(` fresh${w}`);
  await saved;

  await page.getByRole('button', { name: /Search/ }).click();
  const box = page.getByRole('dialog', { name: 'Search' }).getByRole('combobox');
  await box.fill(`fresh${w}`);
  await expect(page.getByRole('option').first().locator('mark')).toHaveText(`fresh${w}`);

  await box.fill(`title ${w}`);
  await expect(page.getByRole('option')).toHaveCount(1);
  await expect(page.getByRole('option')).toContainText(`Title ${w}`);

  await box.fill(`nothing${w}`);
  await expect(page.getByText('No results.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('arrow keys pick between results', async ({ page, request }) => {
  const w = word();
  const a = await createPage(request, 'Alpha', [{ text: `${w} one` }]);
  const b = await createPage(request, 'Beta', [{ text: `${w} two` }]);
  await openPage(page, a);

  await page.keyboard.press('Control+k');
  await page.getByRole('combobox').fill(w);
  await expect(page.getByRole('option')).toHaveCount(2);
  const second = await page.getByRole('option').nth(1).textContent();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`p=${second?.includes('Beta') ? b : a}`));
});
