import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { openDb } from '../db/index.ts';
import { backfillPageBlocks } from '../db/pageTree.ts';
import { pages } from '../db/schema.ts';

// Databases: a database is a page, its rows are child pages with typed values.

let app: ReturnType<typeof buildApp>;

beforeEach(() => {
  app = buildApp({ logger: false });
});
afterEach(async () => {
  await app.close();
});

type Prop = { id: string; name: string; type: string; config: { options?: { id: string; name: string }[] } };
type View = { id: string; name: string; type: string; config: Record<string, unknown> };
type Row = { id: string; title: string; props: Record<string, unknown> };

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object, status?: number) {
  const res = await app.inject({ method, url, payload });
  if (status !== undefined) expect(res.statusCode, res.body).toBe(status);
  return res.statusCode === 204 ? null : res.json();
}

async function createDatabase(title = 'Tasks', parentId: string | null = null, block = true) {
  return (await call('POST', '/api/pages', { title, parentId, kind: 'database', block }, 201)) as { id: string; kind: string };
}

const schema = async (id: string) => (await call('GET', `/api/databases/${id}`, undefined, 200)) as { properties: Prop[]; views: View[] };
const addProp = async (db: string, body: object) => (await call('POST', `/api/databases/${db}/properties`, body, 201)) as Prop;
const addRow = async (db: string, title: string, props: object = {}) => (await call('POST', `/api/databases/${db}/rows`, { title, props }, 201)) as Row;
const query = async (db: string, body: object = {}) => (await call('POST', `/api/databases/${db}/query`, body, 200)) as { total: number; rows: Row[] };
const titles = async (db: string, body: object = {}) => (await query(db, body)).rows.map((r) => r.title);

/** A database with a status select, a number and tags. */
async function seed() {
  const db = await createDatabase();
  const status = await addProp(db.id, { name: 'Status', type: 'select', config: { options: [{ name: 'Todo' }, { name: 'Doing' }, { name: 'Done' }] } });
  const [todo, doing, done] = status.config.options!.map((o) => o.id);
  const points = await addProp(db.id, { name: 'Points', type: 'number' });
  const tags = await addProp(db.id, { name: 'Tags', type: 'multi_select', config: { options: [{ name: 'red' }, { name: 'blue' }] } });
  const [red, blue] = tags.config.options!.map((o) => o.id);
  await addRow(db.id, 'Write', { [status.id]: done, [points.id]: 3, [tags.id]: [red] });
  await addRow(db.id, 'Test', { [status.id]: todo, [points.id]: 8, [tags.id]: [red, blue] });
  await addRow(db.id, 'Ship', { [status.id]: doing });
  await addRow(db.id, 'Plan', { [points.id]: 1 });
  return { db: db.id, status, points, tags, todo: todo!, doing: doing!, done: done!, red: red!, blue: blue! };
}

describe('databases', () => {
  it('starts with a table view and no properties', async () => {
    const db = await createDatabase();
    expect(db.kind).toBe('database');
    const { properties, views } = await schema(db.id);
    expect(properties).toEqual([]);
    expect(views.map((v) => [v.name, v.type])).toEqual([['Table', 'table']]);
  });

  it('keeps rows out of the sidebar', async () => {
    const db = await createDatabase();
    await addRow(db.id, 'Row');
    const root = (await call('GET', '/api/pages')) as { id: string; hasChildren: boolean }[];
    expect(root.find((p) => p.id === db.id)?.hasChildren).toBe(false);
  });

  it('tells a row page which database it belongs to', async () => {
    const db = await createDatabase('Tasks');
    const row = await addRow(db.id, 'Row');
    const res = (await call('GET', `/api/pages/${row.id}`, undefined, 200)) as { database: { id: string; title: string } };
    expect(res.database).toEqual({ id: db.id, title: 'Tasks' });
  });

  it('refuses sub-pages and moves into a database', async () => {
    const db = await createDatabase();
    const page = (await call('POST', '/api/pages', { title: 'P' }, 201)) as { id: string };
    await call('POST', '/api/pages', { title: 'X', parentId: db.id }, 400);
    await call('POST', `/api/pages/${page.id}/move`, { parentId: db.id }, 400);
  });
});

describe('row values', () => {
  it('validates values against the property type', async () => {
    const { db, status, points } = await seed();
    const row = await addRow(db, 'Row');
    await call('PATCH', `/api/pages/${row.id}/props`, { [points.id]: 'many' }, 400);
    await call('PATCH', `/api/pages/${row.id}/props`, { [status.id]: 'no-such-option' }, 400);
    await call('PATCH', `/api/pages/${row.id}/props`, { unknown: 1 }, 400);
    const ok = (await call('PATCH', `/api/pages/${row.id}/props`, { [points.id]: 5 }, 200)) as Row;
    expect(ok.props).toEqual({ [points.id]: 5 });
    const cleared = (await call('PATCH', `/api/pages/${row.id}/props`, { [points.id]: null }, 200)) as Row;
    expect(cleared.props).toEqual({});
  });

  it('only sets props on rows', async () => {
    const page = (await call('POST', '/api/pages', { title: 'P' }, 201)) as { id: string };
    await call('PATCH', `/api/pages/${page.id}/props`, { x: 1 }, 404);
  });
});

