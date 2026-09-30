/**
 * Date mentions (`@today`, `@next fri`, `@oct 5`). Stored as a plain local
 * calendar date (`YYYY-MM-DD`) — no time, no timezone — and shown relative to
 * today when close (Today / Tomorrow / Yesterday), like Notion.
 */

const DAY_MS = 86_400_000;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

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

/**
 * Understands: today / tomorrow / yesterday (from 3 letters), weekday names (optionally "next"),
 * "next week", "in N days|weeks", ISO dates, and "oct 5" / "5 oct" with an
 * optional year. Month/day without a year picks the next occurrence.
 * @param {string} query
 * @param {Date} [now]
 * @returns {Date | null}
 */
export function parseDateQuery(query, now = new Date()) {
  const q = query.trim().toLowerCase().replace(/[,.]/g, ' ').replace(/\s+/g, ' ');
  if (!q) return null;
  const today = startOfDay(now);

  if ('today'.startsWith(q) && q.length >= 3) return today;
  if ('tomorrow'.startsWith(q) && q.length >= 3) return addDays(today, 1);
  if ('yesterday'.startsWith(q) && q.length >= 3) return addDays(today, -1);
  if (q === 'next week') return addDays(today, 7);

  let m = /^in (\d{1,3}) (day|days|week|weeks)$/.exec(q);
  if (m) return addDays(today, Number(m[1]) * (m[2]?.startsWith('week') ? 7 : 1));

  m = /^(next )?([a-z]+)$/.exec(q);
  if (m) {
    const wd = nameIndex(WEEKDAYS, /** @type {string} */ (m[2]));
    if (wd !== -1) {
      // The upcoming one, never today ("fri" on a Friday = a week out). "next fri"
      // means the same — the menu shows the resolved date, so it's never a guess.
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

/**
 * Label for a stored date: relative when within a day of today, else a short date
 * (year only when it isn't this year).
 * @param {string} iso
 * @param {Date} [now]
 */
export function formatDateMention(iso, now = new Date()) {
  const d = fromISODate(iso);
  if (!d) return iso || 'Invalid date';
  const diff = dayDiff(d, now);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    weekday: Math.abs(diff) < 7 ? 'short' : undefined,
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

/**
 * Menu entries for `@<query>`: shortcuts that match what's typed, plus whatever
 * the query parses to. Deduplicated by date, keeping the friendlier shortcut name.
 * @param {string} query
 * @param {Date} [now]
 * @returns {{ title: string, date: string, subtext: string }[]}
 */
export function dateSuggestions(query, now = new Date()) {
  const q = query.trim().toLowerCase();
  const today = startOfDay(now);
  const long = (/** @type {Date} */ d) =>
    d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

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
  if (parsed) matches.push([long(parsed), parsed]);

  const seen = new Set();
  return matches
    .map(([title, d]) => ({ title, date: toISODate(d), subtext: long(d) }))
    .filter((s) => !seen.has(s.date) && seen.add(s.date))
    .map((s) => (s.title === s.subtext ? { ...s, subtext: 'Date' } : s));
}
