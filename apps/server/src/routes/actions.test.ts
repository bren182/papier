import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';

// Buttons: actions stored as data, run on a row (button property) or row-less (button block).

let app: ReturnType<typeof buildApp>;

beforeEach(() => {
  app = buildApp({ logger: false });
});
afterEach(async () => {
  await app.close();
});

type Prop = { id: string; name: string; type: string; config: Record<string, unknown> };
type Row = { id: string; title: string; props: Record<string, unknown> };
type Run = { row?: Row; changes: { rowId: string; propId: string; value: unknown }[]; created: { id: string; databaseId: string }[]; undo: { rows: { id: string; props: Record<string, unknown> }[]; created: string[] } };

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
const props = async (db: string, title: string) => (await rows(db)).find((r) => r.title === title)!.props;
const press = async (row: string, button: string, status = 200) => (await call('POST', `/api/pages/${row}/buttons/${button}`, { today: TODAY }, status)) as Run;
const button = (db: string, actions: object[], name = 'Go') => addProp(db, { name, type: 'button', config: { label: name, actions } });

/** Birthdays: a person with a birthdate, a reminder, a count and a done box. */
async function seed() {
  const db = await createDatabase('Birthdays');
  const reminder = await addProp(db, { name: 'Reminder', type: 'date' });
  const count = await addProp(db, { name: 'Celebrated', type: 'number' });
  const done = await addProp(db, { name: 'Sent card', type: 'checkbox' });
  const note = await addProp(db, { name: 'Note', type: 'text' });
  const ana = await addRow(db, 'Ana', { [reminder.id]: '2026-02-28' });
  return { db, reminder, count, done, note, ana };
}

describe('button property', () => {
  it('runs every row action on its row', async () => {
    const s = await seed();
    const celebrate = await button(s.db, [
      { type: 'shift_date', propId: s.reminder.id, amount: 1, unit: 'year' },
      { type: 'add_number', propId: s.count.id, amount: 1 },
      { type: 'check', propId: s.done.id, to: 'toggle' },
      { type: 'set', propId: s.note.id, value: 'Happy birthday!' },
    ]);
    const run = await press(s.ana, celebrate.id);
    expect(run.row!.props).toMatchObject({ [s.reminder.id]: '2027-02-28', [s.count.id]: 1, [s.done.id]: true, [s.note.id]: 'Happy birthday!' });
    expect(run.changes.map((c) => c.propId)).toEqual([s.reminder.id, s.count.id, s.done.id, s.note.id]);
    await press(s.ana, celebrate.id);
    expect(await props(s.db, 'Ana')).toMatchObject({ [s.reminder.id]: '2028-02-28', [s.count.id]: 2 });
    expect((await props(s.db, 'Ana'))[s.done.id]).toBeUndefined(); // toggled back off
  });

  it('sets today, shifts from today, and shifts an empty date from today', async () => {
    const s = await seed();
    const b = await addRow(s.db, 'Bo');
    const today = await button(s.db, [{ type: 'set_today', propId: s.reminder.id }], 'Today');
    const nextWeek = await button(s.db, [{ type: 'shift_date', propId: s.reminder.id, amount: 1, unit: 'week', from: 'today' }], 'Week');
    expect((await press(s.ana, today.id)).row!.props[s.reminder.id]).toBe(TODAY);
    expect((await press(s.ana, nextWeek.id)).row!.props[s.reminder.id]).toBe('2026-10-07');
    const shift = await button(s.db, [{ type: 'shift_date', propId: s.reminder.id, amount: -1, unit: 'month' }], 'Back');
    expect((await press(b, shift.id)).row!.props[s.reminder.id]).toBe('2026-08-30');
  });

  it('links and unlinks relation rows', async () => {
    const s = await seed();
    const people = await createDatabase('Groups');
    const family = await addRow(people, 'Family');
    const friends = await addRow(people, 'Friends');
    const rel = await addProp(s.db, { name: 'Group', type: 'relation', config: { databaseId: people } });
    const add = await button(s.db, [{ type: 'link', propId: rel.id, rowIds: [family, friends], mode: 'add' }], 'Add');
    const remove = await button(s.db, [{ type: 'link', propId: rel.id, rowIds: [family], mode: 'remove' }], 'Remove');
    expect((await press(s.ana, add.id)).row!.props[rel.id]).toEqual([family, friends]);
    expect((await press(s.ana, remove.id)).row!.props[rel.id]).toEqual([friends]);
  });

  it('is all or nothing: a bad action rolls the whole run back', async () => {
    const s = await seed();
    const bad = await button(s.db, [
      { type: 'add_number', propId: s.count.id, amount: 1 },
      { type: 'shift_date', propId: s.note.id, amount: 1, unit: 'day' }, // text can't shift
    ]);
    await press(s.ana, bad.id, 400);
    expect((await props(s.db, 'Ana'))[s.count.id]).toBeUndefined();
    await call('DELETE', `/api/databases/${s.db}/properties/${s.count.id}`, undefined, 204);
    const res = await app.inject({ method: 'POST', url: `/api/pages/${s.ana}/buttons/${bad.id}`, payload: { today: TODAY } });
    expect(res.json().error).toMatch(/no longer exists/);
  });

  it('adds rows to another database, from a template, with today and this row', async () => {
    const s = await seed();
    const log = await createDatabase('Card log');
    const when = await addProp(log, { name: 'When', type: 'date' });
    const who = await addProp(log, { name: 'Who', type: 'relation', config: { databaseId: s.db } });
    const template = ((await call('POST', `/api/databases/${log}/templates`, undefined, 201)) as { id: string }).id;
    await call('PATCH', `/api/pages/${template}`, { title: 'Card' }, 200);
    const b = await button(s.db, [{ type: 'add_row', databaseId: log, templateId: template, values: { [when.id]: '@today', [who.id]: ['@this'] } }]);
    const run = await press(s.ana, b.id);
    expect(run.created).toEqual([{ id: expect.any(String), databaseId: log }]);
    const [row] = await rows(log);
    expect(row).toMatchObject({ title: 'Card', props: { [when.id]: TODAY, [who.id]: [s.ana] } });
  });

  it('undo puts values back and trashes the rows it added', async () => {
    const s = await seed();
    const log = await createDatabase('Log');
    const b = await button(s.db, [
      { type: 'shift_date', propId: s.reminder.id, amount: 1, unit: 'year' },
      { type: 'add_number', propId: s.count.id, amount: 5 },
      { type: 'add_row', databaseId: log, title: 'Logged', values: {} },
    ]);
    const run = await press(s.ana, b.id);
    expect(run.undo.rows).toEqual([{ id: s.ana, props: { [s.reminder.id]: '2026-02-28', [s.count.id]: null } }]);
    await call('POST', '/api/actions/undo', run.undo, 204);
    expect(await props(s.db, 'Ana')).toEqual({ [s.reminder.id]: '2026-02-28' });
    expect(await rows(log)).toEqual([]);
  });

  it('has no value of its own; turning a text column into a button keeps nothing', async () => {
    const s = await seed();
    await call('PATCH', `/api/pages/${s.ana}/props`, { [s.note.id]: 'x' }, 200);
    await call('PATCH', `/api/databases/${s.db}/properties/${s.note.id}`, { type: 'button' }, 200);
    expect((await props(s.db, 'Ana'))[s.note.id]).toBeUndefined();
    await call('PATCH', `/api/pages/${s.ana}/props`, { [s.note.id]: 'x' }, 400);
  });
});

