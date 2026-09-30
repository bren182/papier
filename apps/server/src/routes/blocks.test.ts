import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';

let app: ReturnType<typeof buildApp>;

beforeEach(() => {
  app = buildApp({ logger: false });
});
afterEach(async () => {
  await app.close();
});

type BlockIn = { id: string; type?: string; parentId?: string | null; order: string; props?: object; content?: object[] };

async function createPage(body: object = {}) {
  const res = await app.inject({ method: 'POST', url: '/api/pages', payload: body });
  return res.json() as { id: string };
}

const block = ({ type = 'paragraph', parentId = null, ...rest }: BlockIn) => ({ type, parentId, ...rest });
const text = (t: string) => [{ type: 'text', text: t, styles: {} }];

function save(pageId: string, upserts: BlockIn[] = [], deletes: string[] = []) {
  return app.inject({
    method: 'POST',
    url: `/api/pages/${pageId}/blocks/batch`,
    payload: { upserts: upserts.map(block), deletes },
  });
}

async function load(pageId: string) {
  const res = await app.inject({ method: 'GET', url: `/api/pages/${pageId}/blocks` });
  expect(res.statusCode).toBe(200);
  return res.json() as Array<Required<BlockIn>>;
}

describe('blocks API', () => {
  it('saves a nested tree and returns it ordered', async () => {
    const page = await createPage();
    // Child listed before its parent: FKs are checked at commit.
    const res = await save(page.id, [
      { id: 'c', parentId: 'a', order: 'a0', type: 'todo', props: { checked: true }, content: text('child') },
      { id: 'b', order: 'a1', content: text('second') },
      { id: 'a', order: 'a0', type: 'heading', props: { level: 2 }, content: text('first') },
    ]);
    expect(res.statusCode).toBe(200);

    const rows = await load(page.id);
    const top = rows.filter((b) => b.parentId === null).map((b) => b.id);
    expect(top).toEqual(['a', 'b']);
    expect(rows.find((b) => b.id === 'c')).toMatchObject({ parentId: 'a', type: 'todo', props: { checked: true }, content: text('child') });
  });

  it('updates a block in place', async () => {
    const page = await createPage();
    await save(page.id, [{ id: 'a', order: 'a0', content: text('old') }]);
    await save(page.id, [{ id: 'a', order: 'a0', type: 'quote', content: text('new') }]);

    const [a] = await load(page.id);
    expect(a).toMatchObject({ type: 'quote', content: text('new') });
  });

  it('deleting a block removes its subtree, but not children moved out first', async () => {
    const page = await createPage();
    await save(page.id, [
      { id: 'a', order: 'a0' },
      { id: 'kept', parentId: 'a', order: 'a0' },
      { id: 'gone', parentId: 'a', order: 'a1' },
    ]);
    const res = await save(page.id, [{ id: 'kept', order: 'a1' }], ['a']);
    expect(res.statusCode).toBe(200);
    expect((await load(page.id)).map((b) => b.id)).toEqual(['kept']);
  });

  it('rejects a parent on another page', async () => {
    const p1 = await createPage();
    const p2 = await createPage();
    await save(p1.id, [{ id: 'x', order: 'a0' }]);

    const res = await save(p2.id, [{ id: 'y', parentId: 'x', order: 'a0' }]);
    expect(res.statusCode).toBe(400);
    expect(await load(p2.id)).toEqual([]);
  });

  it('rejects taking over a block id from another page', async () => {
    const p1 = await createPage();
    const p2 = await createPage();
    await save(p1.id, [{ id: 'x', order: 'a0' }]);
    expect((await save(p2.id, [{ id: 'x', order: 'a0' }])).statusCode).toBe(400);
  });

  it('rejects a cycle and rolls back the whole batch', async () => {
    const page = await createPage();
    await save(page.id, [
      { id: 'a', order: 'a0' },
      { id: 'b', parentId: 'a', order: 'a0' },
    ]);
    const res = await save(page.id, [
      { id: 'a', parentId: 'b', order: 'a0' },
      { id: 'c', order: 'a1' },
    ]);
    expect(res.statusCode).toBe(400);
    expect((await load(page.id)).map((b) => [b.id, b.parentId])).toEqual([
      ['a', null],
      ['b', 'a'],
    ]);
  });

  it('rejects unknown block types', async () => {
    const page = await createPage();
    expect((await save(page.id, [{ id: 'a', order: 'a0', type: 'nope' }])).statusCode).toBe(400);
  });

  it('404s for a trashed page and its descendants', async () => {
    const parent = await createPage();
    const child = await createPage({ parentId: parent.id });
    await app.inject({ method: 'DELETE', url: `/api/pages/${parent.id}` });

    for (const id of [parent.id, child.id]) {
      expect((await app.inject({ method: 'GET', url: `/api/pages/${id}/blocks` })).statusCode).toBe(404);
      expect((await save(id, [{ id: 'a', order: 'a0' }])).statusCode).toBe(404);
    }
  });
});
