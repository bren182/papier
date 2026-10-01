import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { testApp } from '../testing.ts';
import { localToday } from '../db/query.ts';

// Formula properties: parsed and checked in core, compiled to SQL here.

let app: ReturnType<typeof buildApp>;

beforeEach(() => {
  app = testApp();
});
afterEach(async () => {
  await app.close();
});

type Prop = { id: string; name: string; type: string; config: Record<string, unknown> & { options?: { id: string; name: string }[] } };
type Row = { id: string; title: string; props: Record<string, unknown> };

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object, status?: number) {
  const res = await app.inject({ method, url, payload });
  if (status !== undefined) expect(res.statusCode, res.body).toBe(status);
  return res.statusCode === 204 ? null : res.json();
}

const createDatabase = async (title: string) => ((await call('POST', '/api/pages', { title, kind: 'database' }, 201)) as { id: string }).id;
const addProp = async (db: string, body: object) => (await call('POST', `/api/databases/${db}/properties`, body, 201)) as Prop;
const addRow = async (db: string, title: string, values: object = {}) => ((await call('POST', `/api/databases/${db}/rows`, { title, props: values }, 201)) as Row).id;
const query = async (db: string, body: object = {}) => ((await call('POST', `/api/databases/${db}/query`, body, 200)) as { rows: Row[] }).rows;
const schema = async (db: string) => ((await call('GET', `/api/databases/${db}`, undefined, 200)) as { properties: Prop[] }).properties;
const formula = (db: string, name: string, expression: string) => addProp(db, { name, type: 'formula', config: { expression } });

const today = localToday(0);

/** People: a birthdate, points, a done box, a status select. */
async function seed() {
  const db = await createDatabase('People');
  const born = await addProp(db, { name: 'Birthdate', type: 'date' });
  const points = await addProp(db, { name: 'Points', type: 'number' });
  const done = await addProp(db, { name: 'Done', type: 'checkbox' });
  const status = await addProp(db, { name: 'Status', type: 'select', config: { options: [{ name: 'Todo' }, { name: 'Done' }] } });
  const note = await addProp(db, { name: 'Note', type: 'text' });
  const [todo, doneOpt] = status.config.options!.map((o) => o.id);
  const ana = await addRow(db, 'Ana', { [born.id]: '1990-01-31', [points.id]: 7, [done.id]: true, [status.id]: doneOpt, [note.id]: 'Loves Tea' });
  const bo = await addRow(db, 'Bo', { [born.id]: '2000-12-25', [points.id]: 2, [status.id]: todo });
  return { db, born, points, done, status, note, ana, bo };
}

/** The value of a formula on each row, by title. */
async function values(db: string, prop: Prop) {
  return Object.fromEntries((await query(db)).map((r) => [r.title, r.props[prop.id] ?? null]));
}

