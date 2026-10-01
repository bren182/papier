import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { testApp } from '../testing.ts';

// Relations (links between rows, two-way by default) and rollups over them.

let app: ReturnType<typeof buildApp>;

beforeEach(() => {
  app = testApp();
});
afterEach(async () => {
  await app.close();
});

type Config = { options?: { id: string; name: string }[]; databaseId?: string | null; reverseId?: string | null; reverseOf?: string | null; relationId?: string | null; targetPropId?: string | null; fn?: string | null };
type Prop = { id: string; name: string; type: string; config: Config };
type Row = { id: string; title: string; props: Record<string, unknown>; refs?: Record<string, { title: string }> };
type Query = { total: number; rows: Row[]; refs: Record<string, { title: string }> };

const TODAY = '2026-09-30';

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object, status?: number) {
  const res = await app.inject({ method, url, payload });
  if (status !== undefined) expect(res.statusCode, res.body).toBe(status);
  return res.statusCode === 204 ? null : res.json();
}

const createDatabase = async (title: string, parentId: string | null = null) =>
  ((await call('POST', '/api/pages', { title, parentId, kind: 'database' }, 201)) as { id: string }).id;
const props = async (db: string) => ((await call('GET', `/api/databases/${db}`, undefined, 200)) as { properties: Prop[] }).properties;
const prop = async (db: string, name: string) => (await props(db)).find((p) => p.name === name)!;
const addProp = async (db: string, body: object) => (await call('POST', `/api/databases/${db}/properties`, body, 201)) as Prop;
const patchProp = async (db: string, id: string, body: object, status = 200) => (await call('PATCH', `/api/databases/${db}/properties/${id}`, body, status)) as Prop;
const addRow = async (db: string, title: string, values: object = {}) => ((await call('POST', `/api/databases/${db}/rows`, { title, props: values }, 201)) as Row).id;
const setProps = async (row: string, values: object, status = 200) => (await call('PATCH', `/api/pages/${row}/props`, values, status)) as Row;
const query = async (db: string, body: object = {}) => (await call('POST', `/api/databases/${db}/query`, body, 200)) as Query;
const titles = async (db: string, body: object = {}) => (await query(db, body)).rows.map((r) => r.title);
/** Row title → titles it links to through `propId`. */
async function links(db: string, propId: string) {
  const { rows, refs } = await query(db);
  return Object.fromEntries(rows.map((r) => [r.title, ((r.props[propId] as string[] | undefined) ?? []).map((id) => refs[id]!.title)]));
}
const valueOf = async (db: string, title: string, propId: string) => (await query(db)).rows.find((r) => r.title === title)!.props[propId];

/** Projects ↔ Tasks, two-way, with a few tasks linked. */
async function seed() {
  const projects = await createDatabase('Projects');
  const tasks = await createDatabase('Tasks');
  const done = await addProp(tasks, { name: 'Done', type: 'checkbox' });
  const hours = await addProp(tasks, { name: 'Hours', type: 'number' });
  const due = await addProp(tasks, { name: 'Due', type: 'date' });
  const rel = await addProp(tasks, { name: 'Project', type: 'relation', config: { databaseId: projects } });
  const twin = await prop(projects, 'Tasks');
  const alpha = await addRow(projects, 'Alpha');
  const beta = await addRow(projects, 'Beta');
  await addRow(projects, 'Gamma');
  const t1 = await addRow(tasks, 'Design', { [rel.id]: [alpha], [done.id]: true, [hours.id]: 3, [due.id]: '2026-10-05' });
  const t2 = await addRow(tasks, 'Build', { [rel.id]: [alpha], [hours.id]: 5, [due.id]: '2026-10-20' });
  const t3 = await addRow(tasks, 'Launch', { [rel.id]: [alpha, beta], [done.id]: true });
  return { projects, tasks, done, hours, due, rel, twin, alpha, beta, t1, t2, t3 };
}

