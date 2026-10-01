import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { testApp } from '../testing.ts';
import { MAX_PAGES } from '../db/duplicate.ts';

// Duplicate, Save as template, Use template — one deep-copy engine.

let app: ReturnType<typeof buildApp>;
beforeEach(() => {
  app = testApp();
});
afterEach(async () => {
  await app.close();
});

const TODAY = '2026-09-30';

type Block = { id: string; type: string; parentId: string | null; props: Record<string, unknown>; content: { type: string; text?: string; props?: { date?: string } }[] };
type Page = { id: string; title: string; parentId: string | null; isTemplate: boolean; kind: string };

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object, status?: number) {
  const res = await app.inject({ method, url, payload });
  if (status !== undefined) expect(res.statusCode, res.body).toBe(status);
  return res.statusCode === 204 ? null : res.json();
}

const create = async (title: string, extra: object = {}) => (await call('POST', '/api/pages', { title, ...extra }, 201)) as Page;
const blocksOf = async (id: string) => (await call('GET', `/api/pages/${id}/blocks`, undefined, 200)) as Block[];
const children = async (id?: string) => ((await call('GET', id ? `/api/pages?parent=${id}` : '/api/pages', undefined, 200)) as Page[]).map((p) => p.title);
const duplicate = async (id: string, body: object = {}, status = 201) => (await call('POST', `/api/pages/${id}/duplicate`, { today: TODAY, ...body }, status)) as Page;
const text = (t: string) => [{ type: 'text', text: t }];
const today = () => [{ type: 'text', text: 'On ' }, { type: 'date', props: { date: '@today' } }];

/** A page with nested content, an owned sub-page, and a link to an unrelated page. */
async function seedPage() {
  const other = await create('Elsewhere');
  const page = await create('Meeting');
  const sub = await create('Notes', { parentId: page.id, block: false });
  await call('POST', `/api/pages/${page.id}/blocks/batch`, {
    upserts: [
      { id: 'h', type: 'heading', parentId: null, order: 'a0', props: { level: 2 }, content: text('Agenda') },
      { id: 'c', type: 'todo', parentId: 'h', order: 'a0', props: { checked: false }, content: text('Item') },
      { id: 's', type: 'page', parentId: null, order: 'a1', props: { pageId: sub.id }, content: [] },
      { id: 'l', type: 'page', parentId: null, order: 'a2', props: { pageId: other.id }, content: [] },
    ],
  }, 200);
  await call('POST', `/api/pages/${sub.id}/blocks/batch`, { upserts: [{ id: 'sb', type: 'paragraph', parentId: null, order: 'a0', content: text('Inside') }] }, 200);
  return { page, sub, other };
}

describe('duplicate', () => {
  it('copies content with fresh ids and deep-copies owned sub-pages', async () => {
    const { page, sub, other } = await seedPage();
    const copy = await duplicate(page.id);
    expect(copy.title).toBe('Meeting');
    expect(await children()).toEqual(['Elsewhere', 'Meeting', 'Meeting']);

    const bs = await blocksOf(copy.id);
    expect(bs.map((b) => b.type).sort()).toEqual(['heading', 'page', 'page', 'todo']);
    expect(bs.some((b) => ['h', 'c', 's', 'l'].includes(b.id))).toBe(false);
    const heading = bs.find((b) => b.type === 'heading')!;
    expect(bs.find((b) => b.type === 'todo')!.parentId).toBe(heading.id);

    const [owned, link] = bs.filter((b) => b.type === 'page').sort((a, b) => (a.props.pageId === other.id ? 1 : -1));
    expect(link!.props.pageId).toBe(other.id); // links stay links
    expect(owned!.props.pageId).not.toBe(sub.id); // owned sub-pages are copied
    expect(await children(copy.id)).toEqual(['Notes']);
    expect((await blocksOf(owned!.props.pageId as string)).map((b) => b.content[0]?.text)).toEqual(['Inside']);
  });

  it('copies a database: new property ids, remapped views, rows with values', async () => {
    const db = await create('Tasks', { kind: 'database' });
    const status = (await call('POST', `/api/databases/${db.id}/properties`, { name: 'Status', type: 'select', config: { options: [{ name: 'Todo' }] } }, 201)) as { id: string; config: { options: { id: string }[] } };
    const view = ((await call('GET', `/api/databases/${db.id}`)) as { views: { id: string }[] }).views[0]!;
    await call('PATCH', `/api/databases/${db.id}/views/${view.id}`, { config: { sorts: [{ propId: status.id, dir: 'asc' }], hidden: [status.id] } }, 200);
    await call('POST', `/api/databases/${db.id}/rows`, { title: 'Row', props: { [status.id]: status.config.options[0]!.id } }, 201);

    const copy = await duplicate(db.id);
    const schema = (await call('GET', `/api/databases/${copy.id}`)) as { properties: { id: string }[]; views: { config: { sorts: { propId: string }[]; hidden: string[] } }[] };
    const newProp = schema.properties[0]!.id;
    expect(newProp).not.toBe(status.id);
    expect(schema.views[0]!.config.sorts[0]!.propId).toBe(newProp);
    expect(schema.views[0]!.config.hidden).toEqual([newProp]);
    const rows = ((await call('POST', `/api/databases/${copy.id}/query`, {})) as { rows: { title: string; props: Record<string, unknown> }[] }).rows;
    expect(rows).toEqual([expect.objectContaining({ title: 'Row', props: { [newProp]: status.config.options[0]!.id } })]);
  });

  it('refuses copies over the size cap', async () => {
    const db = await create('Big', { kind: 'database' });
    // Rows are cheap to make through the API; go just past the cap.
    await Promise.all(Array.from({ length: MAX_PAGES }, (_, i) => call('POST', `/api/databases/${db.id}/rows`, { title: `r${i}` })));
    await duplicate(db.id, {}, 400);
  }, 30_000);
});

