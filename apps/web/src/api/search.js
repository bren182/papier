import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { api } from './client.js';

/** @typedef {import('./pages.js').Crumb} Crumb */
/**
 * @typedef {{
 *   page: Crumb,
 *   ancestors: Crumb[],
 *   blockId: string | null,
 *   snippet: string,
 * }} SearchHit
 * @typedef {{ items: SearchHit[], nextOffset: number | null }} SearchResult
 */

const PAGE_SIZE = 20;

/**
 * Full-text search, a page of hits at a time. Keeps showing the previous
 * results while the next query loads, so typing doesn't flicker.
 * @param {string} q
 */
export function useSearch(q) {
  const query = q.trim();
  return useInfiniteQuery({
    queryKey: ['search', query],
    queryFn: ({ pageParam }) =>
      /** @type {Promise<SearchResult>} */ (
        api(`/search?q=${encodeURIComponent(query)}&limit=${PAGE_SIZE}&offset=${pageParam}`)
      ),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    enabled: query.length > 0,
    placeholderData: keepPreviousData,
    // Results change with every save; a reopened dialog should be fresh.
    staleTime: 0,
    gcTime: 60_000,
  });
}
