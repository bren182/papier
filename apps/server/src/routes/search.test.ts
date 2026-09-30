import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HIT_END, HIT_START } from '@papier/core';
import { buildApp } from '../app.ts';
import { toFtsQuery } from '../db/search.ts';

let app: ReturnType<typeof buildApp>;

beforeEach(() => {
  app = buildApp({ logger: false });
});
afterEach(async () => {
  await app.close();
});

type Hit = { page: { id: string; title: string }; ancestors: { id: string }[]; blockId: string | null; snippet: string };
type Result = { items: Hit[]; nextOffset: number | null };

async function createPage(title = '', parentId: string | null = null) {
  const res = await app.inject({ method: 'POST', url: '/api/pages', payload: { title, parentId } });
  return (res.json() as { id: string }).id;
}

let seq = 0;
/** Save top-level paragraphs (or given blocks); returns their ids in order. */
async function save(pageId: string, texts: string[], extra: object[] = [], deletes: string[] = []) {
  const upserts = texts.map((t) => ({
    id: `b${++seq}`,
    type: 'paragraph',
    parentId: null,
    order: `a${seq}`,
    content: [{ type: 'text', text: t }],
  }));
  const res = await app.inject({
    method: 'POST',
    url: `/api/pages/${pageId}/blocks/batch`,
    payload: { upserts: [...upserts, ...extra], deletes },
  });
  expect(res.statusCode).toBe(200);
  return upserts.map((u) => u.id);
}

async function search(q: string, query = '') {
  const res = await app.inject({ method: 'GET', url: `/api/search?q=${encodeURIComponent(q)}${query}` });
  expect(res.statusCode).toBe(200);
  return res.json() as Result;
}
const titles = (r: Result) => r.items.map((h) => h.page.title);

