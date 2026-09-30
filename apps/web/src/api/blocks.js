import { useQuery } from '@tanstack/react-query';
import { api } from './client.js';

/** @typedef {import('@papier/core').Block} Block */
/** @typedef {import('@papier/core').BlockBatch} BlockBatch */

export const blockKeys = {
  page: (/** @type {string} */ pageId) => ['blocks', pageId],
};

/** Saves still on the wire, per page. A fresh load waits for them so it never reads stale rows. */
const inflight = new Map(/** @type {[string, Promise<unknown>][]} */ ([]));

/**
 * All blocks of one page, flat. The editor only reads this once when it mounts
 * and owns the content from then on, so it isn't cached or refetched: every
 * mount loads fresh after any pending save for the page.
 * @param {string} pageId
 */
export function usePageBlocks(pageId) {
  return useQuery({
    queryKey: blockKeys.page(pageId),
    queryFn: async () => {
      await inflight.get(pageId);
      return /** @type {Promise<Block[]>} */ (api(`/pages/${pageId}/blocks`));
    },
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/**
 * Autosave: upsert changed blocks and delete removed ones.
 * @param {string} pageId
 * @param {BlockBatch} batch
 * @param {{ keepalive?: boolean }} [opts]
 */
export function saveBlocks(pageId, batch, { keepalive } = {}) {
  const req = api(`/pages/${pageId}/blocks/batch`, { method: 'POST', body: batch, keepalive });
  const settled = Promise.all([inflight.get(pageId), req.catch(() => {})]);
  inflight.set(pageId, settled);
  settled.then(() => {
    if (inflight.get(pageId) === settled) inflight.delete(pageId);
  });
  return req;
}
