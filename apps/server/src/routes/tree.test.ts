import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { testApp } from '../testing.ts';
import { backfillPageBlocks } from '../db/pageTree.ts';
import { openDb } from '../db/index.ts';
import { pages } from '../db/schema.ts';

// Page hierarchy: sub-pages as page blocks in their parent's content, and moves.

let app: ReturnType<typeof buildApp>;

beforeEach(() => {
  app = testApp();
});
afterEach(async () => {
  await app.close();
});

type Row = { id: string; type: string; parentId: string | null; order: string; props: Record<string, unknown>; content: unknown[] };

async function create(title = '', parentId: string | null = null, extra: object = {}) {
  const res = await app.inject({ method: 'POST', url: '/api/pages', payload: { title, parentId, ...extra } });
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
}

async function children(parent?: string) {
  const res = await app.inject({ method: 'GET', url: parent ? `/api/pages?parent=${parent}` : '/api/pages' });
  return (res.json() as { id: string; title: string }[]).map((p) => p.title);
}

async function blocksOf(pageId: string) {
  const res = await app.inject({ method: 'GET', url: `/api/pages/${pageId}/blocks` });
  return res.json() as Row[];
}
const pageBlocks = async (pageId: string) =>
  (await blocksOf(pageId)).filter((b) => b.type === 'page').map((b) => b.props.pageId);

function save(pageId: string, upserts: object[] = [], deletes: string[] = []) {
  return app.inject({ method: 'POST', url: `/api/pages/${pageId}/blocks/batch`, payload: { upserts, deletes } });
}

function move(id: string, body: object) {
  return app.inject({ method: 'POST', url: `/api/pages/${id}/move`, payload: body });
}

const isLive = async (id: string) => (await app.inject({ method: 'GET', url: `/api/pages/${id}` })).statusCode === 200;

describe('sub-pages as page blocks', () => {
  it('creating a sub-page appends a page block to the parent', async () => {
    const parent = await create('Parent');
    await save(parent, [{ id: 'p1', type: 'paragraph', parentId: null, order: 'a0', content: [] }]);
    const a = await create('A', parent);
    const b = await create('B', parent);
    const blocks = await blocksOf(parent);
    expect(blocks.map((r) => r.type)).toEqual(['paragraph', 'page', 'page']);
    expect(blocks.slice(1).map((r) => r.props.pageId)).toEqual([a, b]);
  });

  it('can leave the block to the caller', async () => {
    const parent = await create('Parent');
    await create('A', parent, { block: false });
    expect(await pageBlocks(parent)).toEqual([]);
  });

  it('deleting the page block trashes the page (and its subtree); re-adding it restores it', async () => {
    const parent = await create('Parent');
    const child = await create('Child', parent);
    const grandchild = await create('Grandchild', child);
    const [block] = (await blocksOf(parent)).filter((r) => r.type === 'page');

    expect((await save(parent, [], [block!.id])).statusCode).toBe(200);
    expect(await children(parent)).toEqual([]);
    expect(await isLive(grandchild)).toBe(false);

    // Undo in the editor re-sends the same block.
    await save(parent, [block!]);
    expect(await children(parent)).toEqual(['Child']);
    expect(await isLive(grandchild)).toBe(true);
  });

  it('trashes a sub-page whose block went with a deleted parent block', async () => {
    const parent = await create('Parent');
    const child = await create('Child', parent, { block: false });
    await save(parent, [
      { id: 'toggle', type: 'paragraph', parentId: null, order: 'a0', content: [] },
      { id: 'pb', type: 'page', parentId: 'toggle', order: 'a0', props: { pageId: child } },
    ]);
    await save(parent, [], ['toggle']); // the nested page block goes by cascade
    expect(await isLive(child)).toBe(false);
  });

  it('keeps the page while another block still points at it', async () => {
    const parent = await create('Parent');
    const child = await create('Child', parent);
    const [block] = (await blocksOf(parent)).filter((r) => r.type === 'page');
    await save(parent, [{ ...block!, id: 'dup', order: 'b0' }]); // duplicated block
    await save(parent, [], [block!.id]);
    expect(await isLive(child)).toBe(true);
    await save(parent, [], ['dup']);
    expect(await isLive(child)).toBe(false);
  });

  it('treats a block pointing at a page elsewhere as a link', async () => {
    const other = await create('Other');
    const page = await create('Page');
    await save(page, [{ id: 'link', type: 'page', parentId: null, order: 'a0', props: { pageId: other } }]);
    await save(page, [], ['link']);
    expect(await isLive(other)).toBe(true);
    expect(await children()).toEqual(['Other', 'Page']);
  });

  it('trashing a page from the sidebar removes its block from the parent', async () => {
    const parent = await create('Parent');
    const child = await create('Child', parent);
    await app.inject({ method: 'DELETE', url: `/api/pages/${child}` });
    expect(await pageBlocks(parent)).toEqual([]);
  });
});

