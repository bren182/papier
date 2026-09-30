import { createContext, useContext } from 'react';

/**
 * What every part of one database view needs: the schema, the active view,
 * and the mutations.
 * @typedef {import('../../api/databases.js').Property} Property
 * @typedef {import('../../api/databases.js').View} View
 * @typedef {import('../../api/databases.js').ViewConfig} ViewConfig
 * @typedef {{
 *   dbId: string,
 *   properties: Property[],
 *   templates: import('../../api/databases.js').RowTemplate[],
 *   view: View,
 *   m: ReturnType<typeof import('../../api/databases.js').useDatabaseMutations>,
 *   setConfig: (patch: Partial<ViewConfig>) => void,
 *   addOption: (prop: Property, name: string) => Promise<string | undefined>,
 *   openRow: (id: string) => void,
 *   inline: boolean,
 * }} DbContext
 */

/** Drags that start inside a database view (rows, cards, columns) carry this type, so an
 * inline database's node view keeps them from ProseMirror. */
export const DB_DRAG_TYPE = 'application/x-papier-db';

export const DbCtx = createContext(/** @type {DbContext | null} */ (null));

export function useDb() {
  const ctx = useContext(DbCtx);
  if (!ctx) throw new Error('useDb outside a database view');
  return ctx;
}

/**
 * The template "New" uses in this view, if it still exists.
 * @param {View} view @param {{ id: string }[]} templates
 */
export function defaultTemplate(view, templates) {
  const id = view.config.template;
  return id && templates.some((t) => t.id === id) ? id : null;
}

/** Title is a pseudo-property: always first, can't be hidden or deleted. */
export const TITLE = /** @type {Property} */ ({ id: 'title', name: 'Name', type: 'title', config: {}, order: '' });

/**
 * The view's visible properties in display order (title excluded).
 * @param {Property[]} properties
 * @param {ViewConfig} config
 */
export function visibleColumns(properties, config) {
  return orderedProperties(properties, config).filter((p) => !config.hidden.includes(p.id));
}

/**
 * All properties in the view's column order.
 * @param {Property[]} properties
 * @param {ViewConfig} config
 */
export function orderedProperties(properties, config) {
  const byId = new Map(properties.map((p) => [p.id, p]));
  const listed = config.propOrder.flatMap((id) => byId.get(id) ?? []);
  return [...listed, ...properties.filter((p) => !config.propOrder.includes(p.id))];
}
