import { and, eq, sql } from 'drizzle-orm';
import { Actions, InvalidValue, Trigger } from '@papier/core';
import type { z } from 'zod';
import { runActions, type RunResult } from './actions.ts';
import { TooBig } from './duplicate.ts';
import type { Db } from './index.ts';
import type { Tx } from './props.ts';
import { matchingRows } from './query.ts';
import { automations } from './schema.ts';

/**
 * Automations: a trigger plus actions (run by db/actions.ts).
 *
 * - `row_added` / `prop_changed` fire inside the transaction of the user's own
 *   edit (new row, property values, a button). Each automation runs in its own
 *   savepoint: a failing one is rolled back and noted in `last_error`, and the
 *   edit still goes through.
 * - `schedule` runs from the scheduler (automations/scheduler.ts) when
 *   `next_run_at` is due.
 * - No cascades: what automations change never fires other automations, so
 *   loops can't happen (the engine's `source: 'automation'`; only user edits
 *   call the fire functions).
 * - Automations of trashed databases, and of databases in templates, never run.
 */

type TriggerDef = z.infer<typeof Trigger>;
type Row = typeof automations.$inferSelect;

/** Rows that fire at most per run of a schedule; the rest wait for the next run. */
export const MAX_SCHEDULE_ROWS = 500;

// ---------------------------------------------------------------------------
// Time zones. Days and hours are the automation's own (IANA `tz`), whatever the
// server's clock says.

const partsFormat = new Map<string, Intl.DateTimeFormat>();

/** Local calendar parts of an instant in a time zone. */
export function zoned(ms: number, tz: string) {
  let f = partsFormat.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormat.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), mi: Number(p.minute), s: Number(p.second) };
}

/** Whether `tz` is a time zone this server knows. */
export function isTimeZone(tz: string) {
  try {
    zoned(0, tz);
    return true;
  } catch {
    return false;
  }
}

/** Minutes the zone is ahead of UTC at an instant (Amsterdam in summer: 120). */
function offsetAt(ms: number, tz: string) {
  const z = zoned(ms, tz);
  return Math.round((Date.UTC(z.y, z.m - 1, z.d, z.h, z.mi, z.s) - Math.floor(ms / 1000) * 1000) / 60_000);
}

/** The instant a local wall-clock time happens in `tz` (a skipped DST hour moves forward). */
export function fromZoned(y: number, m: number, d: number, h: number, mi: number, tz: string) {
  const wall = Date.UTC(y, m - 1, d, h, mi);
  const first = wall - offsetAt(wall, tz) * 60_000;
  return wall - offsetAt(first, tz) * 60_000;
}

/** YYYY-MM-DD in `tz` at an instant. */
export function localDate(ms: number, tz: string) {
  const z = zoned(ms, tz);
  return `${z.y}-${String(z.m).padStart(2, '0')}-${String(z.d).padStart(2, '0')}`;
}

/** `Date#getTimezoneOffset()`-style minutes for the query builder (UTC minus local). */
export const tzOffsetOf = (ms: number, tz: string) => -offsetAt(ms, tz);

/** The next time a schedule is due, strictly after `after`. */
export function nextRun(trigger: Extract<TriggerDef, { type: 'schedule' }>, tz: string, after: number) {
  const [h, mi] = trigger.at.split(':').map(Number) as [number, number];
  const start = zoned(after, tz);
  for (let i = 0; i < 400; i++) {
    const day = new Date(Date.UTC(start.y, start.m - 1, start.d + i));
    const [y, m, d] = [day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()];
    if (trigger.every === 'week' && day.getUTCDay() !== trigger.weekday) continue;
    if (trigger.every === 'month') {
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      if (d !== Math.min(trigger.monthday, last)) continue;
    }
    const at = fromZoned(y, m, d, h, mi, tz);
    if (at > after) return at;
  }
  throw new Error('No next run within a year');
}

/** When a saved automation is next due: only enabled schedules have one. */
export function dueAt(row: { enabled: boolean; trigger: unknown; tz: string }, now: number) {
  const trigger = Trigger.parse(row.trigger);
  return row.enabled && trigger.type === 'schedule' ? nextRun(trigger, row.tz, now) : null;
}

// ---------------------------------------------------------------------------
// Running.

/** Whether automations of this database may run: live, and not in a template. */
export function databaseRuns(db: Db | Tx, databaseId: string) {
  const dead = db.get<{ n: number }>(sql`
    with recursive up(id, parent_id, archived_at, is_template) as (
      select id, parent_id, archived_at, is_template from pages where id = ${databaseId}
      union all
      select p.id, p.parent_id, p.archived_at, p.is_template from pages p join up on p.id = up.parent_id
    )
    select count(*) as n from up where archived_at is not null or is_template = 1
  `);
  return dead?.n === 0;
}

/**
 * Run one automation's actions (for a row, or row-less) in a savepoint, and
 * note how it went. Returns what it did, or null when it failed.
 */