describe('button block', () => {
  async function pageWithButton(actions: object[]) {
    const page = ((await call('POST', '/api/pages', { title: 'Home' }, 201)) as { id: string }).id;
    await call('POST', `/api/pages/${page}/blocks/batch`, {
      upserts: [{ id: 'btn1', type: 'button', parentId: null, order: 'a0', content: [], props: { label: 'Log', actions } }],
      deletes: [],
    }, 200);
    return page;
  }

  it('runs row-less: it adds rows', async () => {
    const log = await createDatabase('Workouts');
    const when = await addProp(log, { name: 'When', type: 'date' });
    await pageWithButton([{ type: 'add_row', databaseId: log, title: 'Run', values: { [when.id]: '@today' } }]);
    const run = (await call('POST', '/api/blocks/btn1/run', { today: TODAY }, 200)) as Run;
    expect(run.created).toHaveLength(1);
    expect(await rows(log)).toMatchObject([{ title: 'Run', props: { [when.id]: TODAY } }]);
  });

  it('refuses row actions and "this row"', async () => {
    const s = await seed();
    await pageWithButton([{ type: 'add_number', propId: s.count.id, amount: 1 }]);
    const res = await app.inject({ method: 'POST', url: '/api/blocks/btn1/run', payload: { today: TODAY } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/can only add rows/);
    await call('POST', '/api/blocks/nope/run', { today: TODAY }, 404);
  });
});

describe('copying buttons', () => {
  it('a page with a database and a button block: the copy adds to the copied database', async () => {
    const home = ((await call('POST', '/api/pages', { title: 'Home' }, 201)) as { id: string }).id;
    const log = await createDatabase('Log', home);
    const when = await addProp(log, { name: 'When', type: 'date' });
    const inc = await addProp(log, { name: 'N', type: 'number' });
    const b = await button(log, [{ type: 'add_number', propId: inc.id, amount: 1 }], 'Bump');
    const blocks = (await call('GET', `/api/pages/${home}/blocks`, undefined, 200)) as { id: string; type: string; order: string; props: object }[];
    await call('POST', `/api/pages/${home}/blocks/batch`, {
      upserts: [{ id: 'btn2', type: 'button', parentId: null, order: 'b9', content: [], props: { label: 'Log', actions: [{ type: 'add_row', databaseId: log, values: { [when.id]: '@today' } }] } }],
      deletes: [],
    }, 200);
    expect(blocks.length).toBeGreaterThan(0);

    const copy = ((await call('POST', `/api/pages/${home}/duplicate`, { today: TODAY }, 201)) as { id: string }).id;
    const log2 = ((await call('GET', `/api/pages?parent=${copy}`, undefined, 200)) as { id: string; title: string }[]).find((p) => p.title === 'Log')!.id;
    const btn = ((await call('GET', `/api/pages/${copy}/blocks`, undefined, 200)) as { id: string; type: string; props: { actions: { databaseId: string; values: Record<string, string> }[] } }[]).find((x) => x.type === 'button')!;
    const [schema2] = [((await call('GET', `/api/databases/${log2}`, undefined, 200)) as { properties: Prop[] }).properties];
    const when2 = schema2.find((p) => p.name === 'When')!;
    const inc2 = schema2.find((p) => p.name === 'N')!;
    expect(btn.props.actions[0]).toMatchObject({ databaseId: log2, values: { [when2.id]: '@today' } });
    expect(schema2.find((p) => p.name === 'Bump')!.config.actions).toEqual([{ type: 'add_number', propId: inc2.id, amount: 1 }]);
    expect(b.id).toBeTruthy();
  });
});