describe('GET /api/search', () => {
  it('finds pages by block text, with the block and a highlighted snippet', async () => {
    const id = await createPage('Groceries');
    const [, oat] = await save(id, ['apples and pears', 'oat milk, the barista kind']);
    await createPage('Unrelated');

    const { items } = await search('barista');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ page: { id, title: 'Groceries' }, blockId: oat });
    expect(items[0]!.snippet).toContain(`${HIT_START}barista${HIT_END}`);
  });

  it('finds pages by title, including new and renamed ones', async () => {
    const id = await createPage('Birthday list');
    expect(titles(await search('birthday'))).toEqual(['Birthday list']);

    await app.inject({ method: 'PATCH', url: `/api/pages/${id}`, payload: { title: 'Anniversaries' } });
    expect(await search('birthday')).toEqual({ items: [], nextOffset: null });
    expect((await search('anniv')).items[0]).toMatchObject({ page: { id }, blockId: null });
  });

  it('indexes rich titles by their plain text', async () => {
    const id = await createPage();
    const titleContent = [{ type: 'text', text: 'Standup ' }, { type: 'date', props: { date: '2026-10-05' } }];
    await app.inject({ method: 'PATCH', url: `/api/pages/${id}`, payload: { titleContent } });
    expect(titles(await search('standup 2026'))).toEqual(['Standup 2026-10-05']);
  });

  it('matches word prefixes and needs every word', async () => {
    await save(await createPage('A'), ['Papier is a workspace']);
    await save(await createPage('B'), ['Paper towels']);

    expect(titles(await search('pap'))).toEqual(expect.arrayContaining(['A', 'B']));
    expect(titles(await search('pap work'))).toEqual(['A']);
    expect(titles(await search('PAPIER'))).toEqual(['A']); // case-insensitive
  });

  it('ignores accents', async () => {
    await save(await createPage('Café notes'), ['crème brûlée']);
    expect(titles(await search('cafe'))).toEqual(['Café notes']);
    expect(titles(await search('creme brulee'))).toEqual(['Café notes']);
  });

  it('returns one hit per page, its best one, with titles outranking body text', async () => {
    const body = await createPage('Meeting notes');
    await save(body, ['talked about the roadmap', 'roadmap roadmap roadmap', 'lunch']);
    const titled = await createPage('Roadmap');

    const { items } = await search('roadmap');
    expect(items.map((h) => h.page.id)).toEqual([titled, body]);
    expect(items[1]!.snippet).toBe(`${HIT_START}roadmap${HIT_END} ${HIT_START}roadmap${HIT_END} ${HIT_START}roadmap${HIT_END}`);
  });

  it('includes the path to nested pages', async () => {
    const root = await createPage('Work');
    const child = await createPage('Projects', root);
    await save(await createPage('Papier', child), ['nested needle']);

    const [hit] = (await search('needle')).items;
    expect(hit!.ancestors.map((a) => a.id)).toEqual([root, child]);
  });

  it('leaves out trashed pages and everything under them', async () => {
    const root = await createPage('Old stuff');
    const child = await createPage('Older', root);
    await save(child, ['forgotten needle']);
    await save(await createPage('Live'), ['live needle']);

    expect(titles(await search('needle'))).toHaveLength(2);
    await app.inject({ method: 'DELETE', url: `/api/pages/${root}` });
    expect(titles(await search('needle'))).toEqual(['Live']);
    expect(await search('older')).toEqual({ items: [], nextOffset: null });
  });

  it('reindexes edited blocks', async () => {
    const id = await createPage('P');
    const [b] = await save(id, ['first draft']);
    await app.inject({
      method: 'POST',
      url: `/api/pages/${id}/blocks/batch`,
      payload: { upserts: [{ id: b, type: 'paragraph', parentId: null, order: 'a1', content: [{ type: 'text', text: 'final copy' }] }] },
    });
    expect((await search('draft')).items).toEqual([]);
    expect((await search('final')).items[0]!.blockId).toBe(b);
  });

  it('drops deleted blocks, children of deleted blocks included', async () => {
    const id = await createPage('P');
    const [parent] = await save(id, ['parent needle']);
    const child = { id: 'child', type: 'paragraph', parentId: parent, order: 'a0', content: [{ type: 'text', text: 'child needle' }] };
    await save(id, [], [child]);
    expect((await search('child')).items[0]!.blockId).toBe('child');

    await save(id, [], [], [parent!]);
    expect((await search('needle')).items).toEqual([]);
  });

  it('paginates', async () => {
    for (let i = 0; i < 5; i++) await save(await createPage(`Page ${i}`), ['common word']);

    const first = await search('common', '&limit=2');
    expect(first.items).toHaveLength(2);
    expect(first.nextOffset).toBe(2);
    const second = await search('common', '&limit=2&offset=2');
    const third = await search('common', '&limit=2&offset=4');
    expect(third).toMatchObject({ nextOffset: null });

    const all = [...first.items, ...second.items, ...third.items].map((h) => h.page.id);
    expect(new Set(all).size).toBe(5);
  });

  it('never reads user input as FTS syntax', async () => {
    await save(await createPage('Syntax'), ['a "quoted" (thing) AND more: NEAR stuff*']);
    for (const q of ['"', 'AND', 'OR NOT', '*', '(thing', 'text:x', 'NEAR(a b)', '-', '…', '   ', '']) {
      await search(q); // 200, whatever it finds
    }
    expect(titles(await search('"quoted'))).toEqual(['Syntax']);
    expect(titles(await search('more:'))).toEqual(['Syntax']);
  });

  it('rejects oversized pages', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search?q=x&limit=500' });
    expect(res.statusCode).toBe(400);
  });
});

describe('toFtsQuery', () => {
  it('quotes each word as a required prefix term', () => {
    expect(toFtsQuery('hello  world')).toBe('"hello"* "world"*');
    expect(toFtsQuery('say "hi"')).toBe('"say"* """hi"""*');
    expect(toFtsQuery('  - … ')).toBeNull();
  });
});
