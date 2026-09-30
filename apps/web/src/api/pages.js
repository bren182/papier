import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { plainText } from '@papier/core/text';
import { reloadContent } from './blocks.js';
import { api, ApiError } from './client.js';

/** @typedef {import('@papier/core').Page} Page */
/** @typedef {{ id: string, title: string, titleContent: import('@papier/core').InlineContent | null, icon: string | null }} Crumb */
/** @typedef {{ title?: string, titleContent?: import('@papier/core').InlineContent, icon?: string | null }} PagePatch */
/**
 * A page, its ancestors, and — for a database row — its database and values.
 * @typedef {{ page: Page, ancestors: Crumb[], database: { id: string, title: string } | null, props: Record<string, unknown> | null,
 *   refs?: Record<string, import('./databases.js').Ref>, inTemplate: boolean }} PageDetail  inTemplate: some ancestor is a template;
 *   refs: titles of the rows its relations link to
 */

export const pageKeys = {
  all: ['pages'],
  children: (/** @type {string | null} */ parentId) => ['pages', 'children', parentId ?? 'root'],
  detail: (/** @type {string} */ id) => ['pages', 'detail', id],
};

/**
 * Children of one parent (null = root). Only fetched when `enabled`, so the
 * sidebar loads a subtree when it's expanded, never the whole tree.
 * @param {string | null} parentId
 * @param {boolean} [enabled]
 */
export function useChildPages(parentId, enabled = true) {
  return useQuery({
    queryKey: pageKeys.children(parentId),
    queryFn: () => /** @type {Promise<Page[]>} */ (api(parentId ? `/pages?parent=${encodeURIComponent(parentId)}` : '/pages')),
    enabled,
  });
}

/**
 * One page plus its ancestors — shared by `usePage` and the editor's page
 * blocks, which watch the same cache entry outside React.
 * @param {string} id
 */
export const pageQuery = (id) => ({
  queryKey: pageKeys.detail(id),
  queryFn: () => /** @type {Promise<PageDetail>} */ (api(`/pages/${id}`)),
  retry: (/** @type {number} */ count, /** @type {Error} */ err) => !(err instanceof ApiError && err.status === 404) && count < 2,
});

/** @param {string | null} id */
export function usePage(id) {
  return useQuery({ ...pageQuery(id ?? ''), enabled: Boolean(id) });
}

export function useCreatePage() {
  const qc = useQueryClient();
  return useMutation({
    /** @param {{ parentId?: string | null, title?: string, kind?: 'page' | 'database', block?: boolean }} input */
    mutationFn: (input) => /** @type {Promise<Page>} */ (api('/pages', { method: 'POST', body: input })),
    // The parent's own row changes too (hasChildren), so refresh every list.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pages', 'children'] }),
  });
}

export function useUpdatePage() {
  const qc = useQueryClient();
  return useMutation({
    /** @param {{ id: string, patch: PagePatch }} vars */
    mutationFn: ({ id, patch }) => /** @type {Promise<Page>} */ (api(`/pages/${id}`, { method: 'PATCH', body: patch })),
    // Optimistic: the sidebar and breadcrumbs follow the title as you type.
    onMutate: ({ id, patch: input }) => {
      // Mirror the server: a rich title derives the plain one; a plain one drops the rich one.
      const patch =
        input.titleContent !== undefined
          ? { ...input, title: plainText(input.titleContent) }
          : input.title !== undefined
            ? { ...input, titleContent: null }
            : input;
      qc.setQueriesData({ queryKey: ['pages', 'children'] }, (/** @type {Page[] | undefined} */ list) =>
        list?.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      );
      qc.setQueryData(pageKeys.detail(id), (/** @type {{ page: Page, ancestors: Crumb[] } | undefined} */ d) =>
        d && { ...d, page: { ...d.page, ...patch } },
      );
    },
    onError: () => qc.invalidateQueries({ queryKey: pageKeys.all }),
  });
}

export function useArchivePage() {
  const qc = useQueryClient();
  return useMutation({
    /** @param {{ id: string, parentId: string | null }} page */
    mutationFn: ({ id }) => api(`/pages/${id}`, { method: 'DELETE' }),
    onSuccess: (_res, page) => {
      qc.invalidateQueries({ queryKey: pageKeys.all });
      qc.invalidateQueries({ queryKey: ['templates'] });
      qc.invalidateQueries({ queryKey: ['db'] }); // a row or a database template
      reloadContent(qc, [page.parentId]); // its page block is gone
    },
  });
}

/** @typedef {{ id: string, from: string | null, parentId: string | null, beforeId?: string, afterId?: string }} PageMoveVars */

/** Move a page (and its subtree) under another parent and/or among its siblings. */
export function useMovePage() {
  const qc = useQueryClient();
  return useMutation({
    /** @param {PageMoveVars} vars */
    mutationFn: ({ id, parentId, beforeId, afterId }) =>
      /** @type {Promise<Page>} */ (api(`/pages/${id}/move`, { method: 'POST', body: { parentId, beforeId, afterId } })),
    onSuccess: (_page, { from, parentId }) => {
      qc.invalidateQueries({ queryKey: pageKeys.all });
      // The page block moved from one parent's content to the other's.
      if (from !== parentId) reloadContent(qc, [from, parentId]);
    },
  });
}