describe('query', () => {
  it('returns rows in manual order with their values', async () => {
    const { db, points } = await seed();
    const res = await query(db);
    expect(res.total).toBe(4);
    expect(res.rows.map((r) => r.title)).toEqual(['Write', 'Test', 'Ship', 'Plan']);
    expect(res.rows[0]!.props[points.id]).toBe(3);
  });

  it('sorts by number (empties last), select option order and title', async () => {
    const { db, points, status } = await seed();
    expect(await titles(db, { sorts: [{ propId: points.id, dir: 'desc' }] })).toEqual(['Test', 'Write', 'Plan', 'Ship']);
    expect(await titles(db, { sorts: [{ propId: status.id, dir: 'asc' }] })).toEqual(['Test', 'Ship', 'Write', 'Plan']);
    expect(await titles(db, { sorts: [{ propId: 'title', dir: 'asc' }] })).toEqual(['Plan', 'Ship', 'Test', 'Write']);
  });

  it('filters on each type', async () => {
    const { db, points, status, tags, blue, done } = await seed();
    expect(await titles(db, { filters: [{ propId: points.id, op: '>', value: 2 }] })).toEqual(['Write', 'Test']);
    expect(await titles(db, { filters: [{ propId: points.id, op: 'is_empty' }] })).toEqual(['Ship']);
    expect(await titles(db, { filters: [{ propId: status.id, op: 'is_not', value: done }] })).toEqual(['Test', 'Ship', 'Plan']);
    expect(await titles(db, { filters: [{ propId: tags.id, op: 'contains', value: blue }] })).toEqual(['Test']);
    expect(await titles(db, { filters: [{ propId: 'title', op: 'contains', value: 'T' }] })).toEqual(['Write', 'Test']);
    // Filters without a value yet are ignored, not "match nothing".
    expect(await titles(db, { filters: [{ propId: points.id, op: '>', value: '' }] })).toHaveLength(4);
  });

  it('filters dates and escapes LIKE wildcards', async () => {
    const db = await createDatabase();
    const due = await addProp(db.id, { name: 'Due', type: 'date' });
    await addRow(db.id, '100%', { [due.id]: '2026-01-10' });
    await addRow(db.id, 'plain', { [due.id]: '2026-03-01' });
    expect(await titles(db.id, { filters: [{ propId: due.id, op: 'before', value: '2026-02-01' }] })).toEqual(['100%']);
    expect(await titles(db.id, { filters: [{ propId: 'title', op: 'contains', value: '%' }] })).toEqual(['100%']);
  });

  it('uses the view config unless overridden', async () => {
    const { db, points } = await seed();
    const view = (await schema(db)).views[0]!;
    await call('PATCH', `/api/databases/${db}/views/${view.id}`, { config: { sorts: [{ propId: points.id, dir: 'asc' }] } }, 200);
    expect(await titles(db, { viewId: view.id })).toEqual(['Plan', 'Write', 'Test', 'Ship']);
    expect(await titles(db, { viewId: view.id, sorts: [] })).toEqual(['Write', 'Test', 'Ship', 'Plan']);
  });

  it('pages with offset and limit', async () => {
    const { db } = await seed();
    const page = await query(db, { offset: 1, limit: 2 });
    expect(page.total).toBe(4);
    expect(page.rows.map((r) => r.title)).toEqual(['Test', 'Ship']);
  });

  it('narrows to one board column', async () => {
    const { db, status, tags, todo, red } = await seed();
    expect(await titles(db, { group: { propId: status.id, value: todo } })).toEqual(['Test']);
    expect(await titles(db, { group: { propId: status.id, value: null } })).toEqual(['Plan']);
    expect(await titles(db, { group: { propId: tags.id, value: red } })).toEqual(['Write', 'Test']);
  });

  it('hides trashed rows', async () => {
    const { db } = await seed();
    const [first] = (await query(db)).rows;
    await call('DELETE', `/api/pages/${first!.id}`, undefined, 204);
    expect(await titles(db)).toEqual(['Test', 'Ship', 'Plan']);
  });

  it('reorders rows manually', async () => {
    const { db } = await seed();
    const rows = (await query(db)).rows;
    await call('POST', `/api/databases/${db}/rows/${rows[3]!.id}/move`, { beforeId: rows[0]!.id }, 200);
    expect(await titles(db)).toEqual(['Plan', 'Write', 'Test', 'Ship']);
  });
});