function runOne(tx: Tx, auto: Row, rowId: string | null, now: number): RunResult | null {
  const today = localDate(now, auto.tz);
  try {
    const actions = Actions.parse(auto.actions);
    const result = tx.transaction((sp) => runActions(sp, { rowId, today, source: 'automation' }, actions));
    tx.update(automations).set({ lastRunAt: now, lastError: null }).where(eq(automations.id, auto.id)).run();
    return result;
  } catch (err) {
    // Bad data (a deleted property, an invalid value) is the automation's problem, not the edit's.
    if (!(err instanceof InvalidValue) && !(err instanceof TooBig) && !(err instanceof Error && err.name === 'ZodError')) throw err;
    tx.update(automations).set({ lastRunAt: now, lastError: err.message.slice(0, 500) }).where(eq(automations.id, auto.id)).run();
    return null;
  }
}

/** The database's enabled automations with a trigger of this type, in order. */
function withTrigger(tx: Tx, databaseId: string, type: TriggerDef['type']) {
  return tx
    .select()
    .from(automations)
    .where(and(eq(automations.databaseId, databaseId), eq(automations.enabled, true), sql`json_extract(${automations.trigger}, '$.type') = ${type}`))
    .orderBy(automations.orderKey)
    .all();
}

/** A user added a row: run the database's "row added" automations for it. */
export function fireRowAdded(tx: Tx, databaseId: string, rowId: string, now = Date.now()) {
  const autos = withTrigger(tx, databaseId, 'row_added');
  if (!autos.length || !databaseRuns(tx, databaseId)) return;
  for (const auto of autos) runOne(tx, auto, rowId, now);
}

/**
 * A user changed some of a row's values: run the automations watching those
 * properties (whose condition, if any, the row now meets).
 */
export function firePropsChanged(tx: Tx, databaseId: string, rowId: string, changed: Iterable<string>, now = Date.now()) {
  const props = new Set(changed);
  if (!props.size) return;
  const autos = withTrigger(tx, databaseId, 'prop_changed').filter((a) => props.has((a.trigger as { propId: string }).propId));
  if (!autos.length || !databaseRuns(tx, databaseId)) return;
  for (const auto of autos) {
    const trigger = Trigger.parse(auto.trigger);
    if (trigger.type !== 'prop_changed') continue;
    if (trigger.when && !matchingRows(tx, databaseId, [trigger.when], { rowId, tzOffset: tzOffsetOf(now, auto.tz) }).length) continue;
    runOne(tx, auto, rowId, now);
  }
}

/**
 * A button (or any user action run) changed rows and added some: fire the
 * automations that watch them. Rows a run added count as added by the user.
 */
export function fireAfterRun(tx: Tx, result: RunResult, databaseOf: (rowId: string) => string | null, now = Date.now()) {
  const byRow = new Map<string, Set<string>>();
  for (const c of result.changes) byRow.set(c.rowId, (byRow.get(c.rowId) ?? new Set()).add(c.propId));
  for (const [rowId, props] of byRow) {
    const databaseId = databaseOf(rowId);
    if (databaseId) firePropsChanged(tx, databaseId, rowId, props, now);
  }
  for (const c of result.created) fireRowAdded(tx, c.databaseId, c.id, now);
}

/**
 * Run a schedule now: for each row matching its filters, or once row-less.
 * Returns how many runs failed (the last error is on the automation).
 */
export function runSchedule(tx: Tx, auto: Row, now: number) {
  const trigger = Trigger.parse(auto.trigger);
  if (trigger.type !== 'schedule') throw new InvalidValue('Only schedules can be run by hand');
  if (!databaseRuns(tx, auto.databaseId)) return { runs: 0, failed: 0 };
  const rowIds =
    trigger.rows === 'none'
      ? [null]
      : matchingRows(tx, auto.databaseId, trigger.filters, { tzOffset: tzOffsetOf(now, auto.tz), limit: MAX_SCHEDULE_ROWS });
  let failed = 0;
  let lastError: string | null = null;
  for (const rowId of rowIds) {
    if (!runOne(tx, auto, rowId, now)) {
      failed++;
      lastError = tx.select({ e: automations.lastError }).from(automations).where(eq(automations.id, auto.id)).get()?.e ?? null;
    }
  }
  // One failing row shouldn't hide behind a later success.
  tx.update(automations).set({ lastRunAt: now, lastError }).where(eq(automations.id, auto.id)).run();
  return { runs: rowIds.length, failed };
}

/**
 * One scheduler tick: run every schedule that is due, then set its next time
 * from now — so after downtime a schedule catches up once, not once per missed slot.
 */
export function tick(db: Db, now = Date.now()) {
  const due = db
    .select()
    .from(automations)
    .where(and(eq(automations.enabled, true), sql`${automations.nextRunAt} <= ${now}`))
    .all();
  for (const auto of due) {
    db.transaction((tx) => {
      runSchedule(tx, auto, now);
      tx.update(automations).set({ nextRunAt: dueAt(auto, now) }).where(eq(automations.id, auto.id)).run();
    });
  }
  return due.length;
}
