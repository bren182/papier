import { describe, expect, it } from 'vitest';
import { openDb } from './index.ts';
import { blocks, pages } from './schema.ts';
import { backfillSearch, searchPages } from './search.ts';

describe('backfillSearch', () => {
  it('indexes blocks written without the API, once', () => {
    const { db, sqlite } = openDb(':memory:');
    const now = Date.now();
    db.insert(pages).values({ id: 'p', title: 'Old page', orderKey: 'a0', createdAt: now, updatedAt: now }).run();
    const rows = Array.from({ length: 1500 }, (_, i) => ({
      id: `b${i}`,
      pageId: 'p',
      type: 'paragraph',
      orderKey: `a${String(i).padStart(4, '0')}`,
      content: [{ type: 'text', text: i === 1234 ? 'legacy needle' : `filler ${i}` }],
      createdAt: now,
      updatedAt: now,
    }));
    for (const r of rows) db.insert(blocks).values(r).run();

    expect(searchPages(db, 'needle', { limit: 5, offset: 0 }).items).toEqual([]);
    expect(backfillSearch(db)).toBe(1500);
    expect(backfillSearch(db)).toBe(0);
    expect(searchPages(db, 'needle', { limit: 5, offset: 0 }).items[0]).toMatchObject({ pageId: 'p', blockId: 'b1234' });
    sqlite.close();
  });
});
