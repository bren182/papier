import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toISODate } from '../editor/dates.js';
import { reloadContent } from './blocks.js';
import { api } from './client.js';
import { pageKeys } from './pages.js';

/** @typedef {import('@papier/core').Page} Page */
/** @typedef {{ id: string, title: string, titleContent: import('@papier/core').InlineContent | null, icon: string | null, kind: string, updatedAt: number }} TemplateItem */

export const templateKeys = { all: ['templates'] };

/** The template library: the user's page templates. */
export function useTemplates() {
  return useQuery({
    queryKey: templateKeys.all,
    queryFn: () => /** @type {Promise<TemplateItem[]>} */ (api('/templates')),
  });
}

/** The viewer's local date: "today" in templates resolves to it. */
export const today = () => toISODate(new Date());

/**
 * Deep-copy a page: Duplicate (beside the original), Save as template
 * (`asTemplate`), or Use template (copy a template into `parentId`).
 */
export function useDuplicatePage() {
  const qc = useQueryClient();
  return useMutation({
    /** @param {{ id: string, parentId?: string | null, asTemplate?: boolean, block?: boolean }} vars */
    mutationFn: ({ id, ...body }) => /** @type {Promise<Page>} */ (api(`/pages/${id}/duplicate`, { method: 'POST', body: { ...body, today: today() } })),
    onSuccess: (page) => {
      qc.invalidateQueries({ queryKey: pageKeys.all });
      qc.invalidateQueries({ queryKey: templateKeys.all });
      qc.invalidateQueries({ queryKey: ['db'] });
      // The copy's page block landed in its parent's content.
      if (page.parentId) reloadContent(qc, [page.parentId]);
    },
  });
}
