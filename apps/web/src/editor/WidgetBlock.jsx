import { mergeAttributes, Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';

/**
 * A live widget in a page (made for Home): `{ type: 'widgetBlock', attrs: { id, indent, kind } }`.
 * `kind` is 'greeting' (hello + today's date), 'recent' (recently opened pages)
 * or 'favorites' (starred pages). The widget itself comes in through options,
 * so the node works headless (tests).
 */

/** @typedef {'greeting' | 'recent' | 'favorites' | 'reminders'} WidgetKind */
/**
 * @typedef {{
 *   View: import('react').ComponentType<{ kind: WidgetKind, onOpenPage: (id: string) => void }> | null,
 *   openPage: ((pageId: string) => void) | null,
 * }} WidgetBlockOptions
 */

export const WIDGET_LABELS = /** @type {Record<WidgetKind, string>} */ ({ greeting: 'Greeting', recent: 'Recent pages', favorites: 'Favourites', reminders: 'Reminders' });

/** The id + indent attrs every block node carries (see schema.js). */
export const blockAttrs = () => ({
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
});

export const WidgetBlock = Node.create({
  name: 'widgetBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  /** @returns {WidgetBlockOptions} */
  addOptions: () => ({ View: null, openPage: null }),

  addAttributes: () => ({
    ...blockAttrs(),
    kind: {
      default: 'greeting',
      parseHTML: (/** @type {HTMLElement} */ el) => el.getAttribute('data-kind') ?? 'greeting',
      renderHTML: (/** @type {Record<string, any>} */ a) => ({ 'data-kind': a.kind }),
    },
  }),

  parseHTML: () => [{ tag: 'div.pb[data-type="widgetBlock"]' }],

  renderHTML: ({ node, HTMLAttributes }) => [
    'div',
    mergeAttributes({ class: 'pb', 'data-type': 'widgetBlock' }, HTMLAttributes),
    ['div', { class: 'pb-c pb-widget' }, WIDGET_LABELS[/** @type {WidgetKind} */ (node.attrs.kind)] ?? 'Widget'],
  ],

  renderText: () => '',

  addNodeView() {
    return ReactNodeViewRenderer(WidgetBlockView, {
      className: 'pb',
      attrs: ({ node }) => ({
        'data-type': 'widgetBlock',
        'data-id': node.attrs.id ?? '',
        'data-indent': String(node.attrs.indent),
        'data-kind': node.attrs.kind,
        style: `--indent:${node.attrs.indent}`,
      }),
      // Its links are its own; block drags from the side menu still pass.
      stopEvent: ({ event }) => !(event instanceof DragEvent),
      ignoreMutation: () => true,
    });
  },
});

/** @param {import('@tiptap/react').ReactNodeViewProps} props */
function WidgetBlockView({ node, extension }) {
  const { View, openPage } = /** @type {WidgetBlockOptions} */ (extension.options);
  const kind = /** @type {WidgetKind} */ (node.attrs.kind);
  return (
    <NodeViewWrapper>
      <div className="pb-c pb-widget" contentEditable={false}>
        {View ? <View kind={kind} onOpenPage={(id) => openPage?.(id)} /> : <span className="text-faint">{WIDGET_LABELS[kind] ?? 'Widget'}</span>}
      </div>
    </NodeViewWrapper>
  );
}
