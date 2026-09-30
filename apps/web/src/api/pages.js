import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { plainText } from '@papier/core/text';
import { api, ApiError } from './client.js';

/** @typedef {import('@papier/core').Page} Page */
/** @typedef {{ id: string, title: string, titleContent: import('@papier/core').InlineContent | null, icon: string | null }} Crumb */
/** @typedef {{ title?: string, titleContent?: import('@papier/core').InlineContent, icon?: string | null }} PagePatch */

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

/** @param {string | null} id */
export function usePage(id) {
  return useQuery({
    queryKey: pageKeys.detail(id ?? ''),
    queryFn: () => /** @type {Promise<{ page: Page, ancestors: Crumb[] }>} */ (api(`/pages/${id}`)),
    enabled: Boolean(id),
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
  });
}

export function useCreatePage() {
  const qc = useQueryClient();
  return useMutation({
    /** @param {{ parentId?: string | null, title?: string }} input */
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
    /** @param {string} id */
    mutationFn: (id) => api(`/pages/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: pageKeys.all }),
  });
}
