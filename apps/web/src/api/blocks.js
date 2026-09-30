import { useSyncExternalStore } from 'react';
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

// ── reloading an open page's content ──────────────────────────────────────

/** Per-page content version: bumping it remounts that page's editor on fresh rows. */
const versions = new Map(/** @type {[string, number][]} */ ([]));
const listeners = new Set(/** @type {(() => void)[]} */ ([]));

/**
 * The server changed a page's blocks behind the editor's back (a sub-page moved
 * in or out, or was trashed): drop the cached rows and remount its editor.
 * Pending edits are flushed as the old editor unmounts; the reload waits for them.
 * @param {import('@tanstack/react-query').QueryClient} qc
 * @param {(string | null | undefined)[]} pageIds
 */
export function reloadContent(qc, pageIds) {
  for (const id of pageIds) {
    if (!id) continue;
    qc.removeQueries({ queryKey: blockKeys.page(id) });
    versions.set(id, (versions.get(id) ?? 0) + 1);
  }
  listeners.forEach((l) => l());
}

/** @param {string} pageId */
export function useContentVersion(pageId) {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => versions.get(pageId) ?? 0,
  );
}
