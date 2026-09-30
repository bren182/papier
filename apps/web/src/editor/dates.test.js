import { describe, expect, it } from 'vitest';
import { dateSuggestions, formatDateMention, fromISODate, parseDateQuery, toISODate } from './dates.js';

// Wednesday 30 September 2026, mid-afternoon local time.
const now = new Date(2026, 8, 30, 15, 0);
const parse = (/** @type {string} */ q) => {
  const d = parseDateQuery(q, now);
  return d && toISODate(d);
};

describe('parseDateQuery', () => {
  it('understands relative words', () => {
    expect(parse('today')).toBe('2026-09-30');
    expect(parse('tom')).toBe('2026-10-01');
    expect(parse('yesterday')).toBe('2026-09-29');
    expect(parse('next week')).toBe('2026-10-07');
    expect(parse('in 3 days')).toBe('2026-10-03');
    expect(parse('in 2 weeks')).toBe('2026-10-14');
  });

  it('understands "ago" phrases, with digits or words', () => {
    expect(parse('2 days ago')).toBe('2026-09-28');
    expect(parse('two days ago')).toBe('2026-09-28');
    expect(parse('a week ago')).toBe('2026-09-23');
    expect(parse('three weeks ago')).toBe('2026-09-09');
    expect(parse('in two days')).toBe('2026-10-02');
    expect(parse('last week')).toBe('2026-09-23');
    expect(parse('lots of days ago')).toBeNull();
  });

  it('resolves "last <weekday>" to the previous one, never today', () => {
    expect(parse('last fri')).toBe('2026-09-25');
    expect(parse('last wednesday')).toBe('2026-09-23');
  });

  it('resolves weekdays to the upcoming one, never today', () => {
    expect(parse('fri')).toBe('2026-10-02');
    expect(parse('next friday')).toBe('2026-10-02');
    expect(parse('wednesday')).toBe('2026-10-07');
  });

  it('reads month/day in either order, rolling past dates to next year', () => {
    expect(parse('oct 5')).toBe('2026-10-05');
    expect(parse('5 October')).toBe('2026-10-05');
    expect(parse('jan 2')).toBe('2027-01-02');
    expect(parse('march 1, 2025')).toBe('2025-03-01');
    expect(parse('2026-12-24')).toBe('2026-12-24');
  });

  it('rejects nonsense and impossible dates', () => {
    expect(parse('')).toBeNull();
    expect(parse('to')).toBeNull();
    expect(parse('feb 30')).toBeNull();
    expect(parse('2026-02-30')).toBeNull();
    expect(parse('banana')).toBeNull();
  });
});

describe('formatDateMention', () => {
  const label = (/** @type {string} */ iso) => formatDateMention(iso, now);

  it('says Today / Tomorrow / Yesterday', () => {
    expect(label('2026-09-30')).toBe('Today');
    expect(label('2026-10-01')).toBe('Tomorrow');
    expect(label('2026-09-29')).toBe('Yesterday');
  });

  it('counts days, then weeks', () => {
    expect(label('2026-09-28')).toBe('2 days ago');
    expect(label('2026-10-06')).toBe('In 6 days');
    expect(label('2026-09-23')).toBe('1 week ago');
    expect(label('2026-10-14')).toBe('In 2 weeks');
    expect(label('2026-09-03')).toBe('3 weeks ago'); // 27 days
  });

  it('falls back to a date when far off, with the year only when it differs', () => {
    expect(label('2026-09-02')).not.toMatch(/ago|2026/);
    expect(label('2027-01-02')).toMatch(/2027/);
  });
});

describe('dateSuggestions', () => {
  it('offers shortcuts with an empty query', () => {
    expect(dateSuggestions('', now).map((s) => s.title)).toEqual(['Today', 'Tomorrow', 'Yesterday', 'Next week']);
  });

  it('prefers the shortcut name when the parsed date duplicates it', () => {
    const items = dateSuggestions('tod', now);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: 'Today', date: '2026-09-30' });
  });

  it('titles a parsed date with the label it will show', () => {
    expect(dateSuggestions('two days ago', now)[0]).toMatchObject({ title: '2 days ago', date: '2026-09-28' });
  });

  it('offers nothing for an unparseable query', () => {
    expect(dateSuggestions('banana', now)).toEqual([]);
  });
});

describe('fromISODate', () => {
  it('round-trips with toISODate', () => {
    expect(toISODate(/** @type {Date} */ (fromISODate('2026-03-29')))).toBe('2026-03-29');
  });
});
