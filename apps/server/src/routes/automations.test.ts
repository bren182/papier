import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { testApp } from '../testing.ts';
import { fromZoned, localDate, nextRun, tick } from '../db/automations.ts';
import { openDb } from '../db/index.ts';

// Automations: triggers (row added, property changed) and schedules, running actions.

let app: ReturnType<typeof buildApp>;

beforeEach(() => {
  app = testApp();
});
afterEach(async () => {
  await app.close();
});

type Prop = { id: string; name: string; type: string; config: Record<string, unknown> };
type Row = { id: string; title: string; props: Record<string, unknown> };
type Automation = { id: string; name: string; enabled: boolean; trigger: Record<string, unknown>; nextRunAt: number | null; lastRunAt: number | null; lastError: string | null };

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object, status?: number) {
  const res = await app.inject({ method, url, payload });
  if (status !== undefined) expect(res.statusCode, res.body).toBe(status);
  return res.statusCode === 204 ? null : res.json();
}

const createDatabase = async (title: string, parentId: string | null = null) =>
  ((await call('POST', '/api/pages', { title, parentId, kind: 'database' }, 201)) as { id: string }).id;
const addProp = async (db: string, body: object) => (await call('POST', `/api/databases/${db}/properties`, body, 201)) as Prop;
const addRow = async (db: string, title: string, values: object = {}) => ((await call('POST', `/api/databases/${db}/rows`, { title, props: values }, 201)) as Row).id;
const setProps = async (row: string, values: object) => (await call('PATCH', `/api/pages/${row}/props`, values, 200)) as Row;
const rows = async (db: string) => ((await call('POST', `/api/databases/${db}/query`, {}, 200)) as { rows: Row[] }).rows;
const props = async (db: string, title: string) => (await rows(db)).find((r) => r.title === title)!.props;
const automate = async (db: string, body: object, status = 201) => (await call('POST', `/api/databases/${db}/automations`, { tz: 'UTC', ...body }, status)) as Automation;
const list = async (db: string) => (await call('GET', `/api/databases/${db}/automations`, undefined, 200)) as Automation[];

/** Tasks: Done, Completed (date), Count, Status. */
async function seed() {
  const db = await createDatabase('Tasks');
  const done = await addProp(db, { name: 'Done', type: 'checkbox' });
  const completed = await addProp(db, { name: 'Completed', type: 'date' });
  const count = await addProp(db, { name: 'Count', type: 'number' });
  const status = await addProp(db, { name: 'Status', type: 'select', config: { options: [{ name: 'Todo' }, { name: 'Done' }] } });
  const [todo, doneOpt] = (status.config.options as { id: string }[]).map((o) => o.id);
  return { db, done, completed, count, status, todo: todo!, doneOpt: doneOpt! };
}

const today = () => new Date().toISOString().slice(0, 10);

