import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';

// Many rows at once (fill down, bulk set, bulk delete) and moving/copying rows between databases.

let app: ReturnType<typeof buildApp>;

beforeEach(() => {
  app = buildApp({ logger: false });
});
afterEach(async () => {
  await app.close();
});

type Prop = { id: string; name: string; type: string; config: { options?: { id: string; name: string }[] } };
type Row = { id: string; title: string; props: Record<string, unknown> };
const TODAY = '2026-09-30';

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object, status?: number) {
  const res = await app.inject({ method, url, payload });
  if (status !== undefined) expect(res.statusCode, res.body).toBe(status);
  return res.statusCode === 204 ? null : res.json();
}

const createDatabase = async (title: string, parentId: string | null = null) =>
  ((await call('POST', '/api/pages', { title, parentId, kind: 'database' }, 201)) as { id: string }).id;
const addProp = async (db: string, body: object) => (await call('POST', `/api/databases/${db}/properties`, body, 201)) as Prop;
const addRow = async (db: string, title: string, values: object = {}) => ((await call('POST', `/api/databases/${db}/rows`, { title, props: values }, 201)) as Row).id;
const rows = async (db: string) => ((await call('POST', `/api/databases/${db}/query`, {}, 200)) as { rows: Row[] }).rows;
const schema = async (db: string) => ((await call('GET', `/api/databases/${db}`, undefined, 200)) as { properties: Prop[] }).properties;
const byName = async (db: string, name: string) => (await schema(db)).find((p) => p.name === name)!;

/** Two meeting databases that differ a little: Type is a select here, text there; only the source has Attendees. */
async function seed() {
  const meetings = await createDatabase('Meetings');
  const date = await addProp(meetings, { name: 'Date', type: 'date' });
  const type = await addProp(meetings, { name: 'Type', type: 'select', config: { options: [{ name: 'Standup' }, { name: 'Review' }] } });
  const attendees = await addProp(meetings, { name: 'Attendees', type: 'text' });
  const [standup, review] = type.config.options!.map((o) => o.id);
  const a = await addRow(meetings, 'Monday standup', { [date.id]: '2026-09-28', [type.id]: standup, [attendees.id]: 'Ana, Bo' });
  const b = await addRow(meetings, 'Sprint review', { [date.id]: '2026-09-29', [type.id]: review });
  const home = ((await call('POST', '/api/pages', { title: 'Cloudsmiths' }, 201)) as { id: string }).id;
  const standups = await createDatabase('Standups/Meetings', home);
  await addProp(standups, { name: 'Date', type: 'date' });
  await addProp(standups, { name: 'type', type: 'text' });
  return { meetings, standups, date, type, attendees, a, b, home };
}

describe('many rows at once', () => {
  it('sets the same values on many rows, and fires automations per row', async () => {
    const s = await seed();
    const count = await addProp(s.meetings, { name: 'Count', type: 'number' });
    await call('POST', `/api/databases/${s.meetings}/automations`, { trigger: { type: 'prop_changed', propId: s.attendees.id }, actions: [{ type: 'add_number', propId: count.id, amount: 1 }] }, 201);
    const res = (await call('PATCH', `/api/databases/${s.meetings}/rows/props`, { rowIds: [s.a, s.b, 'nope'], values: { [s.attendees.id]: 'Everyone' } }, 200)) as { rows: string[] };
    expect(res.rows).toEqual([s.a, s.b]);
    expect((await rows(s.meetings)).map((r) => [r.props[s.attendees.id], r.props[count.id]])).toEqual([
      ['Everyone', 1],
      ['Everyone', 1],
    ]);
    await call('PATCH', `/api/databases/${s.meetings}/rows/props`, { rowIds: [s.a], values: { [s.date.id]: 'soon' } }, 400);
  });

  it('trashes many rows', async () => {
    const s = await seed();
    await call('POST', `/api/databases/${s.meetings}/rows/delete`, { rowIds: [s.a, s.b] }, 200);
    expect(await rows(s.meetings)).toEqual([]);
  });
});

