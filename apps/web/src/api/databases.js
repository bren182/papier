import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';
import { pageKeys } from './pages.js';
import { today } from './templates.js';

/**
 * @typedef {import('@papier/core/props').PropertyDef & { order: string }} Property
 * @typedef {{ sorts: { propId: string, dir: 'asc' | 'desc' | 'upcoming' }[], filters: { propId: string, op: string, value?: string | number | boolean | null }[],
 *   hidden: string[], widths: Record<string, number>, propOrder: string[], groupBy: string | null, template: string | null }} ViewConfig
 * @typedef {{ id: string, name: string, type: 'table' | 'board', config: ViewConfig, order: string }} View
 * @typedef {{ id: string, title: string, titleContent: import('@papier/core').InlineContent | null, icon: string | null }} RowTemplate
 * @typedef {{ id: string, properties: Property[], views: View[], templates: RowTemplate[] }} DatabaseSchema
 * @typedef {{ id: string, title: string, titleContent: import('@papier/core').InlineContent | null, icon: string | null,
 *   order: string, createdAt: number, updatedAt: number, props: Record<string, unknown> }} Row
 * @typedef {{ sorts?: ViewConfig['sorts'], filters?: ViewConfig['filters'], group?: { propId: string, value: string | null }, limit?: number }} RowQuery
 * @typedef {{ rows: Row[], total: number }} RowPage
 */

export const dbKeys = {
  schema: (/** @type {string} */ id) => ['db', id, 'schema'],
  rows: (/** @type {string} */ id) => ['db', id, 'rows'],
  query: (/** @type {string} */ id, /** @type {RowQuery} */ q) => ['db', id, 'rows', q],
};

/** Properties and views of a database. @param {string} id */
export function useDatabase(id) {
  return useQuery({
    queryKey: dbKeys.schema(id),
    queryFn: () => /** @type {Promise<DatabaseSchema>} */ (api(`/databases/${id}`)),
  });
}

/**
 * Rows for a view, a page at a time; filtering and sorting happen on the server.
 * @param {string} id
 * @param {RowQuery} q
 */
export function useRows(id, q) {
  const limit = q.limit ?? 50;
  return useInfiniteQuery({
    queryKey: dbKeys.query(id, q),
    queryFn: ({ pageParam }) =>
      /** @type {Promise<RowPage>} */ (
        api(`/databases/${id}/query`, {
          method: 'POST',
          body: { sorts: q.sorts, filters: q.filters, group: q.group, limit, offset: pageParam, tzOffset: new Date().getTimezoneOffset() },
        })
      ),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.rows.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
    // Keep showing the old rows while a new sort/filter loads.
    placeholderData: (prev) => prev,
  });
}

/**
 * Patch one row in every cached row list and in its page detail (row page).
 * @param {import('@tanstack/react-query').QueryClient} qc
 * @param {string} dbId
 * @param {string} rowId
 * @param {(row: Row) => Row} fn
 */
function patchCachedRow(qc, dbId, rowId, fn) {
  qc.setQueriesData({ queryKey: dbKeys.rows(dbId) }, (/** @type {{ pages: RowPage[], pageParams: unknown[] } | undefined} */ data) =>
    data && { ...data, pages: data.pages.map((p) => ({ ...p, rows: p.rows.map((r) => (r.id === rowId ? fn(r) : r)) })) },
  );
}

