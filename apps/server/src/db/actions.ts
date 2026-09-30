import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  ACTIONS_FOR,
  DYNAMIC_TODAY,
  FormulaError,
  InvalidValue,
  ROW_ACTIONS,
  textToValue,
  shiftDate,
  THIS_ROW,
  Action as ActionSchema,
  type PropertyDef,
  type PropValue,
  valueToText,
} from '@papier/core';
import type { z } from 'zod';
import type { Db } from './index.ts';

type Action = z.infer<typeof ActionSchema>;
import { compileFormula, formulaValue } from './formula.ts';
import { liveLineage } from './lineage.ts';
import { properties, type Tx } from './props.ts';
import { Relations, rowValues } from './relations.ts';
import { createRow, writeValues } from './rows.ts';
import { pages } from './schema.ts';

/**
 * The actions engine: runs a list of actions (see @papier/core actions.js) for
 * a row, or row-less. Buttons, triggered and scheduled automations all come
 * through here. It runs inside the caller's transaction and throws
 * `InvalidValue` on the first action that can't run, so a run is all or nothing.
 */

export type RunContext = {
  /** The row the actions act on; null for a row-less run (a page button, a schedule without rows). */
  rowId: string | null;
  /** The viewer's (or the automation's) local date, for "today". */
  today: string;
  /** Who started it: automations' own changes don't start other automations. */
  source: 'user' | 'automation';
};

/** One property a run changed; `name`/`text` let the client say so without the schema. */
export type Change = { rowId: string; propId: string; name: string; type: string; value: unknown; text: string };

export type RunResult = {
  /** Values as they were before the run, per row (only the properties it changed). */
  before: Map<string, Record<string, unknown>>;
  /** Final values the run wrote, in order. */
  changes: Change[];
  /** Rows it added (id, database). */
  created: { id: string; databaseId: string }[];
};

/** The database a live row belongs to, or null. */
export function rowDatabaseId(db: Db | Tx, rowId: string): string | null {
  const row = db.get<{ id: string }>(sql`
    select d.id from pages p join pages d on d.id = p.parent_id and d.kind = 'database'
    where p.id = ${rowId} and p.archived_at is null and d.archived_at is null
  `);
  return row?.id ?? null;
}

export function runActions(tx: Tx, ctx: RunContext, actions: Action[]): RunResult {
  const result: RunResult = { before: new Map(), changes: [], created: [] };
  if (!actions.length) return result;

  const databaseId = ctx.rowId ? rowDatabaseId(tx, ctx.rowId) : null;
  if (ctx.rowId && !databaseId) throw new InvalidValue('That row is gone');
  const props = new Map<string, PropertyDef>(databaseId ? properties(tx, databaseId).map((p) => [p.id, p]) : []);

  for (const action of actions) {
    if (action.type === 'add_row') {
      result.created.push(addRow(tx, ctx, action));
      continue;
    }
    if (!ctx.rowId || !ROW_ACTIONS.has(action.type)) throw new InvalidValue('This button isn’t on a database row, so it can only add rows');
    const rowId = ctx.rowId;
    const prop = props.get(action.propId);
    if (!prop) throw new InvalidValue('An action refers to a property that no longer exists');
    if (!ACTIONS_FOR[prop.type]?.includes(action.type)) throw new InvalidValue(`“${prop.name}” can’t be changed that way any more`);

    const current = rowValues(tx, rowId).props[prop.id] ?? null;
    const before = result.before.get(rowId) ?? {};
    if (!(prop.id in before)) before[prop.id] = current;
    result.before.set(rowId, before);

    const next =
      action.type === 'set_formula' ? formulaResult(tx, [...props.values()], prop, action.formula, rowId, ctx) : nextValue(action, prop, current, ctx);
    writeValues(tx, rowId, [{ ...prop, order: '' }], { [prop.id]: next });
    const written = rowValues(tx, rowId).props[prop.id] ?? null;
    result.changes.push({ rowId, propId: prop.id, name: prop.name, type: prop.type, value: written, text: valueToText(prop, written as PropValue) });
  }

  if (ctx.rowId && result.changes.length) tx.update(pages).set({ updatedAt: Date.now() }).where(eq(pages.id, ctx.rowId)).run();
  return result;
}

/** What a row action sets its property to, given the current value. */
/**
 * "Set to a formula": the formula's value for this row, fitted to the
 * property (a date for a date, a number for a number, text matched to a
 * select option by name…). Throws InvalidValue when it can't be.
 */
