import { mergeAttributes, Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { DB_DRAG_TYPE } from '../components/database/context.js';
import { blockAttrs } from './WidgetBlock.jsx';

/**
 * A view of a database that lives somewhere else:
 * `{ type: 'linkedDatabase', attrs: { id, indent, databaseId, view } }`.
 * Unlike an inline database block it owns nothing (deleting it trashes
 * nothing), and its view (`{ type, config }`: sorts, filters, hidden, …) is its
 * own — never a tab of the database, never changing the database's views.
 * With no `databaseId` yet it offers a picker. The view comes in through
 * options, so the node works headless (tests).
 */

/** @typedef {{ type: string, config: import('../api/databases.js').ViewConfig }} LinkedView */
/**
 * @typedef {{
 *   View: import('react').ComponentType<{ databaseId: string | null, view: LinkedView | null,
 *     onChange: (patch: { databaseId?: string | null, view?: LinkedView | null }) => void, onOpenPage: (id: string) => void }> | null,
 *   openPage: ((pageId: string) => void) | null,
 * }} LinkedDatabaseOptions
 */

/** @param {HTMLElement} el */
const parseView = (el) => {
  try {
    return JSON.parse(el.getAttribute('data-view') ?? 'null');
  } catch {
    return null;
  }
};

export const LinkedDatabaseBlock = Node.create({
  name: 'linkedDatabase',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  /** @returns {LinkedDatabaseOptions} */
  addOptions: () => ({ View: null, openPage: null }),

  addAttributes: () => ({
    ...blockAttrs(),
    databaseId: {
      default: null,
      parseHTML: (/** @type {HTMLElement} */ el) => el.getAttribute('data-database-id'),
      renderHTML: (/** @type {Record<string, any>} */ a) => (a.databaseId ? { 'data-database-id': a.databaseId } : {}),
    },
    view: {
      default: null,
      parseHTML: parseView,
      renderHTML: (/** @type {Record<string, any>} */ a) => (a.view ? { 'data-view': JSON.stringify(a.view) } : {}),
    },
  }),

  parseHTML: () => [{ tag: 'div.pb[data-type="linkedDatabase"]' }],

  renderHTML: ({ HTMLAttributes }) => [
    'div',
    mergeAttributes({ class: 'pb', 'data-type': 'linkedDatabase' }, HTMLAttributes),
    ['div', { class: 'pb-c pb-database' }, 'Linked database'],
  ],

  renderText: () => '',

  addNodeView() {
    return ReactNodeViewRenderer(LinkedDatabaseView, {
      className: 'pb',
      attrs: ({ node }) => ({
        'data-type': 'linkedDatabase',
        'data-id': node.attrs.id ?? '',
        'data-indent': String(node.attrs.indent),
        style: `--indent:${node.attrs.indent}`,
      }),
      // Like an inline database: the view is its own little app.
      stopEvent: ({ event }) => {
        if (event instanceof DragEvent) return Boolean(event.dataTransfer?.types.includes(DB_DRAG_TYPE));
        return true;
      },
      ignoreMutation: () => true,
    });
  },
});

/** @param {import('@tiptap/react').ReactNodeViewProps} props */
function LinkedDatabaseView({ node, updateAttributes, extension }) {
  const { View, openPage } = /** @type {LinkedDatabaseOptions} */ (extension.options);
  const { databaseId, view } = node.attrs;
  return (
    <NodeViewWrapper>
      <div className="pb-c pb-database" contentEditable={false}>
        {View ? (
          <View databaseId={databaseId} view={view} onChange={(patch) => updateAttributes(patch)} onOpenPage={(p) => openPage?.(p)} />
        ) : (
          <span className="text-faint">Linked database</span>
        )}
      </div>
    </NodeViewWrapper>
  );
}
