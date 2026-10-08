import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';
import { pageKeys } from './pages.js';

/**
 * @typedef {{ page: { id: string, title: string, titleContent: unknown, icon: string | null, appearance: Record<string, unknown>, kind: string },
 *   blocks: Array<{ id: string, type: string, parentId: string | null, order: string, props: Record<string, unknown>, content: unknown[] }> }} SharedPage
 */

/**
 * Fetch a shared page by its token (public — no auth required).
 * @param {string | null} token
 */
export function useSharedPage(token) {
  return useQuery({
    queryKey: ['share', token],
    queryFn: () => /** @type {Promise<SharedPage>} */ (fetch(`/api/share/${token}`).then(async (r) => {
      if (!r.ok) throw new Error('Shared page not found');
      return r.json();
    })),
    enabled: Boolean(token),
    retry: false,
  });
}

/** Enable sharing for a page: generates (or returns existing) share token. */
export function useCreateShare() {
  const qc = useQueryClient();
  return useMutation({
    /** @param {string} pageId */
    mutationFn: (pageId) => /** @type {Promise<{ shareToken: string }>} */ (api(`/pages/${pageId}/share`, { method: 'POST' })),
    onSuccess: (data, pageId) => {
      qc.setQueryData(pageKeys.detail(pageId), (/** @type {any} */ d) => d && { ...d, page: { ...d.page, shareToken: data.shareToken } });
    },
  });
}

/** Disable sharing for a page: revokes the share token. */
export function useDeleteShare() {
  const qc = useQueryClient();
  return useMutation({
    /** @param {string} pageId */
    mutationFn: (pageId) => api(`/pages/${pageId}/share`, { method: 'DELETE' }),
    onSuccess: (_data, pageId) => {
      qc.setQueryData(pageKeys.detail(pageId), (/** @type {any} */ d) => d && { ...d, page: { ...d.page, shareToken: null } });
    },
  });
}
