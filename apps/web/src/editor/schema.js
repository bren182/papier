import { Extension, mergeAttributes, Node } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
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
export const BLOCK_NODES = [Paragraph, Heading, BulletItem, NumberedItem, Todo, Quote, CodeBlock, Divider];

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

export { Text };