/** @param {string} dbId */
export function useDatabaseMutations(dbId) {
  const qc = useQueryClient();
  const refreshSchema = () => qc.invalidateQueries({ queryKey: dbKeys.schema(dbId) });
  const refreshRows = () => qc.invalidateQueries({ queryKey: dbKeys.rows(dbId) });
  /** @param {(s: DatabaseSchema) => DatabaseSchema} fn */
  const patchSchema = (fn) => qc.setQueryData(dbKeys.schema(dbId), (/** @type {DatabaseSchema | undefined} */ s) => s && fn(s));

  return {
    /** @param {{ name: string, type: string, config?: object, afterId?: string }} body */
    addProperty: async (body) => {
      const prop = /** @type {Property} */ (await api(`/databases/${dbId}/properties`, { method: 'POST', body }));
      patchSchema((s) => ({ ...s, properties: [...s.properties, prop].sort((a, b) => (a.order < b.order ? -1 : 1)) }));
      return prop;
    },

    /** @param {string} propId @param {{ name?: string, type?: string, config?: object, beforeId?: string, afterId?: string }} body */
    updateProperty: async (propId, body) => {
      const prop = /** @type {Property} */ (await api(`/databases/${dbId}/properties/${propId}`, { method: 'PATCH', body }));
      patchSchema((s) => ({ ...s, properties: s.properties.map((p) => (p.id === propId ? prop : p)).sort((a, b) => (a.order < b.order ? -1 : 1)) }));
      // Type and option changes rewrite values (and views) on the server.
      if (body.type || body.config) {
        refreshRows();
        refreshSchema();
        qc.invalidateQueries({ queryKey: pageKeys.all });
      }
      return prop;
    },

    /** @param {string} propId */
    deleteProperty: async (propId) => {
      patchSchema((s) => ({ ...s, properties: s.properties.filter((p) => p.id !== propId) }));
      await api(`/databases/${dbId}/properties/${propId}`, { method: 'DELETE' });
      refreshSchema();
      refreshRows();
    },

    /** @param {{ name: string, type: 'table' | 'board', config?: Partial<ViewConfig> }} body */
    addView: async (body) => {
      const view = /** @type {View} */ (await api(`/databases/${dbId}/views`, { method: 'POST', body }));
      patchSchema((s) => ({ ...s, views: [...s.views, view] }));
      return view;
    },

    /** Optimistic: the view re-queries with its new sorts/filters right away. @param {View} view @param {{ name?: string, type?: string, config?: ViewConfig }} patch */
    updateView: (view, patch) => {
      patchSchema((s) => ({ ...s, views: s.views.map((v) => (v.id === view.id ? /** @type {View} */ ({ ...v, ...patch }) : v)) }));
      return api(`/databases/${dbId}/views/${view.id}`, { method: 'PATCH', body: patch }).catch(refreshSchema);
    },

    /** @param {string} viewId */
    deleteView: async (viewId) => {
      await api(`/databases/${dbId}/views/${viewId}`, { method: 'DELETE' });
      patchSchema((s) => ({ ...s, views: s.views.filter((v) => v.id !== viewId) }));
    },

    /**
     * A new row — blank, or a copy of a template (`templateId`).
     * @param {{ title?: string, props?: Record<string, unknown>, beforeId?: string, afterId?: string, templateId?: string | null }} [body]
     */
    addRow: async ({ templateId, ...body } = {}) => {
      const row = /** @type {Row} */ (
        await api(`/databases/${dbId}/rows`, { method: 'POST', body: templateId ? { ...body, templateId, today: today() } : body })
      );
      await refreshRows();
      return row;
    },

    /** A new, empty row template (open it to fill it in). */
    addTemplate: async () => {
      const t = /** @type {Row} */ (await api(`/databases/${dbId}/templates`, { method: 'POST' }));
      refreshSchema();
      return t;
    },

    /** @param {string} id */
    deleteTemplate: async (id) => {
      patchSchema((s) => ({ ...s, templates: s.templates.filter((t) => t.id !== id) }));
      await api(`/pages/${id}`, { method: 'DELETE' });
      refreshSchema();
    },

    /**
     * Set values on a row (null clears). Optimistic in every list; the lists
     * re-query afterwards, since a sort or filter may now place it elsewhere.
     * @param {string} rowId @param {Record<string, unknown>} values
     */
    setProps: async (rowId, values) => {
      patchCachedRow(qc, dbId, rowId, (r) => ({ ...r, props: withValues(r.props, values) }));
      qc.setQueryData(pageKeys.detail(rowId), (/** @type {any} */ d) => d && { ...d, props: withValues(d.props ?? {}, values) });
      try {
        await api(`/pages/${rowId}/props`, { method: 'PATCH', body: values });
      } finally {
        refreshRows();
      }
    },

    /** @param {string} rowId @param {string} title */
    renameRow: async (rowId, title) => {
      patchCachedRow(qc, dbId, rowId, (r) => ({ ...r, title, titleContent: null }));
      await api(`/pages/${rowId}`, { method: 'PATCH', body: { title } });
      qc.invalidateQueries({ queryKey: pageKeys.detail(rowId) });
    },

    /** @param {string} rowId @param {{ beforeId?: string, afterId?: string }} where */
    moveRow: async (rowId, where) => {
      await api(`/databases/${dbId}/rows/${rowId}/move`, { method: 'POST', body: where });
      refreshRows();
    },

    /** @param {string} rowId */
    deleteRow: async (rowId) => {
      await api(`/pages/${rowId}`, { method: 'DELETE' });
      refreshRows();
    },
  };
}

/** @param {Record<string, unknown>} props @param {Record<string, unknown>} values */
function withValues(props, values) {
  const next = { ...props };
  for (const [k, v] of Object.entries(values)) {
    if (v === null || v === false || v === '' || (Array.isArray(v) && v.length === 0)) delete next[k];
    else next[k] = v;
  }
  return next;
}
