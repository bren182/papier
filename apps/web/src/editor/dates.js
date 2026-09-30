/**
 * Date mentions (`@today`, `@2 days ago`, `@last fri`, `@oct 5`). Stored as a
 * plain local calendar date (`YYYY-MM-DD`) — no time, no timezone — and shown
 * relative to today ("Today", "2 days ago", "In 3 weeks") until that gets vague,
 * then as a date. The exact date is always in the tooltip.
 */

import { DYNAMIC_TODAY } from '@papier/core/props';

const DAY_MS = 86_400_000;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** Beyond this many days away, show the date instead of "N weeks ago". */
const RELATIVE_LIMIT_DAYS = 27;

/** @param {Date} d */
export function toISODate(d) {
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** @param {string} iso  YYYY-MM-DD → local midnight, or null if malformed */
export function fromISODate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return toISODate(d) === iso ? d : null;
}

/** @param {Date} d */
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** @param {Date} d @param {number} n */
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Whole days from `now` to `d` (calendar days, DST-safe). @param {Date} d @param {Date} now */
const dayDiff = (d, now) => Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / DAY_MS);

/** Index of the month/weekday name that `word` abbreviates (≥ 3 letters), or -1. @param {string[]} names @param {string} word */
const nameIndex = (names, word) => (word.length >= 3 ? names.findIndex((n) => n.startsWith(word)) : -1);

/** "3", "three", "a" → 3, 3, 1; otherwise NaN. @param {string} word */
const count = (word) => (word === 'a' || word === 'an' ? 1 : /^\d{1,3}$/.test(word) ? Number(word) : NUMBER_WORDS.indexOf(word) >= 0 ? NUMBER_WORDS.indexOf(word) : NaN);

/**
 * Understands:
 * - today / tomorrow / yesterday (from 3 letters), "next week", "last week"
 * - "in N days|weeks", "N days|weeks ago" (N as digits, "a", or a word up to ten)
 * - weekday names: plain or "next" = the upcoming one, "last" = the previous one
 * - ISO dates, and "oct 5" / "5 oct" with an optional year (no year = next occurrence)
 * @param {string} query
 * @param {Date} [now]
 * @returns {Date | null}
 */
export function parseDateQuery(query, now = new Date()) {
  const q = query.trim().toLowerCase().replace(/[,.]/g, ' ').replace(/\s+/g, ' ');
  if (!q) return null;
  const today = startOfDay(now);

  if (q.length >= 3 && 'today'.startsWith(q)) return today;
  if (q.length >= 3 && 'tomorrow'.startsWith(q)) return addDays(today, 1);
  if (q.length >= 3 && 'yesterday'.startsWith(q)) return addDays(today, -1);
  if (q === 'next week') return addDays(today, 7);
  if (q === 'last week') return addDays(today, -7);

  let m = /^in ([a-z0-9]+) (day|days|week|weeks)$/.exec(q) ?? /^([a-z0-9]+) (day|days|week|weeks) ago$/.exec(q);
  if (m) {
    const n = count(/** @type {string} */ (m[1]));
    if (Number.isNaN(n)) return null;
    const days = n * (m[2]?.startsWith('week') ? 7 : 1);
    return addDays(today, q.startsWith('in ') ? days : -days);
  }

  m = /^(next |last )?([a-z]+)$/.exec(q);
  if (m) {
    const wd = nameIndex(WEEKDAYS, /** @type {string} */ (m[2]));
    if (wd !== -1) {
      // Never today: "fri" on a Friday means a week out, "last fri" a week back.
      if (m[1] === 'last ') return addDays(today, -((today.getDay() - wd + 7) % 7 || 7));
      return addDays(today, (wd - today.getDay() + 7) % 7 || 7);
    }
  }

  const iso = fromISODate(q);
  if (iso) return iso;

  // "oct 5", "october 5 2027", "5 oct", "5 october 2027"
  m = /^([a-z]+) (\d{1,2})(?: (\d{4}))?$/.exec(q) ?? /^(\d{1,2}) ([a-z]+)(?: (\d{4}))?$/.exec(q);
  if (m) {
    const [monthWord, dayStr] = /^\d/.test(/** @type {string} */ (m[1])) ? [m[2], m[1]] : [m[1], m[2]];
    const month = nameIndex(MONTHS, /** @type {string} */ (monthWord));
    const day = Number(dayStr);
    if (month === -1 || day < 1 || day > 31) return null;
    const year = m[3] ? Number(m[3]) : today.getFullYear();
    let d = new Date(year, month, day);
    if (d.getMonth() !== month) return null; // e.g. feb 30
    if (!m[3] && d < today) d = new Date(year + 1, month, day);
    return d;
  }
  return null;
}

/** @param {number} n @param {string} unit */
const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/**
 * Label for a stored date, relative while that's still precise enough.
 * @param {string} iso
 * @param {Date} [now]
 */
export function formatDateMention(iso, now = new Date()) {
  if (iso === DYNAMIC_TODAY) return 'Today ↻';
  const d = fromISODate(iso);
  if (!d) return iso || 'Invalid date';
  const diff = dayDiff(d, now);
  const abs = Math.abs(diff);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (abs <= RELATIVE_LIMIT_DAYS) {
    const span = abs < 7 ? plural(abs, 'day') : plural(Math.floor(abs / 7), 'week');
    return diff > 0 ? `In ${span}` : `${span} ago`;
  }
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

/** Full date for tooltips and menus: "Wed, Sep 30, 2026". @param {string} iso */
export function formatDateLong(iso) {
  if (iso === DYNAMIC_TODAY) return 'The day a page is made from this template';
  const d = fromISODate(iso);
  return d ? d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : iso;
}

/**
 * Menu entries for `@<query>`: shortcuts that match what's typed, plus whatever
 * the query parses to (titled with the label it will show). Deduplicated by
 * date, keeping the friendlier shortcut name.
 * @param {string} query
 * @param {Date} [now]
 * @returns {{ title: string, date: string, subtext: string }[]}
 */
export function dateSuggestions(query, now = new Date()) {
  const q = query.trim().toLowerCase();
  const today = startOfDay(now);

  /** @type {[string, Date][]} */
  const shortcuts = [
    ['Today', today],
    ['Tomorrow', addDays(today, 1)],
    ['Yesterday', addDays(today, -1)],
    ['Next week', addDays(today, 7)],
  ];
  /** @type {[string, Date][]} */
  const matches = shortcuts.filter(([title]) => !q || title.toLowerCase().startsWith(q));

  const parsed = parseDateQuery(q, now);
  if (parsed) matches.push([formatDateMention(toISODate(parsed), now), parsed]);

  const seen = new Set();
  return matches
    .map(([title, d]) => ({ title, date: toISODate(d), subtext: formatDateLong(toISODate(d)) }))
    .filter((s) => !seen.has(s.date) && seen.add(s.date));
}
