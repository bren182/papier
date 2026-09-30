import { mergeAttributes, Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { DB_DRAG_TYPE } from '../components/database/context.js';

/**
 * An inline database: `{ type: 'databaseBlock', attrs: { id, indent, pageId, viewId } }`.
 * The block owns its database page like a page block owns its sub-page —
 * deleting it trashes the database, undo restores it (apps/server/src/db/pageTree.ts).
 * `viewId` remembers which of the database's views this block shows.
 *
 * The view itself comes in through options, so the node works headless (tests).
 */

/**
 * @typedef {{
 *   View: import('react').ComponentType<{ databaseId: string, viewId: string | null, onViewChange: (id: string) => void, onOpenPage: (id: string) => void }> | null,
 *   openPage: ((pageId: string) => void) | null,
 * }} DatabaseBlockOptions
 */

export const DatabaseBlock = Node.create({
  name: 'databaseBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  /** @returns {DatabaseBlockOptions} */
  addOptions: () => ({ View: null, openPage: null }),

  addAttributes: () => ({
    id: {
      default: null,
      keepOnSplit: false,
      parseHTML: (/** @type {HTMLElement} */ el) => el.getAttribute('data-id'),
      renderHTML: (/** @type {Record<string, any>} */ a) => (a.id ? { 'data-id': a.id } : {}),
    },
    indent: {
      default: 0,
      parseHTML: (/** @type {HTMLElement} */ el) => Number(el.getAttribute('data-indent')) || 0,
      renderHTML: (/** @type {Record<string, any>} */ a) => ({ 'data-indent': a.indent, style: `--indent:${a.indent}` }),
    },
    pageId: {
      default: null,
      parseHTML: (/** @type {HTMLElement} */ el) => el.getAttribute('data-page-id'),
      renderHTML: (/** @type {Record<string, any>} */ a) => (a.pageId ? { 'data-page-id': a.pageId } : {}),
    },
    viewId: {
      default: null,
      parseHTML: (/** @type {HTMLElement} */ el) => el.getAttribute('data-view-id'),
      renderHTML: (/** @type {Record<string, any>} */ a) => (a.viewId ? { 'data-view-id': a.viewId } : {}),
    },
  }),

  parseHTML: () => [{ tag: 'div.pb[data-type="databaseBlock"]' }],

  renderHTML: ({ HTMLAttributes }) => [
    'div',
    mergeAttributes({ class: 'pb', 'data-type': 'databaseBlock' }, HTMLAttributes),
    ['div', { class: 'pb-c pb-database' }, 'Database'],
  ],

  renderText: () => '',

  addNodeView() {
    return ReactNodeViewRenderer(DatabaseBlockView, {
      // The outer element is the block (a direct child of the editor, like every
      // other block), so it carries the .pb class and data attributes.
      className: 'pb',
      attrs: ({ node }) => ({
        'data-type': 'databaseBlock',
        'data-id': node.attrs.id ?? '',
        'data-indent': String(node.attrs.indent),
        'data-page-id': node.attrs.pageId ?? '',
        style: `--indent:${node.attrs.indent}`,
      }),
      // The view is its own little app: ProseMirror keeps out of its clicks,
      // keys and inputs. Block drags from the side menu still pass through.
      stopEvent: ({ event }) => {
        if (event instanceof DragEvent) return Boolean(event.dataTransfer?.types.includes(DB_DRAG_TYPE));
        return true;
      },
      ignoreMutation: () => true,
    });
  },
});

/** @param {import('@tiptap/react').ReactNodeViewProps} props */
function DatabaseBlockView({ node, updateAttributes, extension }) {
  const { View, openPage } = /** @type {DatabaseBlockOptions} */ (extension.options);
  const { pageId, viewId } = node.attrs;
  return (
    <NodeViewWrapper>
      <div className="pb-c pb-database" contentEditable={false}>
        {View && pageId ? (
          <View databaseId={pageId} viewId={viewId} onViewChange={(v) => updateAttributes({ viewId: v })} onOpenPage={(p) => openPage?.(p)} />
        ) : (
          <span className="text-faint">Database</span>
        )}
      </div>
    </NodeViewWrapper>
  );
}
