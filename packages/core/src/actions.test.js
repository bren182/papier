import { describe, expect, it } from 'vitest';
import { ACTIONS_FOR, shiftDate } from './actions.js';
import { Action, Actions } from './databases.js';

describe('shiftDate', () => {
  it('moves by days and weeks across months and years', () => {
    expect(shiftDate('2026-09-30', 1, 'day')).toBe('2026-10-01');
    expect(shiftDate('2026-12-28', 1, 'week')).toBe('2027-01-04');
    expect(shiftDate('2026-03-01', -1, 'day')).toBe('2026-02-28');
  });

  it('clamps months and years to the end of the month', () => {
    expect(shiftDate('2026-01-31', 1, 'month')).toBe('2026-02-28');
    expect(shiftDate('2028-01-31', 1, 'month')).toBe('2028-02-29');
    expect(shiftDate('2028-02-29', 1, 'year')).toBe('2029-02-28');
    expect(shiftDate('2026-03-31', -1, 'month')).toBe('2026-02-28');
    expect(shiftDate('2026-01-15', -13, 'month')).toBe('2024-12-15');
  });

  it('refuses non-dates', () => {
    expect(() => shiftDate('@today', 1, 'day')).toThrow();
  });
});

describe('actions', () => {
  it('parse by type, with defaults', () => {
    expect(Action.parse({ type: 'shift_date', propId: 'p', amount: 1, unit: 'year' })).toEqual({ type: 'shift_date', propId: 'p', amount: 1, unit: 'year', from: 'value' });
    expect(Action.parse({ type: 'add_row', databaseId: 'd' })).toEqual({ type: 'add_row', databaseId: 'd', values: {} });
    expect(() => Action.parse({ type: 'shift_date', propId: 'p', amount: 1, unit: 'fortnight' })).toThrow();
    expect(() => Action.parse({ type: 'launch_rocket' })).toThrow();
    expect(() => Actions.parse(Array.from({ length: 21 }, () => ({ type: 'set_today', propId: 'p' })))).toThrow();
  });

  it('fit property types', () => {
    expect(ACTIONS_FOR.date).toContain('shift_date');
    expect(ACTIONS_FOR.checkbox).toEqual(['check']);
    expect(ACTIONS_FOR.rollup).toBeUndefined();
  });
});
