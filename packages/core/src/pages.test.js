import { describe, expect, it } from 'vitest';
import { orderBetween, PageCreate, PageUpdate } from './pages.js';

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
    expect(PageCreate.parse({})).toEqual({ parentId: null, title: '' });
  });
});

describe('PageUpdate', () => {
  it('rejects an empty patch', () => {
    expect(PageUpdate.safeParse({}).success).toBe(false);
  });
});