describe('formula properties', () => {
  it('compute numbers, text, booleans and dates', async () => {
    const s = await seed();
    const cases: [string, Record<string, unknown>][] = [
      ['prop("Points") * 2 + 1', { Ana: 15, Bo: 5 }],
      ['prop("Points") / 2', { Ana: 3.5, Bo: 1 }],
      ['round(prop("Points") / 3, 2)', { Ana: 2.33, Bo: 0.67 }],
      ['floor(-prop("Points") / 2)', { Ana: -4, Bo: -1 }],
      ['if(prop("Done"), "✓", "…")', { Ana: '✓', Bo: '…' }],
      ['prop("Status") == "Done"', { Ana: true, Bo: false }],
      ['concat(prop("Name"), " has ", prop("Points"), " points")', { Ana: 'Ana has 7 points', Bo: 'Bo has 2 points' }],
      ['prop("Name") + "!"', { Ana: 'Ana!', Bo: 'Bo!' }],
      ['contains(prop("Note"), "tea")', { Ana: true, Bo: false }],
      ['upper(prop("Name"))', { Ana: 'ANA', Bo: 'BO' }],
      ['empty(prop("Note"))', { Ana: false, Bo: true }],
      ['dateAdd(prop("Birthdate"), 1, "month")', { Ana: '1990-02-28', Bo: '2001-01-25' }],
      ['dateSubtract(prop("Birthdate"), 2, "weeks")', { Ana: '1990-01-17', Bo: '2000-12-11' }],
      ['dateBetween("2026-09-30", prop("Birthdate"), "years")', { Ana: 36, Bo: 25 }],
      ['dateBetween("2026-02-01", "2026-01-31", "days")', { Ana: 1, Bo: 1 }],
      ['year(prop("Birthdate")) + month(prop("Birthdate"))', { Ana: 1991, Bo: 2012 }],
      ['weekday("2026-09-28")', { Ana: 1, Bo: 1 }],
      ['formatDate(prop("Birthdate"), "D MMM YYYY (ddd)")', { Ana: '31 Jan 1990 (Wed)', Bo: '25 Dec 2000 (Mon)' }],
      ['today()', { Ana: today, Bo: today }],
      ['prop("Points") / 0', { Ana: null, Bo: null }],
    ];
    for (const [expression, want] of cases) {
      const p = await formula(s.db, expression.slice(0, 40), expression);
      expect(p.config.resultType, expression).toBeTruthy();
      expect(await values(s.db, p), expression).toEqual(want);
    }
  });

  it('nextAnniversary is on or after today', async () => {
    const s = await seed();
    const next = await formula(s.db, 'Next', 'nextAnniversary(prop("Birthdate"))');
    const days = await formula(s.db, 'In', 'dateBetween(nextAnniversary(prop("Birthdate")), today(), "days")');
    for (const r of await query(s.db)) {
      const v = r.props[next.id] as string;
      expect(v >= today).toBe(true);
      expect(v.slice(5)).toBe(r.title === 'Ana' ? '01-31' : '12-25');
      expect(r.props[days.id]).toBeGreaterThanOrEqual(0);
      expect(r.props[days.id]).toBeLessThan(366);
    }
  });

  it('sort and filter by what they compute', async () => {
    const s = await seed();
    const doubled = await formula(s.db, 'Doubled', 'prop("Points") * 2');
    const label = await formula(s.db, 'Label', 'if(prop("Done"), "done", "open")');
    const titles = async (body: object) => (await query(s.db, body)).map((r) => r.title);
    expect(await titles({ sorts: [{ propId: doubled.id, dir: 'asc' }] })).toEqual(['Bo', 'Ana']);
    expect(await titles({ filters: [{ propId: doubled.id, op: '>', value: 10 }] })).toEqual(['Ana']);
    expect(await titles({ filters: [{ propId: label.id, op: 'is', value: 'Open' }] })).toEqual(['Bo']);
    const flag = await formula(s.db, 'Flag', 'prop("Points") > 5');
    expect(flag.config.resultType).toBe('boolean');
    expect(await titles({ filters: [{ propId: flag.id, op: 'is', value: true }] })).toEqual(['Ana']);
  });

  it('can use other formulas, rollups and relations; cycles are refused', async () => {
    const s = await seed();
    const a = await formula(s.db, 'A', 'prop("Points") + 1');
    const b = await formula(s.db, 'B', 'prop("A") * 10');
    expect(await values(s.db, b)).toEqual({ Ana: 80, Bo: 30 });

    // A → B → A: both become invalid (no value, resultType null).
    await call('PATCH', `/api/databases/${s.db}/properties/${a.id}`, { config: { expression: 'prop("B") + 1' } }, 200);
    const props = await schema(s.db);
    expect(props.find((p) => p.id === a.id)!.config.resultType).toBe(null);
    expect(await values(s.db, b)).toEqual({ Ana: null, Bo: null });

    const teams = await createDatabase('Teams');
    const red = await addRow(teams, 'Red');
    const rel = await addProp(s.db, { name: 'Team', type: 'relation', config: { databaseId: teams, twoWay: true } });
    await call('PATCH', `/api/pages/${s.ana}/props`, { [rel.id]: [red] }, 200);
    const teamName = await formula(s.db, 'Team name', 'prop("Team")');
    expect(await values(s.db, teamName)).toEqual({ Ana: 'Red', Bo: null });
    const members = (await schema(teams)).find((p) => p.type === 'relation')!;
    await addProp(teams, { name: 'Count', type: 'rollup', config: { relationId: members.id, targetPropId: 'title', fn: 'count' } });
    const big = await formula(teams, 'Big', 'prop("Count") >= 1');
    expect(await values(teams, big)).toEqual({ Red: true });
  });

  it('follow renames, and report problems by resultType', async () => {
    const s = await seed();
    const f = await formula(s.db, 'Double', 'prop("Points") * 2');
    await call('PATCH', `/api/databases/${s.db}/properties/${s.points.id}`, { name: 'Score' }, 200);
    const after = (await schema(s.db)).find((p) => p.id === f.id)!;
    expect(after.config).toMatchObject({ expression: 'prop("Score") * 2', resultType: 'number' });
    expect((await values(s.db, f)).Ana).toBe(14);

    await call('DELETE', `/api/databases/${s.db}/properties/${s.points.id}`, undefined, 204);
    expect((await schema(s.db)).find((p) => p.id === f.id)!.config.resultType).toBe(null);
    const bad = await formula(s.db, 'Bad', 'prop("Nope" +');
    expect(bad.config.resultType).toBe(null);
  });

  it('keep text as literals: nothing a formula says becomes SQL', async () => {
    const s = await seed();
    const f = await formula(s.db, 'Evil', `"x'); drop table pages; --" + prop("Name")`);
    expect((await values(s.db, f)).Ana).toBe(`x'); drop table pages; --Ana`);
    expect((await query(s.db)).length).toBe(2);
  });

  it('set a property to a formula from a button or an automation', async () => {
    const s = await seed();
    const reminder = await addProp(s.db, { name: 'Reminder', type: 'date' });
    const btn = await addProp(s.db, { name: 'Next', type: 'button', config: { actions: [{ type: 'set_formula', propId: reminder.id, formula: 'nextAnniversary(prop("Birthdate"))' }] } });
    const run = (await call('POST', `/api/pages/${s.ana}/buttons/${btn.id}`, { today }, 200)) as { row: Row };
    expect((run.row.props[reminder.id] as string).slice(5)).toBe('01-31');

    // An automation: when Points change, Note = "score: N".
    await call('POST', `/api/databases/${s.db}/automations`, { tz: 'UTC', trigger: { type: 'prop_changed', propId: s.points.id }, actions: [{ type: 'set_formula', propId: s.note.id, formula: '"score: " + prop("Points")' }] }, 201);
    await call('PATCH', `/api/pages/${s.bo}/props`, { [s.points.id]: 9 }, 200);
    expect((await values(s.db, s.note)).Bo).toBe('score: 9');

    // A formula whose result doesn't fit is an error, and nothing changes.
    const broken = await addProp(s.db, { name: 'Broken', type: 'button', config: { actions: [{ type: 'set_formula', propId: s.status.id, formula: '"Unknown"' }] } });
    const res = await app.inject({ method: 'POST', url: `/api/pages/${s.ana}/buttons/${broken.id}`, payload: { today } });
    expect(res.statusCode).toBe(400);
  });
});