describe('triggered automations', () => {
  it('when a property changes (to a value), run actions on that row', async () => {
    const s = await seed();
    await automate(s.db, {
      name: 'Stamp completion',
      trigger: { type: 'prop_changed', propId: s.done.id, when: { propId: s.done.id, op: 'is', value: true } },
      actions: [{ type: 'set_today', propId: s.completed.id }],
    });
    const row = await addRow(s.db, 'Write');
    await setProps(row, { [s.count.id]: 1 }); // another property: nothing
    expect((await props(s.db, 'Write'))[s.completed.id]).toBeUndefined();
    const after = await setProps(row, { [s.done.id]: true });
    expect(after.props[s.completed.id]).toBe(today());
    // Unticking doesn't match the condition.
    await setProps(row, { [s.completed.id]: null });
    await setProps(row, { [s.done.id]: null });
    expect((await props(s.db, 'Write'))[s.completed.id]).toBeUndefined();
  });

  it('fires on real changes only', async () => {
    const s = await seed();
    await automate(s.db, { trigger: { type: 'prop_changed', propId: s.status.id }, actions: [{ type: 'add_number', propId: s.count.id, amount: 1 }] });
    const row = await addRow(s.db, 'Write');
    await setProps(row, { [s.status.id]: s.todo });
    await setProps(row, { [s.status.id]: s.todo }); // same value again
    await setProps(row, { [s.status.id]: s.doneOpt });
    expect((await props(s.db, 'Write'))[s.count.id]).toBe(2);
  });

  it('when a row is added, including rows a button adds', async () => {
    const s = await seed();
    await automate(s.db, { trigger: { type: 'row_added' }, actions: [{ type: 'set', propId: s.status.id, value: s.todo }] });
    await addRow(s.db, 'Fresh');
    expect((await props(s.db, 'Fresh'))[s.status.id]).toBe(s.todo);

    const other = await createDatabase('Inbox');
    const btn = await addProp(other, { name: 'Go', type: 'button', config: { actions: [{ type: 'add_row', databaseId: s.db, title: 'From button', values: {} }] } });
    const src = await addRow(other, 'Src');
    await call('POST', `/api/pages/${src}/buttons/${btn.id}`, { today: today() }, 200);
    expect((await props(s.db, 'From button'))[s.status.id]).toBe(s.todo);
  });

  it('never cascade: an automation’s own changes fire no automations', async () => {
    const s = await seed();
    // Done → set Status; Status → bump Count. Only the first may run on a user tick.
    await automate(s.db, { trigger: { type: 'prop_changed', propId: s.done.id }, actions: [{ type: 'set', propId: s.status.id, value: s.doneOpt }] });
    await automate(s.db, { trigger: { type: 'prop_changed', propId: s.status.id }, actions: [{ type: 'add_number', propId: s.count.id, amount: 1 }] });
    const row = await addRow(s.db, 'Write');
    await setProps(row, { [s.done.id]: true });
    expect(await props(s.db, 'Write')).toMatchObject({ [s.status.id]: s.doneOpt });
    expect((await props(s.db, 'Write'))[s.count.id]).toBeUndefined();
  });

  it('a failing automation is noted and doesn’t block the edit', async () => {
    const s = await seed();
    const auto = await automate(s.db, { trigger: { type: 'prop_changed', propId: s.done.id }, actions: [{ type: 'add_number', propId: s.count.id, amount: 1 }] });
    await call('DELETE', `/api/databases/${s.db}/properties/${s.count.id}`, undefined, 204);
    const row = await addRow(s.db, 'Write');
    expect((await setProps(row, { [s.done.id]: true })).props[s.done.id]).toBe(true);
    const [after] = await list(s.db);
    expect(after).toMatchObject({ id: auto.id, lastError: expect.stringMatching(/no longer exists/) });
    expect(after!.lastRunAt).toEqual(expect.any(Number));
  });

  it('are off when disabled, and in templates', async () => {
    const s = await seed();
    const auto = await automate(s.db, { trigger: { type: 'prop_changed', propId: s.done.id }, actions: [{ type: 'add_number', propId: s.count.id, amount: 1 }] });
    await call('PATCH', `/api/databases/${s.db}/automations/${auto.id}`, { enabled: false }, 200);
    const row = await addRow(s.db, 'Write');
    await setProps(row, { [s.done.id]: true });
    expect((await props(s.db, 'Write'))[s.count.id]).toBeUndefined();

    await call('PATCH', `/api/databases/${s.db}/automations/${auto.id}`, { enabled: true }, 200);
    const template = ((await call('POST', `/api/databases/${s.db}/templates`, undefined, 201)) as { id: string }).id;
    await setProps(template, { [s.done.id]: true });
    const page = (await call('GET', `/api/pages/${template}`, undefined, 200)) as { props: Record<string, unknown> };
    expect(page.props[s.count.id]).toBeUndefined();
  });

  it('refuse unknown properties and time zones; can be listed, renamed and deleted', async () => {
    const s = await seed();
    await automate(s.db, { trigger: { type: 'prop_changed', propId: 'nope' } }, 400);
    await automate(s.db, { trigger: { type: 'row_added' }, tz: 'Mars/Olympus' }, 400);
    const a = await automate(s.db, { name: 'One', trigger: { type: 'row_added' } });
    await call('PATCH', `/api/databases/${s.db}/automations/${a.id}`, { name: 'Renamed' }, 200);
    expect((await list(s.db)).map((x) => x.name)).toEqual(['Renamed']);
    await call('DELETE', `/api/databases/${s.db}/automations/${a.id}`, undefined, 204);
    expect(await list(s.db)).toEqual([]);
  });

  it('come along when the database is copied, pointing at the copy', async () => {
    const s = await seed();
    await automate(s.db, { trigger: { type: 'prop_changed', propId: s.done.id }, actions: [{ type: 'set_today', propId: s.completed.id }] });
    const copy = ((await call('POST', `/api/pages/${s.db}/duplicate`, { today: today() }, 201)) as { id: string }).id;
    const copied = await list(copy);
    const schema = ((await call('GET', `/api/databases/${copy}`, undefined, 200)) as { properties: Prop[] }).properties;
    const done2 = schema.find((p) => p.name === 'Done')!;
    const completed2 = schema.find((p) => p.name === 'Completed')!;
    expect(copied[0]!.trigger).toMatchObject({ type: 'prop_changed', propId: done2.id });
    const row = await addRow(copy, 'Copy row');
    await setProps(row, { [done2.id]: true });
    expect((await props(copy, 'Copy row'))[completed2.id]).toBe(today());
  });
});