describe('POST /api/pages/:id/move', () => {
  it('reorders among siblings', async () => {
    const a = await create('A');
    const b = await create('B');
    const c = await create('C');
    expect((await move(c, { parentId: null, beforeId: a })).statusCode).toBe(200);
    expect(await children()).toEqual(['C', 'A', 'B']);
    await move(c, { parentId: null, afterId: a });
    expect(await children()).toEqual(['A', 'C', 'B']);
    await move(a, { parentId: null });
    expect(await children()).toEqual(['C', 'B', 'A']);
    void b;
  });

  it('re-parents a page and moves its page block', async () => {
    const one = await create('One');
    const two = await create('Two');
    const child = await create('Child', one);
    const other = await create('Other', two);

    await move(child, { parentId: two, beforeId: other });
    expect(await children(one)).toEqual([]);
    expect(await children(two)).toEqual(['Child', 'Other']);
    expect(await pageBlocks(one)).toEqual([]);
    expect(await pageBlocks(two)).toEqual([other, child]);
    const crumbs = (await app.inject({ method: 'GET', url: `/api/pages/${child}` })).json() as { ancestors: { id: string }[] };
    expect(crumbs.ancestors.map((a) => a.id)).toEqual([two]);

    await move(child, { parentId: null });
    expect(await children()).toEqual(['One', 'Two', 'Child']);
    expect(await pageBlocks(two)).toEqual([other]);
  });

  it('refuses to move a page into itself or its subtree', async () => {
    const a = await create('A');
    const b = await create('B', a);
    const c = await create('C', b);
    expect((await move(a, { parentId: a })).statusCode).toBe(400);
    expect((await move(a, { parentId: c })).statusCode).toBe(400);
    expect(await children()).toEqual(['A']);
  });

  it('refuses trashed targets and siblings from elsewhere', async () => {
    const a = await create('A');
    const b = await create('B');
    const trashed = await create('T');
    const elsewhere = await create('E', b);
    await app.inject({ method: 'DELETE', url: `/api/pages/${trashed}` });
    expect((await move(a, { parentId: trashed })).statusCode).toBe(404);
    expect((await move(a, { parentId: null, beforeId: elsewhere })).statusCode).toBe(400);
    expect((await move(a, { parentId: null, beforeId: a })).statusCode).toBe(400);
    expect((await move(a, { parentId: null, beforeId: b, afterId: b })).statusCode).toBe(400);
  });
});

describe('backfillPageBlocks', () => {
  it('adds blocks for older sub-pages, once', () => {
    const { db, sqlite } = openDb(':memory:');
    const now = Date.now();
    const row = { createdAt: now, updatedAt: now };
    db.insert(pages).values({ id: 'root', title: 'Root', orderKey: 'a0', ...row }).run();
    db.insert(pages).values({ id: 'k1', parentId: 'root', title: 'K1', orderKey: 'a0', ...row }).run();
    db.insert(pages).values({ id: 'k2', parentId: 'root', title: 'K2', orderKey: 'a1', ...row }).run();
    db.insert(pages).values({ id: 'gone', parentId: 'root', title: 'Gone', orderKey: 'a2', archivedAt: now, ...row }).run();
    expect(backfillPageBlocks(db)).toBe(2);
    expect(backfillPageBlocks(db)).toBe(0);
    sqlite.close();
  });
});
