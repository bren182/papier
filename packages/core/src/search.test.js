import { describe, expect, it } from 'vitest';
import { HIT_END, HIT_START, SearchQuery, snippetParts } from './search.js';

describe('SearchQuery', () => {
  it('coerces the query string and fills defaults', () => {
    expect(SearchQuery.parse({ q: 'hi', limit: '5' })).toEqual({ q: 'hi', limit: 5, offset: 0 });
  });

  it('caps the page size', () => {
    expect(() => SearchQuery.parse({ limit: '500' })).toThrow();
  });
});

describe('snippetParts', () => {
  it('splits matched runs from plain ones', () => {
    const s = `…the ${HIT_START}quick${HIT_END} brown ${HIT_START}fox${HIT_END}`;
    expect(snippetParts(s)).toEqual([
      { text: '…the ', hit: false },
      { text: 'quick', hit: true },
      { text: ' brown ', hit: false },
      { text: 'fox', hit: true },
    ]);
  });

  it('passes text without markers through', () => {
    expect(snippetParts('plain')).toEqual([{ text: 'plain', hit: false }]);
    expect(snippetParts('')).toEqual([]);
  });
});
