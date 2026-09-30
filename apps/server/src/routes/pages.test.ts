import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';

let app: ReturnType<typeof buildApp>;

beforeEach(() => {
  app = buildApp({ logger: false });
});
afterEach(async () => {
  await app.close();
});

async function create(body: object = {}) {
  const res = await app.inject({ method: 'POST', url: '/api/pages', payload: body });
  expect(res.statusCode).toBe(201);
  return res.json();
}

async function list(parent?: string) {
  const res = await app.inject({ method: 'GET', url: parent ? `/api/pages?parent=${parent}` : '/api/pages' });
  return res.json() as Array<{ id: string; title: string; hasChildren: boolean }>;
}

describe('pages API', () => {
  it('creates root pages in order', async () => {
    const a = await create({ title: 'A' });
    const b = await create({ title: 'B' });
    expect(a.order < b.order).toBe(true);
    expect((await list()).map((p) => p.title)).toEqual(['A', 'B']);
  });

  it('nests subpages and reports hasChildren', async () => {
    const parent = await create({ title: 'Parent' });
    await create({ title: 'Child', parentId: parent.id });

    const roots = await list();
    expect(roots).toHaveLength(1);
    expect(roots[0]?.hasChildren).toBe(true);
    expect((await list(parent.id)).map((p) => p.title)).toEqual(['Child']);
  });

  it('returns ancestors for breadcrumbs', async () => {
    const a = await create({ title: 'A' });
    const b = await create({ title: 'B', parentId: a.id });
    const c = await create({ title: 'C', parentId: b.id });

    const res = await app.inject({ method: 'GET', url: `/api/pages/${c.id}` });
    expect(res.json().ancestors.map((p: { title: string }) => p.title)).toEqual(['A', 'B']);
  });

  it('renames a page', async () => {
    const page = await create({ title: 'Old' });
    const res = await app.inject({ method: 'PATCH', url: `/api/pages/${page.id}`, payload: { title: 'New' } });
    expect(res.json().title).toBe('New');
  });

  it('stores a rich title and derives the plain one', async () => {
    const page = await create();
    const titleContent = [
      { type: 'text', text: 'Standup ' },
      { type: 'date', props: { date: '2026-09-30' } },
    ];
    const res = await app.inject({ method: 'PATCH', url: `/api/pages/${page.id}`, payload: { titleContent } });
    expect(res.json()).toMatchObject({ title: 'Standup 2026-09-30', titleContent });

    const child = await create({ parentId: page.id });
    const detail = await app.inject({ method: 'GET', url: `/api/pages/${child.id}` });
    expect(detail.json().ancestors[0]).toMatchObject({ title: 'Standup 2026-09-30', titleContent });
  });

  it('drops the rich title when renamed with plain text', async () => {
    const page = await create();
    await app.inject({ method: 'PATCH', url: `/api/pages/${page.id}`, payload: { titleContent: [{ type: 'text', text: 'A' }] } });
    const res = await app.inject({ method: 'PATCH', url: `/api/pages/${page.id}`, payload: { title: 'B' } });
    expect(res.json()).toMatchObject({ title: 'B', titleContent: null });
  });

  it('rejects invalid input with 400', async () => {
    const page = await create();
    const res = await app.inject({ method: 'PATCH', url: `/api/pages/${page.id}`, payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it('moves a page and its subtree to trash', async () => {
    const parent = await create({ title: 'Parent' });
    const child = await create({ title: 'Child', parentId: parent.id });

    const del = await app.inject({ method: 'DELETE', url: `/api/pages/${parent.id}` });
    expect(del.statusCode).toBe(204);
    expect(await list()).toEqual([]);

    const res = await app.inject({ method: 'GET', url: `/api/pages/${child.id}` });
    expect(res.statusCode).toBe(404);
  });

  it('refuses to create under a trashed parent', async () => {
    const parent = await create();
    await app.inject({ method: 'DELETE', url: `/api/pages/${parent.id}` });
    const res = await app.inject({ method: 'POST', url: '/api/pages', payload: { parentId: parent.id } });
    expect(res.statusCode).toBe(404);
  });
});
