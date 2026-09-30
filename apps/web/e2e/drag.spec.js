// @ts-check
import { expect, test } from '@playwright/test';
import { createPage, dragBlock, openPage, outline } from './helpers.js';

test('drag a block down, then back up', async ({ page, request }) => {
  const id = await createPage(request, 'Drag', [{ text: 'A' }, { text: 'B' }, { text: 'C' }]);
  await openPage(page, id);

  await dragBlock(page, 'A', { below: 'C' });
  await expect.poll(() => outline(page)).toEqual(['B@0', 'C@0', 'A@0']);

  // A second drag right after the first: the handle must still work.
  await dragBlock(page, 'A', { above: 'B' });
  await expect.poll(() => outline(page)).toEqual(['A@0', 'B@0', 'C@0']);
});

test('a dragged block brings its children along', async ({ page, request }) => {
  const id = await createPage(request, 'Children', [
    { text: 'Parent' },
    { text: 'Child', indent: 1 },
    { text: 'Grandchild', indent: 2 },
    { text: 'Other' },
  ]);
  await openPage(page, id);

  await dragBlock(page, 'Parent', { below: 'Other' });
  await expect.poll(() => outline(page)).toEqual(['Other@0', 'Parent@0', 'Child@1', 'Grandchild@2']);
});

test('the pointer’s x picks the nesting level', async ({ page, request }) => {
  const id = await createPage(request, 'Levels', [{ text: 'A' }, { text: 'B' }, { text: 'C' }]);
  await openPage(page, id);

  await dragBlock(page, 'C', { below: 'A', level: 1 });
  await expect.poll(() => outline(page)).toEqual(['A@0', 'C@1', 'B@0']);

  // Deeper than one past the block above isn't allowed: clamps to level 2.
  await dragBlock(page, 'B', { below: 'C', level: 5 });
  await expect.poll(() => outline(page)).toEqual(['A@0', 'C@1', 'B@2']);
});

test('a dropped list joins the list type around it', async ({ page, request }) => {
  const id = await createPage(request, 'Lists', [
    { text: 'One', type: 'bulleted_list' },
    { text: 'Two', type: 'bulleted_list' },
    { text: 'Loose' },
  ]);
  await openPage(page, id);

  await dragBlock(page, 'Loose', { below: 'One' });
  await expect(page.locator('.papier-editor > .pb').nth(1)).toHaveAttribute('data-type', 'bulletItem');
});

test('moves survive a reload', async ({ page, request }) => {
  const id = await createPage(request, 'Persist', [{ text: 'A' }, { text: 'B' }, { text: 'C' }]);
  await openPage(page, id);

  await dragBlock(page, 'C', { above: 'A' });
  await dragBlock(page, 'A', { below: 'C', level: 1 });
  const expected = ['C@0', 'A@1', 'B@0'];
  await expect.poll(() => outline(page)).toEqual(expected);

  await page.reload();
  await expect(page.locator('.papier-editor .pb').first()).toBeVisible();
  expect(await outline(page)).toEqual(expected);
});
