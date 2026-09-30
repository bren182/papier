/**
 * Actions: what buttons and automations do, stored as data (a JSON list) —
 * zod-free, so the client can import it (`@papier/core/actions`). The server
 * runs them (apps/server/src/db/actions.ts); the zod schema is in databases.js.
 *
 * Every action but `add_row` acts on "this row": the row a button is on, or the
 * row an automation runs for. Row-less runs (a button block in a page, a
 * schedule that doesn't go through rows) can only add rows.
 *
 * @typedef {'day' | 'week' | 'month' | 'year'} DateUnit
 * @typedef {{ type: 'set', propId: string, value: unknown }
 *   | { type: 'set_today', propId: string }
 *   | { type: 'shift_date', propId: string, amount: number, unit: DateUnit, from: 'value' | 'today' }
 *   | { type: 'check', propId: string, to: boolean | 'toggle' }
 *   | { type: 'add_number', propId: string, amount: number }
 *   | { type: 'link', propId: string, rowIds: string[], mode: 'add' | 'remove' }
 *   | { type: 'set_formula', propId: string, formula: string }
 *   | { type: 'add_row', databaseId: string, templateId?: string | null, title?: string, values: Record<string, unknown> }} Action
 */

export const ACTION_TYPES = /** @type {const} */ (['set', 'set_today', 'shift_date', 'check', 'add_number', 'link', 'set_formula', 'add_row']);

/** Most actions one button or automation runs. */
export const MAX_ACTIONS = 20;

/** In an `add_row` relation value: link the new row to the row the action runs for. */
export const THIS_ROW = '@this';

/** Actions that change the row they run for (everything but add_row). */
export const ROW_ACTIONS = new Set(['set', 'set_today', 'shift_date', 'check', 'add_number', 'link', 'set_formula']);

/**
 * Row actions that fit a property type (for menus, and checked on run).
 * @type {Record<string, readonly string[]>}
 */
export const ACTIONS_FOR = {
  text: ['set', 'set_formula'],
  url: ['set', 'set_formula'],
  number: ['set', 'add_number', 'set_formula'],
  select: ['set', 'set_formula'],
  multi_select: ['set'],
  date: ['set', 'set_today', 'shift_date', 'set_formula'],
  checkbox: ['check', 'set_formula'],
  relation: ['set', 'link'],
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A calendar date moved by `amount` units. Months and years clamp to the end of
 * the month (Jan 31 + 1 month = Feb 28/29; Feb 29 + 1 year = Feb 28).
 * @param {string} date YYYY-MM-DD
 * @param {number} amount may be negative
 * @param {DateUnit} unit
 */
export function shiftDate(date, amount, unit) {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Not a date: ${date}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  if (unit === 'day' || unit === 'week') {
    const t = new Date(Date.UTC(y, mo, d + amount * (unit === 'week' ? 7 : 1)));
    return t.toISOString().slice(0, 10);
  }
  const months = y * 12 + mo + amount * (unit === 'year' ? 12 : 1);
  const ny = Math.floor(months / 12);
  const nm = months - ny * 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ny, nm, Math.min(d, last))).toISOString().slice(0, 10);
}