describe('page templates', () => {
  it('save as template: hidden from the sidebar and search, listed in the library', async () => {
    const { page } = await seedPage();
    await call('PATCH', `/api/pages/${page.id}`, { titleContent: [{ type: 'text', text: 'Standup ' }, { type: 'date', props: { date: '@today' } }] }, 200);
    const template = await duplicate(page.id, { asTemplate: true });
    expect(template.isTemplate).toBe(true);
    expect(template.parentId).toBe(null);
    const root = (await call('GET', '/api/pages')) as Page[];
    expect(root.map((p) => p.id)).not.toContain(template.id);
    expect(((await call('GET', '/api/templates')) as { id: string }[]).map((t) => t.id)).toEqual([template.id]);

    const hits = (await call('GET', '/api/search?q=Inside')) as { items: { pageId: string }[] };
    expect(hits.items).toHaveLength(1); // the original's sub-page, not the template's copy

    // Pages inside a template know it (their dates stay dynamic too).
    const [inner] = await children(template.id);
    expect(inner).toBe('Notes');
  });

  it('use template: a normal page with dynamic dates resolved', async () => {
    const page = await create('Journal');
    await call('PATCH', `/api/pages/${page.id}`, { titleContent: [{ type: 'text', text: 'Journal ' }, { type: 'date', props: { date: '@today' } }] }, 200);
    await call('POST', `/api/pages/${page.id}/blocks/batch`, { upserts: [{ id: 'd', type: 'paragraph', parentId: null, order: 'a0', content: today() }] }, 200);
    const template = await duplicate(page.id, { asTemplate: true });
    // The template keeps "@today"…
    expect((await blocksOf(template.id))[0]!.content[1]!.props!.date).toBe('@today');

    const host = await create('Host');
    const used = await duplicate(template.id, { parentId: host.id });
    // …the page made from it gets the date.
    expect(used.isTemplate).toBe(false);
    expect(used.title).toBe(`Journal ${TODAY}`);
    expect((await blocksOf(used.id))[0]!.content[1]!.props!.date).toBe(TODAY);
    expect(await children(host.id)).toEqual([`Journal ${TODAY}`]);
    expect((await blocksOf(host.id)).map((b) => b.props.pageId)).toEqual([used.id]); // got its page block
  });
});

describe('database templates', () => {
  async function seedDatabase() {
    const db = await create('Birthdays', { kind: 'database' });
    const rel = (await call('POST', `/api/databases/${db.id}/properties`, { name: 'Relationship', type: 'select', config: { options: [{ name: 'Friend' }] } }, 201)) as { id: string; config: { options: { id: string }[] } };
    const added = (await call('POST', `/api/databases/${db.id}/properties`, { name: 'Added', type: 'date' }, 201)) as { id: string };
    const template = (await call('POST', `/api/databases/${db.id}/templates`, undefined, 201)) as { id: string };
    return { db, rel, added, template, friend: rel.config.options[0]!.id };
  }

  it('a template holds values (including @today) but is not a row', async () => {
    const { db, rel, added, template, friend } = await seedDatabase();
    await call('PATCH', `/api/pages/${template.id}/props`, { [rel.id]: friend, [added.id]: '@today' }, 200);
    // @today is only for templates.
    const row = (await call('POST', `/api/databases/${db.id}/rows`, { title: 'Real' }, 201)) as { id: string };
    await call('PATCH', `/api/pages/${row.id}/props`, { [added.id]: '@today' }, 400);

    const q = (await call('POST', `/api/databases/${db.id}/query`, {})) as { total: number };
    expect(q.total).toBe(1);
    const schema = (await call('GET', `/api/databases/${db.id}`)) as { templates: { id: string }[] };
    expect(schema.templates.map((t) => t.id)).toEqual([template.id]);
  });

  it('new row from a template: its values, today resolved, given values on top', async () => {
    const { db, rel, added, template, friend } = await seedDatabase();
    await call('PATCH', `/api/pages/${template.id}/props`, { [rel.id]: friend, [added.id]: '@today' }, 200);
    await call('POST', `/api/pages/${template.id}/blocks/batch`, { upserts: [{ id: 'g', type: 'paragraph', parentId: null, order: 'a0', content: text('Gift ideas') }] }, 200);

    const row = (await call('POST', `/api/databases/${db.id}/rows`, { title: 'Sam', templateId: template.id, today: TODAY }, 201)) as { id: string; title: string; props: Record<string, unknown> };
    expect(row.title).toBe('Sam');
    expect(row.props).toEqual({ [rel.id]: friend, [added.id]: TODAY });
    expect((await blocksOf(row.id)).map((b) => b.content[0]?.text)).toEqual(['Gift ideas']);

    // Only this database's templates, and never another page.
    const other = await create('Other');
    await call('POST', `/api/databases/${db.id}/rows`, { templateId: other.id, today: TODAY }, 400);
    await duplicate(template.id, { parentId: other.id }, 400);
  });
});