describe('moving and copying rows between databases', () => {
  it('previews how properties map by name', async () => {
    const s = await seed();
    const preview = (await call('GET', `/api/databases/${s.meetings}/transfer-preview?targetId=${s.standups}`, undefined, 200)) as {
      mapped: { from: { name: string }; to: { name: string }; convert: boolean }[];
      dropped: { name: string }[];
    };
    expect(preview.mapped.map((m) => [m.from.name, m.to.name, m.convert])).toEqual([
      ['Date', 'Date', false],
      ['Type', 'type', true],
    ]);
    expect(preview.dropped.map((d) => d.name)).toEqual(['Attendees']);
    const list = (await call('GET', '/api/databases?q=standups', undefined, 200)) as { title: string; path: string[] }[];
    expect(list[0]).toMatchObject({ title: 'Standups/Meetings', path: ['Cloudsmiths'] });
  });

  it('moves rows: values follow names, content stays, the rest is dropped', async () => {
    const s = await seed();
    await call('POST', `/api/pages/${s.a}/blocks/batch`, { upserts: [{ id: 'note1', type: 'paragraph', parentId: null, order: 'a0', content: [{ type: 'text', text: 'Notes' }], props: {} }], deletes: [] }, 200);
    const res = (await call('POST', `/api/databases/${s.meetings}/rows/transfer`, { rowIds: [s.a], targetId: s.standups, mode: 'move', today: TODAY }, 200)) as { rows: string[]; dropped: { name: string }[] };
    expect(res.rows).toEqual([s.a]);
    expect((await rows(s.meetings)).map((r) => r.title)).toEqual(['Sprint review']);
    const [moved] = await rows(s.standups);
    const date2 = await byName(s.standups, 'Date');
    const type2 = await byName(s.standups, 'type');
    expect(moved).toMatchObject({ id: s.a, title: 'Monday standup', props: { [date2.id]: '2026-09-28', [type2.id]: 'Standup' } });
    expect(Object.keys(moved!.props)).toHaveLength(2);
    expect(((await call('GET', `/api/pages/${s.a}/blocks`, undefined, 200)) as { id: string }[]).map((b) => b.id)).toEqual(['note1']);
    const page = (await call('GET', `/api/pages/${s.a}`, undefined, 200)) as { database: { id: string } };
    expect(page.database.id).toBe(s.standups);
  });

  it('can add the missing properties first, and creates select options by name', async () => {
    const s = await seed();
    // The target's Type is a select without "Review" yet.
    await call('PATCH', `/api/databases/${s.standups}/properties/${(await byName(s.standups, 'type')).id}`, { type: 'select' }, 200);
    await call('POST', `/api/databases/${s.meetings}/rows/transfer`, { rowIds: [s.a, s.b], targetId: s.standups, mode: 'move', addMissing: true, today: TODAY }, 200);
    const type2 = await byName(s.standups, 'type');
    const attendees2 = await byName(s.standups, 'Attendees');
    expect(type2.config.options!.map((o) => o.name).sort()).toEqual(['Review', 'Standup']);
    const moved = await rows(s.standups);
    expect(moved.map((r) => r.props[attendees2.id] ?? null)).toEqual(['Ana, Bo', null]);
    expect(moved.map((r) => type2.config.options!.find((o) => o.id === r.props[type2.id])?.name)).toEqual(['Standup', 'Review']);
  });

  it('copies rows: the source stays, the copy gets its content', async () => {
    const s = await seed();
    await call('POST', `/api/pages/${s.a}/blocks/batch`, { upserts: [{ id: 'note2', type: 'paragraph', parentId: null, order: 'a0', content: [{ type: 'text', text: 'Notes' }], props: {} }], deletes: [] }, 200);
    const res = (await call('POST', `/api/databases/${s.meetings}/rows/transfer`, { rowIds: [s.a], targetId: s.standups, mode: 'copy', today: TODAY }, 200)) as { rows: string[] };
    expect(res.rows[0]).not.toBe(s.a);
    expect((await rows(s.meetings)).map((r) => r.title)).toEqual(['Monday standup', 'Sprint review']);
    const copy = (await rows(s.standups))[0]!;
    expect(copy.title).toBe('Monday standup');
    const blocks = (await call('GET', `/api/pages/${copy.id}/blocks`, undefined, 200)) as { content: { text: string }[] }[];
    expect(blocks[0]!.content[0]!.text).toBe('Notes');
    // The source row's values are untouched.
    expect((await rows(s.meetings))[0]!.props[s.attendees.id]).toBe('Ana, Bo');
  });

  it('keeps relations that point the same way, drops links that belonged to the old database', async () => {
    const s = await seed();
    const people = await createDatabase('People');
    const ana = await addRow(people, 'Ana');
    const who = await addProp(s.meetings, { name: 'Who', type: 'relation', config: { databaseId: people, twoWay: false } });
    await addProp(s.standups, { name: 'Who', type: 'relation', config: { databaseId: people, twoWay: false } });
    // Tasks point at meetings; after the move that link can't stay.
    const tasks = await createDatabase('Tasks');
    const about = await addProp(tasks, { name: 'Meeting', type: 'relation', config: { databaseId: s.meetings } });
    const task = await addRow(tasks, 'Follow up', { [about.id]: [s.a] });
    await call('PATCH', `/api/pages/${s.a}/props`, { [who.id]: [ana] }, 200);

    await call('POST', `/api/databases/${s.meetings}/rows/transfer`, { rowIds: [s.a], targetId: s.standups, mode: 'move', today: TODAY }, 200);
    const who2 = await byName(s.standups, 'Who');
    expect((await rows(s.standups))[0]!.props[who2.id]).toEqual([ana]);
    expect((await rows(tasks)).find((r) => r.id === task)!.props[about.id]).toBeUndefined();
  });

  it('refuses the same database, and rows of another database', async () => {
    const s = await seed();
    await call('POST', `/api/databases/${s.meetings}/rows/transfer`, { rowIds: [s.a], targetId: s.meetings, mode: 'move', today: TODAY }, 400);
    const other = await createDatabase('Other');
    const x = await addRow(other, 'X');
    await call('POST', `/api/databases/${s.meetings}/rows/transfer`, { rowIds: [x], targetId: s.standups, mode: 'move', today: TODAY }, 400);
  });
});

describe('grouping rows', () => {
  it('groups by checkbox and by relation', async () => {
    const s = await seed();
    const done = await addProp(s.meetings, { name: 'Done', type: 'checkbox' });
    await call('PATCH', `/api/pages/${s.a}/props`, { [done.id]: true }, 200);
    const titles = async (group: object) => ((await call('POST', `/api/databases/${s.meetings}/query`, { group }, 200)) as { rows: Row[] }).rows.map((r) => r.title);
    expect(await titles({ propId: done.id, value: 'true' })).toEqual(['Monday standup']);
    expect(await titles({ propId: done.id, value: null })).toEqual(['Sprint review']);

    const people = await createDatabase('People');
    const ana = await addRow(people, 'Ana');
    const who = await addProp(s.meetings, { name: 'Who', type: 'relation', config: { databaseId: people } });
    await call('PATCH', `/api/pages/${s.b}/props`, { [who.id]: [ana] }, 200);
    expect(await titles({ propId: who.id, value: ana })).toEqual(['Sprint review']);
    expect(await titles({ propId: who.id, value: null })).toEqual(['Monday standup']);
  });
});
