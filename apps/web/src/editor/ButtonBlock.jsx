import { useRef, useState } from 'react';
import { mergeAttributes, Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';

/**
 * A button in a page: `{ type: 'buttonBlock', attrs: { id, indent, label, actions } }`.
 * Clicking runs its actions on the server (row-less: they add rows to
 * databases). Settings and running come in through options, so the node works
 * headless (tests).
 */

/**
 * @typedef {{ label: string, actions: import('@papier/core/actions').Action[] }} ButtonSettings
 * @typedef {{
 *   Settings: import('react').ComponentType<ButtonSettings & { anchor: HTMLElement | null, onChange: (patch: Partial<ButtonSettings>) => void, onClose: () => void }> | null,
 *   onRun: ((blockId: string) => Promise<unknown> | void) | null,
 * }} ButtonBlockOptions
 */

/** @param {HTMLElement} el */
const parseActions = (el) => {
  try {
    const v = JSON.parse(el.getAttribute('data-actions') ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

export const ButtonBlock = Node.create({
  name: 'buttonBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  /** @returns {ButtonBlockOptions} */
  addOptions: () => ({ Settings: null, onRun: null }),

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
    // Label and actions ride along in copy/paste as data attributes.
    label: {
      default: '',
      parseHTML: (/** @type {HTMLElement} */ el) => el.getAttribute('data-label') ?? '',
      renderHTML: (/** @type {Record<string, any>} */ a) => (a.label ? { 'data-label': a.label } : {}),
    },
    actions: {
      default: [],
      parseHTML: parseActions,
      renderHTML: (/** @type {Record<string, any>} */ a) => (a.actions?.length ? { 'data-actions': JSON.stringify(a.actions) } : {}),
    },
  }),

  parseHTML: () => [{ tag: 'div.pb[data-type="buttonBlock"]' }],

  renderHTML: ({ node, HTMLAttributes }) => [
    'div',
    mergeAttributes({ class: 'pb', 'data-type': 'buttonBlock' }, HTMLAttributes),
    ['div', { class: 'pb-c pb-button' }, node.attrs.label || 'Button'],
  ],

  renderText: ({ node }) => node.attrs.label ?? '',

  addNodeView() {
    return ReactNodeViewRenderer(ButtonBlockView, {
      className: 'pb',
      attrs: ({ node }) => ({
        'data-type': 'buttonBlock',
        'data-id': node.attrs.id ?? '',
        'data-indent': String(node.attrs.indent),
        style: `--indent:${node.attrs.indent}`,
      }),
      // Its own clicks and the settings' inputs stay out of ProseMirror; block drags pass.
      stopEvent: ({ event }) => !(event instanceof DragEvent),
      ignoreMutation: () => true,
    });
  },
});

/** @param {import('@tiptap/react').ReactNodeViewProps} props */
function ButtonBlockView({ node, updateAttributes, extension, editor }) {
  const { Settings, onRun } = /** @type {ButtonBlockOptions} */ (extension.options);
  const { id, label, actions } = /** @type {{ id: string | null, label: string, actions: ButtonSettings['actions'] }} */ (node.attrs);
  // A brand-new button opens its settings.
  const [open, setOpen] = useState(!label && !actions.length && editor.isEditable);
  const [busy, setBusy] = useState(false);
  const ref = useRef(/** @type {HTMLButtonElement | null} */ (null));

  const run = async () => {
    if (!actions.length) return setOpen(true);
    if (!id || !onRun || busy) return;
    setBusy(true);
    try {
      await onRun(id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <NodeViewWrapper>
      <div className="pb-c pb-button group/btn flex items-center gap-1 py-0.5" contentEditable={false}>
        <button
          ref={ref}
          type="button"
          onClick={run}
          disabled={busy}
          className="h-8 max-w-full truncate rounded-md border border-line bg-white/[0.06] px-3 text-[14px] text-fg hover:bg-white/[0.12] disabled:opacity-60"
        >
          {label || 'Button'}
        </button>
        {editor.isEditable && (
          <button
            type="button"
            aria-label="Button settings"
            onClick={() => setOpen(true)}
            className="flex size-7 items-center justify-center rounded-md text-muted opacity-0 hover:bg-hover hover:text-fg focus-visible:opacity-100 group-hover/btn:opacity-100"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
            </svg>
          </button>
        )}
        {open && Settings && (
          <Settings anchor={ref.current} label={label} actions={actions} onChange={(patch) => updateAttributes(patch)} onClose={() => setOpen(false)} />
        )}
      </div>
    </NodeViewWrapper>
  );
}
