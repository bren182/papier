import { Extension, mergeAttributes, Node } from '@tiptap/core';
import { Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';

/**
 * Papier's editor schema. The document is a *flat* list of blocks; nesting is
 * the `indent` attribute (0 = top level). Storage turns indentation back into
 * a tree (see convert.js). Keeping ProseMirror flat means Enter/Backspace/join
 * work on plain textblocks, and a block plus its children is always one
 * contiguous range (drag, delete, duplicate).
 *
 * Every block renders as <div class="pb" data-type=… data-indent=…>; the CSS in
 * index.css draws markers and indentation from those.
 */

/** Indent step in rem — keep in sync with `.pb` in index.css. */
export const INDENT_REM = 1.5;
export const MAX_INDENT = 12;

/** Attributes every block carries. */
const blockAttrs = {
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
};

/**
 * A block node: outer `.pb` wrapper, optional inner element holding the content.
 * @param {{ name: string, inner?: string | ((node: import('@tiptap/pm/model').Node) => string), attrs?: Record<string, any>, parse: import('@tiptap/core').NodeConfig['parseHTML'], extra?: Partial<import('@tiptap/core').NodeConfig> }} spec
 */
function blockNode({ name, inner = 'div', attrs = {}, parse, extra = {} }) {
  return Node.create({
    name,
    group: 'block',
    content: 'inline*',
    defining: true,
    addAttributes: () => ({ ...blockAttrs, ...attrs }),
    parseHTML: parse,
    renderHTML: ({ node, HTMLAttributes }) => {
      const tag = typeof inner === 'function' ? inner(node) : inner;
      return ['div', mergeAttributes({ class: 'pb', 'data-type': name }, HTMLAttributes), [tag, { class: 'pb-c' }, 0]];
    },
    ...extra,
  });
}

export const PapierDocument = Document.extend({ content: 'block+' });

export const Paragraph = blockNode({
  name: 'paragraph',
  parse: () => [{ tag: 'p' }, { tag: 'div.pb[data-type="paragraph"]' }],
});

export const Heading = blockNode({
  name: 'heading',
  inner: (node) => `h${node.attrs.level}`,
  attrs: {
    level: {
      default: 1,
      renderHTML: (/** @type {Record<string, any>} */ a) => ({ 'data-level': a.level }),
      parseHTML: (/** @type {HTMLElement} */ el) => Number(el.getAttribute('data-level')) || 1,
    },
  },
  parse: () => [
    { tag: 'h1', attrs: { level: 1 } },
    { tag: 'h2', attrs: { level: 2 } },
    { tag: 'h3', attrs: { level: 3 } },
    { tag: 'h4', attrs: { level: 3 } },
    { tag: 'div.pb[data-type="heading"]' },
  ],
});

export const BulletItem = blockNode({
  name: 'bulletItem',
  parse: () => [{ tag: 'ul > li' }, { tag: 'div.pb[data-type="bulletItem"]' }],
});

export const NumberedItem = blockNode({
  name: 'numberedItem',
  parse: () => [{ tag: 'ol > li' }, { tag: 'div.pb[data-type="numberedItem"]' }],
});

export const Quote = blockNode({
  name: 'quote',
  inner: 'blockquote',
  parse: () => [{ tag: 'blockquote' }, { tag: 'div.pb[data-type="quote"]' }],
});

/** To-do: a real checkbox beside the text, toggled without moving the cursor. */
export const Todo = blockNode({
  name: 'todo',
  attrs: {
    checked: {
      default: false,
      keepOnSplit: false,
      renderHTML: (/** @type {Record<string, any>} */ a) => ({ 'data-checked': a.checked ? 'true' : 'false' }),
      parseHTML: (/** @type {HTMLElement} */ el) => el.getAttribute('data-checked') === 'true',
    },
  },
  parse: () => [{ tag: 'div.pb[data-type="todo"]' }],
  extra: {
    addNodeView() {
      return ({ node, getPos, editor }) => {
        const dom = document.createElement('div');
        dom.className = 'pb';
        dom.dataset.type = 'todo';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.className = 'pb-check';
        box.contentEditable = 'false';
        box.tabIndex = -1;
        box.addEventListener('mousedown', (e) => e.preventDefault()); // keep the text cursor where it is
        box.addEventListener('change', () => {
          const pos = typeof getPos === 'function' ? getPos() : undefined;
          if (pos === undefined || !editor.isEditable) return;
          const current = editor.state.doc.nodeAt(pos);
          if (current) editor.view.dispatch(editor.state.tr.setNodeAttribute(pos, 'checked', !current.attrs.checked));
        });
        const contentDOM = document.createElement('div');
        contentDOM.className = 'pb-c';
        dom.append(box, contentDOM);

        /** @param {import('@tiptap/pm/model').Node} n */
        const sync = (n) => {
          dom.dataset.checked = n.attrs.checked ? 'true' : 'false';
          dom.dataset.indent = String(n.attrs.indent);
          dom.style.setProperty('--indent', String(n.attrs.indent));
          if (n.attrs.id) dom.dataset.id = n.attrs.id;
          box.checked = Boolean(n.attrs.checked);
        };
        sync(node);

        return {
          dom,
          contentDOM,
          update: (n) => {
            if (n.type.name !== 'todo') return false;
            sync(n);
            return true;
          },
          ignoreMutation: (m) => m.type === 'attributes' || m.target === box,
        };
      };
    },
  },
});

/**
 * A block with a control in its lead column that flips or edits one attribute
 * without moving the cursor (the to-do's box, the toggle's arrow, the
 * callout's icon). `sync` mirrors the node onto the DOM.
 * @param {{ name: string, control: HTMLElement, onActivate: (node: import('@tiptap/pm/model').Node, pos: number) => void,
 *   sync: (node: import('@tiptap/pm/model').Node, dom: HTMLElement) => void }} spec
 * @param {{ node: import('@tiptap/pm/model').Node, getPos: (() => number | undefined) | boolean, editor: import('@tiptap/core').Editor }} props
 */
function leadView({ name, control, onActivate, sync }, { node, getPos, editor }) {
  const dom = document.createElement('div');
  dom.className = 'pb';
  dom.dataset.type = name;
  control.contentEditable = 'false';
  control.tabIndex = -1;
  control.addEventListener('mousedown', (e) => e.preventDefault()); // keep the text cursor where it is
  control.addEventListener('click', (e) => {
    e.preventDefault();
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    const current = pos === undefined ? null : editor.state.doc.nodeAt(pos);
    if (current && pos !== undefined && editor.isEditable) onActivate(current, pos);
  });
  const contentDOM = document.createElement('div');
  contentDOM.className = 'pb-c';
  dom.append(control, contentDOM);
  /** @param {import('@tiptap/pm/model').Node} n */
  const draw = (n) => {
    dom.dataset.indent = String(n.attrs.indent);
    dom.style.setProperty('--indent', String(n.attrs.indent));
    if (n.attrs.id) dom.dataset.id = n.attrs.id;
    sync(n, dom);
  };
  draw(node);
  return {
    dom,
    contentDOM,
    update: (/** @type {import('@tiptap/pm/model').Node} */ n) => {
      if (n.type.name !== name) return false;
      draw(n);
      return true;
    },
    ignoreMutation: (/** @type {MutationRecord | { type: 'selection' }} */ m) =>
      m.type === 'attributes' || ('target' in m && control.contains(/** @type {globalThis.Node} */ (m.target))),
  };
}

/**
 * Toggle: a block whose indented children fold away. The arrow flips
 * `collapsed`; the Outline plugin hides the children.
 */
export const Toggle = blockNode({
  name: 'toggle',
  attrs: {
    collapsed: {
      default: false,
      keepOnSplit: false,
      renderHTML: (/** @type {Record<string, any>} */ a) => ({ 'data-collapsed': a.collapsed ? 'true' : 'false' }),
      parseHTML: (/** @type {HTMLElement} */ el) => el.getAttribute('data-collapsed') === 'true',
    },
  },
  parse: () => [{ tag: 'div.pb[data-type="toggle"]' }, { tag: 'details' }],
  extra: {
    addNodeView() {
      return (props) => {
        const arrow = document.createElement('button');
        arrow.type = 'button';
        arrow.className = 'pb-toggle';
        arrow.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l7 6-7 6z" fill="currentColor"/></svg>';
        return leadView(
          {
            name: 'toggle',
            control: arrow,
            onActivate: (n, pos) => props.editor.view.dispatch(props.editor.state.tr.setNodeAttribute(pos, 'collapsed', !n.attrs.collapsed)),
            sync: (n, dom) => {
              dom.dataset.collapsed = n.attrs.collapsed ? 'true' : 'false';
              arrow.setAttribute('aria-label', n.attrs.collapsed ? 'Expand' : 'Collapse');
              arrow.setAttribute('aria-expanded', n.attrs.collapsed ? 'false' : 'true');
            },
          },
          props,
        );
      };
    },
  },
});

/**
 * Callout: a boxed block with an icon; its indented children sit inside the
 * box (the Outline plugin marks them). `pickIcon` (an option) opens the
 * emoji picker; without it the icon can't be changed (headless tests).
 * @typedef {{ pickIcon: ((anchor: HTMLElement, current: string, onPick: (emoji: string) => void) => void) | null }} CalloutOptions
 */
export const Callout = blockNode({
  name: 'callout',
  attrs: {
    icon: {
      default: '💡',
      renderHTML: (/** @type {Record<string, any>} */ a) => ({ 'data-icon': a.icon }),
      parseHTML: (/** @type {HTMLElement} */ el) => el.getAttribute('data-icon') || '💡',
    },
  },
  parse: () => [{ tag: 'div.pb[data-type="callout"]' }, { tag: 'aside' }],
  extra: {
    /** @returns {CalloutOptions} */
    addOptions: () => ({ pickIcon: null }),
    addNodeView() {
      const options = /** @type {CalloutOptions} */ (this.options);
      return (props) => {
        const icon = document.createElement('button');
        icon.type = 'button';
        icon.className = 'pb-callout-icon';
        icon.setAttribute('aria-label', 'Change callout icon');
        return leadView(
          {
            name: 'callout',
            control: icon,
            onActivate: (n) =>
              options.pickIcon?.(icon, n.attrs.icon, (emoji) => {
                // Find it again: the document may have changed while the picker was open.
                const pos = typeof props.getPos === 'function' ? props.getPos() : undefined;
                if (pos !== undefined) props.editor.view.dispatch(props.editor.state.tr.setNodeAttribute(pos, 'icon', emoji));
              }),
            sync: (n) => {
              icon.textContent = n.attrs.icon;
            },
          },
          props,
        );
      };
    },
  },
});

export const CodeBlock = Node.create({
  name: 'codeBlock',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  addAttributes: () => ({
    ...blockAttrs,
    language: {
      default: null,
      renderHTML: (/** @type {Record<string, any>} */ a) => (a.language ? { 'data-language': a.language } : {}),
      parseHTML: (/** @type {HTMLElement} */ el) => el.getAttribute('data-language'),
    },
  }),
  parseHTML: () => [{ tag: 'pre', preserveWhitespace: 'full' }, { tag: 'div.pb[data-type="codeBlock"]', preserveWhitespace: 'full' }],
  renderHTML: ({ HTMLAttributes }) => [
    'div',
    mergeAttributes({ class: 'pb', 'data-type': 'codeBlock' }, HTMLAttributes),
    ['pre', { class: 'pb-c' }, ['code', 0]],
  ],
});

export const Divider = Node.create({
  name: 'divider',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes: () => ({ ...blockAttrs }),
  parseHTML: () => [{ tag: 'hr' }, { tag: 'div.pb[data-type="divider"]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes({ class: 'pb', 'data-type': 'divider' }, HTMLAttributes), ['hr']],
});

/** Block types in slash-menu order. */
export const BLOCK_NODES = [Paragraph, Heading, BulletItem, NumberedItem, Todo, Toggle, Quote, Callout, CodeBlock, Divider];

/** Types a new block continues as after Enter. */
export const CONTINUES = new Set(['bulletItem', 'numberedItem', 'todo']);

// ── tree invariants ───────────────────────────────────────────────────────

const newId = () => crypto.randomUUID();

/**
 * Keeps the flat document a valid tree after every change: the first block is
 * at indent 0, each block is at most one deeper than the one before it, and
 * every block has a unique id (splits copy attrs, pastes and duplicates bring
 * existing ids — the later copy gets a fresh one).
 */
export const TreeInvariants = Extension.create({
  name: 'treeInvariants',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('treeInvariants'),
        appendTransaction: (trs, _old, state) => {
          if (!trs.some((tr) => tr.docChanged) && state.doc.firstChild?.attrs.id) return null;
          const tr = state.tr;
          const seen = new Set();
          let prevIndent = -1;
          state.doc.forEach((node, pos) => {
            const max = Math.min(prevIndent + 1, MAX_INDENT);
            const indent = Math.min(Math.max(0, Number(node.attrs.indent) || 0), max);
            let id = node.attrs.id;
            if (!id || seen.has(id)) id = newId();
            seen.add(id);
            if (indent !== node.attrs.indent || id !== node.attrs.id) {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent, id });
            }
            prevIndent = indent;
          });
          if (!tr.docChanged) return null;
          tr.setMeta('addToHistory', false);
          return tr;
        },
      }),
    ];
  },
});