describe('relations', () => {
  it('are two-way by default: the target gets a twin reading the same links', async () => {
    const s = await seed();
    expect(s.rel.config).toMatchObject({ databaseId: s.projects, reverseId: s.twin.id });
    expect(s.twin.config).toMatchObject({ databaseId: s.tasks, reverseOf: s.rel.id });
    expect(await links(s.tasks, s.rel.id)).toEqual({ Design: ['Alpha'], Build: ['Alpha'], Launch: ['Alpha', 'Beta'] });
    expect(await links(s.projects, s.twin.id)).toEqual({ Alpha: ['Design', 'Build', 'Launch'], Beta: ['Launch'], Gamma: [] });
  });

  it('can be one-way, and toggled either way later', async () => {
    const projects = await createDatabase('Projects');
    const tasks = await createDatabase('Tasks');
    const rel = await addProp(tasks, { name: 'Project', type: 'relation', config: { databaseId: projects, twoWay: false } });
    expect(await props(projects)).toEqual([]);
    const alpha = await addRow(projects, 'Alpha');
    await addRow(tasks, 'Design', { [rel.id]: [alpha] });

    await patchProp(tasks, rel.id, { config: { twoWay: true } });
    const twin = await prop(projects, 'Tasks');
    expect(await links(projects, twin.id)).toEqual({ Alpha: ['Design'] });

    await patchProp(tasks, rel.id, { config: { twoWay: false } });
    expect(await props(projects)).toEqual([]);
    expect(await links(tasks, rel.id)).toEqual({ Design: ['Alpha'] });
  });

  it('edits from the twin side write the same links', async () => {
    const s = await seed();
    const t4 = await addRow(s.tasks, 'Docs');
    const alpha = (await query(s.projects)).rows.find((r) => r.title === 'Alpha')!;
    const row = await setProps(s.alpha, { [s.twin.id]: [...(alpha.props[s.twin.id] as string[]), t4].filter((id) => id !== s.t2) });
    expect((row.props[s.twin.id] as string[]).map((id) => row.refs![id]!.title)).toEqual(['Design', 'Launch', 'Docs']);
    expect(await links(s.tasks, s.rel.id)).toEqual({ Design: ['Alpha'], Build: [], Launch: ['Alpha', 'Beta'], Docs: ['Alpha'] });
  });

  it('keeps the picked order and refuses rows of other databases', async () => {
    const s = await seed();
    await setProps(s.t2, { [s.rel.id]: [s.beta, s.alpha] });
    expect((await links(s.tasks, s.rel.id)).Build).toEqual(['Alpha', 'Beta']); // Alpha was already there
    await setProps(s.t2, { [s.rel.id]: [s.beta] });
    await setProps(s.t2, { [s.rel.id]: [s.beta, s.alpha] });
    expect((await links(s.tasks, s.rel.id)).Build).toEqual(['Beta', 'Alpha']);
    await setProps(s.t2, { [s.rel.id]: [s.t1] }, 400);
    await setProps(s.t2, { [s.rel.id]: null });
    expect((await links(s.tasks, s.rel.id)).Build).toEqual([]);
  });

  it('hides links to trashed rows and brings them back on restore', async () => {
    // There's no restore route yet (Trash is v0.2): a file database lets the test un-trash directly.
    await app.close();
    const dir = mkdtempSync(join(tmpdir(), 'papier-relations-'));
    const file = join(dir, 'test.db');
    app = testApp({ dbPath: file });
    try {
      const s = await seed();
      await call('DELETE', `/api/pages/${s.alpha}`, undefined, 204);
      expect((await links(s.tasks, s.rel.id)).Launch).toEqual(['Beta']);
      // Editing the cell meanwhile keeps the hidden link.
      await setProps(s.t3, { [s.rel.id]: [s.beta] });
      const raw = new Database(file);
      raw.prepare('update pages set archived_at = null where id = ?').run(s.alpha);
      raw.close();
      expect((await links(s.tasks, s.rel.id)).Launch).toEqual(['Alpha', 'Beta']);
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
      app = testApp();
    }
  });

  it('show nothing while the target database is in the trash', async () => {
    const s = await seed();
    await call('DELETE', `/api/pages/${s.projects}`, undefined, 204);
    expect(await links(s.tasks, s.rel.id)).toEqual({ Design: [], Build: [], Launch: [] });
    await setProps(s.t1, { [s.rel.id]: [s.beta] }, 400);
  });

  it('can relate a database to itself', async () => {
    const people = await createDatabase('People');
    const rel = await addProp(people, { name: 'Manager', type: 'relation', config: { databaseId: people } });
    const twin = await prop(people, 'Manager (reverse)');
    const ana = await addRow(people, 'Ana');
    await addRow(people, 'Bo', { [rel.id]: [ana] });
    await addRow(people, 'Cy', { [rel.id]: [ana] });
    expect(await links(people, twin.id)).toEqual({ Ana: ['Bo', 'Cy'], Bo: [], Cy: [] });
  });

  it('deleting the owning side hands its links to the twin', async () => {
    const s = await seed();
    await call('DELETE', `/api/databases/${s.tasks}/properties/${s.rel.id}`, undefined, 204);
    const twin = await prop(s.projects, 'Tasks');
    expect(twin.config.reverseOf).toBe(null);
    expect(await links(s.projects, twin.id)).toEqual({ Alpha: ['Design', 'Build', 'Launch'], Beta: ['Launch'], Gamma: [] });
    // Now it owns them: edits still work.
    await setProps(s.beta, { [twin.id]: [s.t1] });
    expect((await links(s.projects, twin.id)).Beta).toEqual(['Design']);
  });

  it('deleting the twin leaves the owner one-way', async () => {
    const s = await seed();
    await call('DELETE', `/api/databases/${s.projects}/properties/${s.twin.id}`, undefined, 204);
    expect((await prop(s.tasks, 'Project')).config.reverseId).toBe(null);
    expect((await links(s.tasks, s.rel.id)).Launch).toEqual(['Alpha', 'Beta']);
  });

  it('changing type away or re-targeting drops the links and the twin', async () => {
    const s = await seed();
    const other = await createDatabase('Clients');
    await patchProp(s.projects, s.twin.id, { config: { databaseId: other } }, 400);
    await patchProp(s.tasks, s.rel.id, { config: { databaseId: other } });
    expect(await props(s.projects)).toEqual([]);
    expect((await prop(other, 'Tasks')).config.reverseOf).toBe(s.rel.id);
    expect((await links(s.tasks, s.rel.id)).Launch).toEqual([]);

    await patchProp(s.tasks, s.rel.id, { type: 'text' });
    expect(await props(other)).toEqual([]);
    expect((await valueOf(s.tasks, 'Launch', s.rel.id))).toBeUndefined();
  });

  it('filters and sorts', async () => {
    const s = await seed();
    await addRow(s.tasks, 'Idle');
    const f = (op: string, value?: string) => titles(s.tasks, { filters: [{ propId: s.rel.id, op, value }] });
    expect(await f('contains', s.beta)).toEqual(['Launch']);
    expect(await f('not_contains', s.alpha)).toEqual(['Idle']);
    expect(await f('is_empty')).toEqual(['Idle']);
    expect(await f('is_not_empty')).toEqual(['Design', 'Build', 'Launch']);
    expect(await titles(s.projects, { sorts: [{ propId: s.twin.id, dir: 'desc' }] })).toEqual(['Beta', 'Alpha', 'Gamma']);
  });

  it('lists live databases for the target picker', async () => {
    const s = await seed();
    await createDatabase('Archive');
    await call('DELETE', `/api/pages/${await createDatabase('Old')}`, undefined, 204);
    const list = async (q = '') => ((await call('GET', `/api/databases?q=${q}`, undefined, 200)) as { title: string }[]).map((d) => d.title);
    expect(await list()).toEqual(['Archive', 'Projects', 'Tasks']);
    expect(await list('proj')).toEqual(['Projects']);
    expect(s).toBeTruthy();
  });

  it('come with a row page', async () => {
    const s = await seed();
    const page = (await call('GET', `/api/pages/${s.t3}`, undefined, 200)) as { props: Record<string, unknown>; refs: Record<string, { title: string }> };
    expect((page.props[s.rel.id] as string[]).map((id) => page.refs[id]!.title)).toEqual(['Alpha', 'Beta']);
  });
});