function formulaResult(tx: Tx, props: PropertyDef[], prop: PropertyDef, src: string, rowId: string, ctx: RunContext): unknown {
  let f;
  try {
    f = compileFormula(src, { props, rel: new Relations(tx), tzOffset: tzOffsetOfDay(ctx.today), rowId: sql`${rowId}` });
  } catch (err) {
    if (err instanceof FormulaError) throw new InvalidValue(`The formula for “${prop.name}” has a problem: ${err.message}`);
    throw err;
  }
  const value = formulaValue(f.type, tx.get<{ v: unknown }>(sql`select ${f.sql} as v`)?.v);
  if (value === null) return null;
  if (prop.type === 'checkbox') return f.type === 'boolean' ? value : Boolean(value);
  if (prop.type === 'number') return f.type === 'number' ? value : Number.isFinite(Number(value)) ? Number(value) : null;
  if (prop.type === 'date' && f.type === 'date') return value;
  const text = textToValue(prop, String(value));
  if (text === null && String(value).trim()) throw new InvalidValue(`“${String(value)}” doesn't fit “${prop.name}”`);
  return text;
}

/**
 * The tz offset that makes today() be `today`: formulas run with the viewer's
 * day (buttons send it), not the server clock's.
 */
function tzOffsetOfDay(today: string) {
  return Math.round((Date.now() - Date.parse(`${today}T12:00:00Z`)) / 60_000);
}

function nextValue(action: Exclude<Action, { type: 'add_row' | 'set_formula' }>, prop: PropertyDef, current: unknown, ctx: RunContext): unknown {
  switch (action.type) {
    case 'set':
      return prop.type === 'date' && action.value === DYNAMIC_TODAY ? ctx.today : action.value;
    case 'set_today':
      return ctx.today;
    case 'shift_date': {
      // An empty date shifts from today.
      const from = action.from === 'today' || typeof current !== 'string' ? ctx.today : current;
      return shiftDate(from, action.amount, action.unit);
    }
    case 'check':
      return action.to === 'toggle' ? current !== true : action.to;
    case 'add_number':
      return (typeof current === 'number' ? current : 0) + action.amount;
    case 'link': {
      const ids = Array.isArray(current) ? (current as string[]) : [];
      if (action.mode === 'remove') return ids.filter((id) => !action.rowIds.includes(id));
      return [...ids, ...action.rowIds.filter((id) => !ids.includes(id))];
    }
  }
}

/** A new row in another (or the same) database; "today" and "this row" resolved. */
function addRow(tx: Tx, ctx: RunContext, action: Extract<Action, { type: 'add_row' }>) {
  const target = tx.select({ kind: pages.kind }).from(pages).where(and(eq(pages.id, action.databaseId), isNull(pages.archivedAt))).get();
  if (target?.kind !== 'database' || !liveLineage(tx as unknown as Db, action.databaseId)) throw new InvalidValue('An action adds rows to a database that no longer exists');
  const targetProps = new Map(properties(tx, action.databaseId).map((p) => [p.id, p]));
  const values: Record<string, unknown> = {};
  for (const [propId, raw] of Object.entries(action.values)) {
    const prop = targetProps.get(propId);
    if (!prop) continue; // a property deleted since: skip it rather than fail the whole button
    if (prop.type === 'date' && raw === DYNAMIC_TODAY) values[propId] = ctx.today;
    else if (prop.type === 'relation' && Array.isArray(raw) && raw.includes(THIS_ROW)) {
      if (!ctx.rowId) throw new InvalidValue('“This row” only works for a button on a database row');
      values[propId] = raw.map((id: unknown) => (id === THIS_ROW ? ctx.rowId : id));
    } else values[propId] = raw;
  }
  const id = createRow(tx, action.databaseId, { title: action.title ?? '', props: values, templateId: action.templateId ?? undefined }, ctx.today);
  return { id, databaseId: action.databaseId };
}

/**
 * Put back what a run did: the values it changed (only on rows still live) and
 * trash the rows it added. Fires no automations.
 */
export function undoRun(tx: Tx, input: { rows: { id: string; props: Record<string, unknown> }[]; created: string[] }) {
  for (const row of input.rows) {
    const databaseId = rowDatabaseId(tx, row.id);
    if (!databaseId) continue;
    writeValues(tx, row.id, properties(tx, databaseId), row.props);
    tx.update(pages).set({ updatedAt: Date.now() }).where(eq(pages.id, row.id)).run();
  }
  for (const id of input.created) {
    if (rowDatabaseId(tx, id)) tx.update(pages).set({ archivedAt: Date.now() }).where(eq(pages.id, id)).run();
  }
}
