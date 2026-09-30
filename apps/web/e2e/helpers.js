// @ts-check
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { orderBetween } from '@papier/core';

/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {import('@playwright/test').APIRequestContext} APIRequestContext */
/** @typedef {{ text: string, indent?: number, type?: import('@papier/core').BlockTypeName }} BlockSpec */

/** Must match INDENT_REM in src/editor/schema.js (at the default 16px root size). */
export const INDENT_PX = 1.5 * 16;

/**
 * Seed a page through the API: blocks are given flat, nesting by `indent`,
 * the same way the editor shows them.
 * @param {APIRequestContext} request @param {string} title @param {BlockSpec[]} blocks
 * @returns {Promise<string>} the page id
 */
export async function createPage(request, title, blocks) {
  const res = await request.post('/api/pages', { data: { title } });
  expect(res.ok()).toBe(true);
  const { id } = await res.json();

  /** @type {(string | null)[]} */ const parents = []; // parents[i] = latest block at indent i
  const lastOrder = new Map(); // parentId -> last order key among its children
  const upserts = blocks.map(({ text, indent = 0, type = 'paragraph' }) => {
    const parentId = indent > 0 ? (parents[indent - 1] ?? null) : null;
    const order = orderBetween(lastOrder.get(parentId) ?? null, null);
    const block = { id: randomUUID(), type, parentId, order, content: [{ type: 'text', text }] };
    lastOrder.set(parentId, order);
    parents.length = indent;
    parents[indent] = block.id;
    return block;
  });

  const batch = await request.post(`/api/pages/${id}/blocks/batch`, { data: { upserts } });
  expect(batch.ok()).toBe(true);
  return id;
}

/** Open a page and wait for its editor. @param {Page} page @param {string} id */
export async function openPage(page, id) {
  await page.goto(`/?p=${id}`);
  await expect(page.locator('.papier-editor .pb').first()).toBeVisible();
}

/**
 * The editor's blocks as `text@indent` strings, e.g. `['A@0', 'B@1']` —
 * compact enough to compare whole documents in one assertion.
 * @param {Page} page
 */
export function outline(page) {
  return page
    .locator('.papier-editor > .pb')
    .evaluateAll((els) => els.map((el) => `${el.textContent}@${el.getAttribute('data-indent') ?? 0}`));
}

/** A block by its exact text. @param {Page} page @param {string} text */
export function block(page, text) {
  return page.locator('.papier-editor > .pb').filter({ has: page.locator('.pb-c', { hasText: new RegExp(`^${text}$`) }) });
}

/**
 * Drag a block by its handle and drop it just above or below another block,
 * at a nesting level (0 = the text column's left edge). Resolves once the
 * move has been autosaved.
 * @param {Page} page
 * @param {string} from  text of the block to drag
 * @param {{ above?: string, below?: string, level?: number }} to
 */
export async function dragBlock(page, from, { above, below, level = 0 }) {
  const source = block(page, from);
  await source.locator('.pb-c').hover();
  const handle = page.getByRole('button', { name: 'Drag to move, click for options' });
  await expect(handle).toBeVisible();

  const target = await block(page, /** @type {string} */ (above ?? below)).boundingBox();
  const editor = await page.locator('.papier-editor').boundingBox();
  if (!target || !editor) throw new Error('block or editor not on screen');
  // A quarter of the way in from the edge we're dropping on, and a little
  // past the level's start so rounding can't pick the one before it.
  const y = above ? target.y + target.height * 0.25 : target.y + target.height * 0.75;
  const x = editor.x + level * INDENT_PX + INDENT_PX * 0.3;

  const saved = page.waitForResponse((r) => r.url().endsWith('/blocks/batch') && r.request().method() === 'POST');
  await handle.hover();
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 8 });
  await page.mouse.up();
  await saved;
}