describe('rollups', () => {
  const rollup = async (s: Awaited<ReturnType<typeof seed>>, targetPropId: string, fn: string) =>
    addProp(s.projects, { name: fn, type: 'rollup', config: { relationId: s.twin.id, targetPropId, fn } });

  it('aggregate linked rows in SQL', async () => {
    const s = await seed();
    const cases: [string, string, Record<string, unknown>][] = [
      ['title', 'count', { Alpha: 3, Beta: 1, Gamma: 0 }],
      [s.done.id, 'checked', { Alpha: 2, Beta: 1, Gamma: 0 }],
      [s.done.id, 'percent_checked', { Alpha: 2 / 3, Beta: 1, Gamma: undefined }],
      [s.hours.id, 'sum', { Alpha: 8, Beta: 0, Gamma: 0 }],
      [s.hours.id, 'avg', { Alpha: 4, Beta: undefined }],
      [s.hours.id, 'range', { Alpha: 2 }],
      [s.hours.id, 'count_values', { Alpha: 2, Beta: 0 }],
      [s.hours.id, 'percent_empty', { Alpha: 1 / 3, Beta: 1 }],
      [s.due.id, 'earliest', { Alpha: '2026-10-05', Beta: undefined }],
      [s.due.id, 'latest', { Alpha: '2026-10-20' }],
      ['title', 'show_original', { Alpha: ['Design', 'Build', 'Launch'], Gamma: undefined }],
      [s.done.id, 'show_original', { Alpha: ['Yes', 'Yes'] }],
    ];
    for (const [target, fn, want] of cases) {
      const r = await rollup(s, target, fn);
      const { rows } = await query(s.projects);
      const got = Object.fromEntries(rows.map((row) => [row.title, row.props[r.id]]));
      for (const [title, v] of Object.entries(want)) expect(got[title], `${fn} of ${title}`).toEqual(v);
    }
  });

  it('sort and filter like their result (percentages as shown)', async () => {
    const s = await seed();
    const pct = await rollup(s, s.done.id, 'percent_checked');
    expect(await titles(s.projects, { sorts: [{ propId: pct.id, dir: 'asc' }] })).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(await titles(s.projects, { filters: [{ propId: pct.id, op: '>=', value: 100 }] })).toEqual(['Beta']);
    expect(await titles(s.projects, { filters: [{ propId: pct.id, op: 'is_empty' }] })).toEqual(['Gamma']);
    const due = await rollup(s, s.due.id, 'latest');
    expect(await titles(s.projects, { filters: [{ propId: due.id, op: 'after', value: '2026-10-10' }] })).toEqual(['Alpha']);
    const list = await rollup(s, 'title', 'show_original');
    expect(await titles(s.projects, { filters: [{ propId: list.id, op: 'is_not_empty' }] })).toEqual(['Alpha', 'Beta']);
    // A list rollup doesn't sort.
    expect(await titles(s.projects, { sorts: [{ propId: list.id, dir: 'desc' }] })).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('follow edits of the linked rows', async () => {
    const s = await seed();
    const pct = await rollup(s, s.done.id, 'percent_checked');
    await setProps(s.t2, { [s.done.id]: true });
    expect(await valueOf(s.projects, 'Alpha', pct.id)).toBe(1);
    await call('DELETE', `/api/pages/${s.t3}`, undefined, 204);
    expect(await valueOf(s.projects, 'Beta', pct.id)).toBeUndefined();
  });

  it('are read-only and lose their relation when it is deleted', async () => {
    const s = await seed();
    const count = await rollup(s, 'title', 'count');
    await setProps(s.alpha, { [count.id]: 3 }, 400);
    await call('DELETE', `/api/databases/${s.projects}/properties/${s.twin.id}`, undefined, 204);
    expect((await prop(s.projects, 'count')).config).toMatchObject({ relationId: null, targetPropId: null, fn: 'count' });
    expect(await valueOf(s.projects, 'Alpha', count.id)).toBeUndefined();
  });

  it('ignore a function that no longer fits the target type', async () => {
    const s = await seed();
    const sum = await rollup(s, s.hours.id, 'sum');
    await patchProp(s.tasks, s.hours.id, { type: 'text' });
    expect(await valueOf(s.projects, 'Alpha', sum.id)).toBeUndefined();
  });
});

describe('copying related databases', () => {
  const duplicate = async (id: string, body: object = {}) => ((await call('POST', `/api/pages/${id}/duplicate`, { today: TODAY, ...body }, 201)) as { id: string }).id;

  it('a page holding both databases: the copies relate to each other', async () => {
    const home = ((await call('POST', '/api/pages', { title: 'Home' }, 201)) as { id: string }).id;
    const projects = await createDatabase('Projects', home);
    const tasks = await createDatabase('Tasks', home);
    const rel = await addProp(tasks, { name: 'Project', type: 'relation', config: { databaseId: projects } });
    const count = await addProp(projects, { name: 'Count', type: 'rollup', config: { relationId: (await prop(projects, 'Tasks')).id, targetPropId: 'title', fn: 'count' } });
    const alpha = await addRow(projects, 'Alpha');
    await addRow(tasks, 'Design', { [rel.id]: [alpha] });

    const copy = await duplicate(home);
    const kids = (await call('GET', `/api/pages?parent=${copy}`, undefined, 200)) as { id: string; title: string }[];
    const p2 = kids.find((k) => k.title === 'Projects')!.id;
    const t2 = kids.find((k) => k.title === 'Tasks')!.id;
    const rel2 = await prop(t2, 'Project');
    const twin2 = await prop(p2, 'Tasks');
    expect(rel2.config).toMatchObject({ databaseId: p2, reverseId: twin2.id });
    expect(twin2.config).toMatchObject({ databaseId: t2, reverseOf: rel2.id });
    expect(await links(t2, rel2.id)).toEqual({ Design: ['Alpha'] });
    expect((await query(p2)).rows[0]!.props[(await prop(p2, 'Count')).id]).toBe(1);
    // The originals are untouched.
    expect(await links(projects, (await prop(projects, 'Tasks')).id)).toEqual({ Alpha: ['Design'] });
    expect(count.id).toBeTruthy();
  });

  it('one side alone: the copy is one-way and keeps its links', async () => {
    const s = await seed();
    const copy = await duplicate(s.tasks);
    const rel2 = await prop(copy, 'Project');
    expect(rel2.config).toMatchObject({ databaseId: s.projects, reverseId: null });
    expect(await links(copy, rel2.id)).toEqual({ Design: ['Alpha'], Build: ['Alpha'], Launch: ['Alpha', 'Beta'] });
    expect((await props(s.projects)).map((p) => p.name)).toEqual(['Tasks']);
    expect((await links(s.projects, s.twin.id)).Alpha).toEqual(['Design', 'Build', 'Launch']);

    // The twin's side alone: it takes the links over, the other way round.
    const projectsCopy = await duplicate(s.projects);
    const twin2 = await prop(projectsCopy, 'Tasks');
    expect(twin2.config.reverseOf).toBe(null);
    expect((await links(projectsCopy, twin2.id)).Beta).toEqual(['Launch']);
    expect((await links(s.tasks, s.rel.id)).Launch).toEqual(['Alpha', 'Beta']);
  });

  it('a row from a template keeps the template’s links', async () => {
    const s = await seed();
    const template = ((await call('POST', `/api/databases/${s.tasks}/templates`, undefined, 201)) as { id: string }).id;
    await setProps(template, { [s.rel.id]: [s.beta] });
    const row = ((await call('POST', `/api/databases/${s.tasks}/rows`, { title: 'From template', templateId: template, today: TODAY }, 201)) as Row);
    expect((row.props[s.rel.id] as string[]).map((id) => row.refs![id]!.title)).toEqual(['Beta']);
    // The template itself stays out of the projects' view of their tasks.
    expect((await links(s.projects, s.twin.id)).Beta).toEqual(['Launch', 'From template']);
  });
});
