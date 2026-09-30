import { describe, expect, it } from 'vitest';
import { orderBetween, PageCreate, PageUpdate, rebalanceOrder } from './pages.js';

describe('orderBetween', () => {
  it('produces keys that sort between their neighbours', () => {
    const a = orderBetween(null, null);
    const c = orderBetween(a, null);
    const b = orderBetween(a, c);
    expect([c, b, a].sort()).toEqual([a, b, c]);
  });
});

describe('PageCreate', () => {
  it('defaults to an untitled root page', () => {
    expect(PageCreate.parse({})).toEqual({ parentId: null, title: '', kind: 'page', block: true });
  });
});

describe('PageUpdate', () => {
  it('rejects an empty patch', () => {
    expect(PageUpdate.safeParse({}).success).toBe(false);
  });
});

describe('rebalanceOrder', () => {
  const isSorted = (/** @type {string[]} */ keys) => keys.every((k, i) => i === 0 || /** @type {string} */ (keys[i - 1]) < k);

  it('keys a fresh list', () => {
    const keys = rebalanceOrder([null, null, null]);
    expect(isSorted(keys)).toBe(true);
  });

  it('keeps already-ordered keys untouched', () => {
    expect(rebalanceOrder(['a0', 'a1', 'a2'])).toEqual(['a0', 'a1', 'a2']);
  });

  it('rewrites only the moved item', () => {
    // a2 moved to the front
    const keys = rebalanceOrder(['a2', 'a0', 'a1']);
    expect(isSorted(keys)).toBe(true);
    expect(keys.slice(1)).toEqual(['a0', 'a1']);
  });

  it('slots inserted items between neighbours', () => {
    const keys = rebalanceOrder(['a0', null, 'a1', null]);
    expect(isSorted(keys)).toBe(true);
    expect([keys[0], keys[2]]).toEqual(['a0', 'a1']);
  });

  it('breaks ties from duplicate keys', () => {
    const keys = rebalanceOrder(['a0', 'a0', 'a0']);
    expect(isSorted(keys)).toBe(true);
    expect(keys).toContain('a0');
  });
});
