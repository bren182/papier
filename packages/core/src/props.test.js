import { describe, expect, it } from 'vitest';
import { coerceValue, InvalidValue, sortKeys, textToValue, validateValue, valueToText } from './props.js';
import { Filter, ViewConfig } from './databases.js';

/** @param {string} type @param {import('./props.js').PropertyConfig} [config] */
const prop = (type, config = {}) => ({ id: 'p', name: 'P', type, config });
const status = prop('select', { options: [{ id: 'o1', name: 'Todo' }, { id: 'o2', name: 'Done' }] });
const tags = prop('multi_select', { options: [{ id: 't1', name: 'a' }, { id: 't2', name: 'b' }] });

describe('validateValue', () => {
  it('normalises empties to null', () => {
    expect(validateValue(prop('text'), '  ')).toBe(null);
    expect(validateValue(prop('checkbox'), false)).toBe(null);
    expect(validateValue(tags, [])).toBe(null);
  });

  it('accepts well-typed values', () => {
    expect(validateValue(prop('number'), 3.5)).toBe(3.5);
    expect(validateValue(status, 'o2')).toBe('o2');
    expect(validateValue(tags, ['t1', 't1', 't2'])).toEqual(['t1', 't2']);
    expect(validateValue(prop('date'), '2026-09-30')).toBe('2026-09-30');
  });

  it('rejects wrong types, unknown options and computed properties', () => {
    expect(() => validateValue(prop('number'), '3')).toThrow(InvalidValue);
    expect(() => validateValue(status, 'nope')).toThrow(InvalidValue);
    expect(() => validateValue(prop('date'), '30/09/2026')).toThrow(InvalidValue);
    expect(() => validateValue(prop('created_time'), 1)).toThrow(InvalidValue);
  });
});

describe('sortKeys', () => {
  it('fills the indexed column for the type', () => {
    expect(sortKeys(prop('text'), 'Hello')).toEqual({ sortText: 'hello', sortNum: null });
    expect(sortKeys(prop('number'), 4)).toEqual({ sortText: null, sortNum: 4 });
    expect(sortKeys(prop('checkbox'), true)).toEqual({ sortText: null, sortNum: 1 });
  });
});

describe('coerceValue', () => {
  it('converts through text', () => {
    expect(coerceValue(prop('text'), prop('number'), '1,200')).toBe(1200);
    expect(coerceValue(prop('text'), prop('number'), 'abc')).toBe(null);
    expect(coerceValue(status, prop('text'), 'o2')).toBe('Done');
    expect(coerceValue(prop('text'), status, 'done')).toBe('o2');
  });

  it('keeps option ids between select and multi-select', () => {
    expect(coerceValue(status, { ...status, type: 'multi_select' }, 'o1')).toEqual(['o1']);
    expect(coerceValue(tags, { ...tags, type: 'select' }, ['t2', 't1'])).toBe('t2');
  });

  it('round-trips multi-select names', () => {
    expect(valueToText(tags, ['t1', 't2'])).toBe('a, b');
    expect(textToValue(tags, 'b, a, zzz')).toEqual(['t2', 't1']);
  });
});

describe('ViewConfig', () => {
  it('defaults every field', () => {
    expect(ViewConfig.parse({})).toEqual({ sorts: [], filters: [], hidden: [], widths: {}, propOrder: [], groupBy: null });
  });

  it('rejects unknown filter operators', () => {
    expect(Filter.safeParse({ propId: 'p', op: 'like' }).success).toBe(false);
  });
});