describe('scheduled automations', () => {
  it('know when they are next due, in their own time zone', () => {
    const daily = { type: 'schedule' as const, every: 'day' as const, at: '09:00', weekday: 1, monthday: 1, rows: 'matching' as const, filters: [] };
    // 2026-09-30 10:00 UTC is 12:00 in Amsterdam: today's 09:00 is gone, so tomorrow 07:00 UTC.
    const t = Date.UTC(2026, 8, 30, 10, 0);
    expect(new Date(nextRun(daily, 'Europe/Amsterdam', t)).toISOString()).toBe('2026-10-01T07:00:00.000Z');
    expect(new Date(nextRun(daily, 'UTC', Date.UTC(2026, 8, 30, 8, 0))).toISOString()).toBe('2026-09-30T09:00:00.000Z');
    // Weekly on Sunday; monthly on the 31st lands on the last day of shorter months.
    expect(new Date(nextRun({ ...daily, every: 'week', weekday: 0 }, 'UTC', t)).toISOString()).toBe('2026-10-04T09:00:00.000Z');
    expect(new Date(nextRun({ ...daily, every: 'month', monthday: 31 }, 'UTC', Date.UTC(2026, 10, 1))).toISOString()).toBe('2026-11-30T09:00:00.000Z');
    // Across the end of summer time (Amsterdam, 25 Oct 2026): 09:00 local is 08:00 UTC after it.
    expect(new Date(nextRun(daily, 'Europe/Amsterdam', Date.UTC(2026, 9, 25, 3))).toISOString()).toBe('2026-10-25T08:00:00.000Z');
    // A wall time in the skipped spring hour still resolves.
    expect(fromZoned(2027, 3, 28, 2, 30, 'Europe/Amsterdam')).toEqual(expect.any(Number));
    expect(localDate(Date.UTC(2026, 8, 30, 23, 30), 'Pacific/Auckland')).toBe('2026-10-01');
  });

  it('run for each matching row (filters can say today), and Run now does the same', async () => {
    const s = await seed();
    await addRow(s.db, 'Due', { [s.completed.id]: today() });
    await addRow(s.db, 'Later', { [s.completed.id]: '2999-01-01' });
    const auto = await automate(s.db, {
      trigger: { type: 'schedule', every: 'day', at: '09:00', rows: 'matching', filters: [{ propId: s.completed.id, op: 'is', value: '@today' }] },
      actions: [{ type: 'add_number', propId: s.count.id, amount: 1 }],
    });
    expect(auto.nextRunAt).toBeGreaterThan(Date.now());
    const res = (await call('POST', `/api/databases/${s.db}/automations/${auto.id}/run`, undefined, 200)) as { runs: number; failed: number };
    expect(res).toMatchObject({ runs: 1, failed: 0 });
    expect((await props(s.db, 'Due'))[s.count.id]).toBe(1);
    expect((await props(s.db, 'Later'))[s.count.id]).toBeUndefined();
  });

  it('the scheduler runs what is due, catches up once, and sets the next time', async () => {
    // The tick runs against the database directly: a file database both sides can open.
    await app.close();
    const dir = mkdtempSync(join(tmpdir(), 'papier-automations-'));
    const file = join(dir, 'test.db');
    app = testApp({ dbPath: file });
    const { db, sqlite } = openDb(file);
    try {
      const log = await createDatabase('Log');
      const auto = await automate(log, {
        trigger: { type: 'schedule', every: 'day', at: '09:00', rows: 'none' },
        actions: [{ type: 'add_row', databaseId: log, title: 'Daily', values: {} }],
      });
      // Nothing is due yet.
      expect(tick(db, Date.now())).toBe(0);
      // Three days later (the server was down): one catch-up run, then due again tomorrow.
      const later = auto.nextRunAt! + 3 * 86_400_000;
      expect(tick(db, later)).toBe(1);
      expect(tick(db, later)).toBe(0);
      expect((await rows(log)).map((r) => r.title)).toEqual(['Daily']);
      const [after] = await list(log);
      expect(after!.nextRunAt).toBeGreaterThan(later);
      expect(after!.nextRunAt! - later).toBeLessThanOrEqual(86_400_000);
      // A trashed database's schedule comes due but adds nothing.
      await call('DELETE', `/api/pages/${log}`, undefined, 204);
      expect(tick(db, after!.nextRunAt! + 1)).toBe(1);
      expect(sqlite.prepare("select count(*) as n from pages where title = 'Daily'").get()).toEqual({ n: 1 });
      sqlite.close();
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
      app = testApp();
    }
  });
});