describe('properties', () => {
  it('renames and reorders', async () => {
    const { db, points, status } = await seed();
    await call('PATCH', `/api/databases/${db}/properties/${points.id}`, { name: 'Estimate', beforeId: status.id }, 200);
    expect((await schema(db)).properties.map((p) => p.name)).toEqual(['Estimate', 'Status', 'Tags']);
  });

  it('converts values when the type changes', async () => {
    const { db, points, status, todo, doing, done } = await seed();
    await call('PATCH', `/api/databases/${db}/properties/${points.id}`, { type: 'text' }, 200);
    await call('PATCH', `/api/databases/${db}/properties/${status.id}`, { type: 'text' }, 200);
    const rows = (await query(db)).rows;
    expect(rows.map((r) => r.props[points.id])).toEqual(['3', '8', undefined, '1']);
    expect(rows.map((r) => r.props[status.id])).toEqual(['Done', 'Todo', 'Doing', undefined]);

    // Back to select: the kept options match again by name, with their old ids.
    const back = (await call('PATCH', `/api/databases/${db}/properties/${status.id}`, { type: 'select' }, 200)) as Prop;
    expect(back.config.options).toEqual(status.config.options);
    expect((await query(db)).rows.map((r) => r.props[status.id])).toEqual([done, todo, doing, undefined]);
  });

  it('text to select creates an option per distinct value', async () => {
    const db = await createDatabase();
    const kind = await addProp(db.id, { name: 'Kind', type: 'text' });
    await addRow(db.id, 'A', { [kind.id]: 'Bug' });
    await addRow(db.id, 'B', { [kind.id]: 'Idea' });
    await addRow(db.id, 'C', { [kind.id]: 'bug' });
    const sel = (await call('PATCH', `/api/databases/${db.id}/properties/${kind.id}`, { type: 'select' }, 200)) as Prop;
    const [bug, idea] = sel.config.options!;
    expect(sel.config.options!.map((o) => o.name)).toEqual(['Bug', 'Idea']);
    expect((await query(db.id)).rows.map((r) => r.props[kind.id])).toEqual([bug!.id, idea!.id, bug!.id]);
  });

  it('drops values of removed options', async () => {
    const { db, tags, red } = await seed();
    await call('PATCH', `/api/databases/${db}/properties/${tags.id}`, { config: { options: [{ id: red, name: 'red' }] } }, 200);
    const rows = (await query(db)).rows;
    expect(rows.map((r) => r.props[tags.id])).toEqual([[red], [red], undefined, undefined]);
  });

  it('deleting a property removes its values and view references', async () => {
    const { db, points } = await seed();
    const view = (await schema(db)).views[0]!;
    await call('PATCH', `/api/databases/${db}/views/${view.id}`, { config: { sorts: [{ propId: points.id }], hidden: [points.id] } }, 200);
    await call('DELETE', `/api/databases/${db}/properties/${points.id}`, undefined, 204);
    const after = await schema(db);
    expect(after.properties.map((p) => p.name)).toEqual(['Status', 'Tags']);
    expect(after.views[0]!.config).toMatchObject({ sorts: [], hidden: [] });
    expect((await query(db)).rows.every((r) => !(points.id in r.props))).toBe(true);
  });
});

describe('views', () => {
  it('adds, renames and deletes views but keeps the last one', async () => {
    const db = await createDatabase();
    const [table] = (await schema(db.id)).views;
    const board = (await call('POST', `/api/databases/${db.id}/views`, { name: 'Board', type: 'board' }, 201)) as View;
    await call('PATCH', `/api/databases/${db.id}/views/${board.id}`, { name: 'Kanban' }, 200);
    expect((await schema(db.id)).views.map((v) => v.name)).toEqual(['Table', 'Kanban']);
    await call('DELETE', `/api/databases/${db.id}/views/${table!.id}`, undefined, 204);
    await call('DELETE', `/api/databases/${db.id}/views/${board.id}`, undefined, 400);
  });
});

describe('inline databases', () => {
  it('are owned by their database block', async () => {
    const page = (await call('POST', '/api/pages', { title: 'Host' }, 201)) as { id: string };
    const db = await createDatabase('Inline', page.id, false);
    const block = { id: 'd1', type: 'database', parentId: null, order: 'a0', props: { pageId: db.id }, content: [] };
    await call('POST', `/api/pages/${page.id}/blocks/batch`, { upserts: [block] }, 200);

    await call('POST', `/api/pages/${page.id}/blocks/batch`, { deletes: ['d1'] }, 200);
    await call('GET', `/api/databases/${db.id}`, undefined, 404);

    await call('POST', `/api/pages/${page.id}/blocks/batch`, { upserts: [block] }, 200);
    await call('GET', `/api/databases/${db.id}`, undefined, 200);
  });

  it('backfill leaves rows alone', () => {
    const { db, sqlite } = openDb(':memory:');
    const t = { createdAt: 1, updatedAt: 1 };
    db.insert(pages).values({ id: 'db', kind: 'database', title: 'DB', orderKey: 'a0', ...t }).run();
    db.insert(pages).values({ id: 'r1', parentId: 'db', title: 'Row', orderKey: 'a0', ...t }).run();
    expect(backfillPageBlocks(db)).toBe(0);
    sqlite.close();
  });
});