/**
 * Numbers consecutive numbered items at the same depth (1, 2, 3…), restarting
 * whenever something else interrupts them at that depth. Rendered via data-number.
 */
export const ListNumbering = Extension.create({
  name: 'listNumbering',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('listNumbering'),
        props: {
          decorations: (state) => {
            /** @type {Decoration[]} */
            const decos = [];
            /** @type {number[]} */
            const counters = [];
            state.doc.forEach((node, pos) => {
              const indent = node.attrs.indent ?? 0;
              counters.length = indent + 1; // deeper levels end here
              if (node.type.name === 'numberedItem') {
                counters[indent] = (counters[indent] ?? 0) + 1;
                decos.push(Decoration.node(pos, pos + node.nodeSize, { 'data-number': String(counters[indent]) }));
              } else {
                counters[indent] = 0;
              }
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});

// ── outline: collapsed toggles, callout boxes ────────────────────────────

/**
 * What a collapsed toggle hides: for each, the range of its descendants and
 * the end of its own text (where the cursor goes back to).
 * @param {import('@tiptap/pm/model').Node} doc
 * @returns {{ from: number, to: number, toggleEnd: number }[]}
 */
export function hiddenRanges(doc) {
  /** @type {{ from: number, to: number, toggleEnd: number }[]} */
  const out = [];
  /** @type {{ indent: number, from: number, toggleEnd: number } | null} */
  let open = null;
  doc.forEach((node, pos) => {
    const indent = node.attrs.indent ?? 0;
    if (open && indent > open.indent) return;
    if (open) {
      if (pos > open.from) out.push({ from: open.from, to: pos, toggleEnd: open.toggleEnd });
      open = null;
    }
    if (node.type.name === 'toggle' && node.attrs.collapsed) open = { indent, from: pos + node.nodeSize, toggleEnd: pos + node.nodeSize - 1 };
  });
  // (The callback above reassigns it; tell the checker it may be set.)
  const last = /** @type {{ indent: number, from: number, toggleEnd: number } | null} */ (open);
  if (last && doc.content.size > last.from) out.push({ from: last.from, to: doc.content.size, toggleEnd: last.toggleEnd });
  return out;
}

/**
 * Structure the flat list can't show on its own:
 * - blocks under a collapsed toggle get `pb-hidden` (not shown), and the cursor
 *   skips over them (forward past them, or back to the toggle's text);
 * - blocks under a callout get `in-callout` (+ the callout's depth), so its box
 *   wraps them; the last one closes the box.
 */
export const Outline = Extension.create({
  name: 'outline',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('outline'),
        props: {
          decorations: (state) => {
            /** @type {Decoration[]} */
            const decos = [];
            const hidden = hiddenRanges(state.doc);
            /** @type {{ indent: number, pos: number, size: number, last: { pos: number, size: number } | null }[]} */
            const callouts = [];
            /** @param {{ indent: number, pos: number, size: number, last: { pos: number, size: number } | null }} c */
            const close = (c) => {
              if (!c.last) return;
              decos.push(Decoration.node(c.pos, c.pos + c.size, { class: 'callout-open' }));
              decos.push(Decoration.node(c.last.pos, c.last.pos + c.last.size, { class: 'in-callout-end' }));
            };
            state.doc.forEach((node, pos) => {
              const indent = node.attrs.indent ?? 0;
              if (hidden.some((r) => pos >= r.from && pos < r.to)) {
                decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'pb-hidden' }));
                return;
              }
              while (callouts.length && indent <= /** @type {{ indent: number }} */ (callouts[callouts.length - 1]).indent) close(/** @type {any} */ (callouts.pop()));
              const outer = callouts[0];
              if (outer) {
                decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'in-callout', style: `--callout-indent:${outer.indent}` }));
                for (const c of callouts) c.last = { pos, size: node.nodeSize };
              }
              if (node.type.name === 'callout') callouts.push({ indent, pos, size: node.nodeSize, last: null });
            });
            while (callouts.length) close(/** @type {any} */ (callouts.pop()));
            return DecorationSet.create(state.doc, decos);
          },
        },
        // Arrowing or clicking into a folded block: carry on past it (moving
        // forward), or stop at the end of the toggle's own text (moving back).
        appendTransaction: (trs, oldState, state) => {
          if (!trs.some((tr) => tr.selectionSet || tr.docChanged)) return null;
          const head = state.selection.head;
          const range = hiddenRanges(state.doc).find((r) => head >= r.from && head < r.to);
          if (!range) return null;
          const forward = head >= oldState.selection.head;
          const after = forward && range.to < state.doc.content.size ? Selection.findFrom(state.doc.resolve(range.to), 1, true) : null;
          const target = after ?? TextSelection.create(state.doc, range.toggleEnd);
          return state.tr.setSelection(target).setMeta('addToHistory', false);
        },
      }),
    ];
  },
});

export { Text };
