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
  it('is relative near today', () => {
    expect(formatDateMention('2026-09-30', now)).toBe('Today');
    expect(formatDateMention('2026-10-01', now)).toBe('Tomorrow');
    expect(formatDateMention('2026-09-29', now)).toBe('Yesterday');
  });

  it('adds the year only when it differs', () => {
    expect(formatDateMention('2026-12-24', now)).not.toMatch(/2026/);
    expect(formatDateMention('2027-01-02', now)).toMatch(/2027/);
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

  it('offers nothing for an unparseable query', () => {
    expect(dateSuggestions('banana', now)).toEqual([]);
  });
});

describe('fromISODate', () => {
  it('round-trips with toISODate', () => {
    expect(toISODate(/** @type {Date} */ (fromISODate('2026-03-29')))).toBe('2026-03-29');
  });
});
