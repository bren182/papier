import { blockAt, insertBlockAfter, setBlockType } from './blockOps.js';
import { dateSuggestions } from './dates.js';

/** @typedef {import('./SuggestionMenu.jsx').MenuItem} MenuItem */
/** @typedef {import('@tiptap/core').Editor} Editor */
/** @typedef {import('@tiptap/core').Range} Range */

/**
 * Turn the block holding the `/query` into `typeName`. If the block had other
 * text, the new block goes below it instead (Notion does the same).
 * @param {string} typeName @param {Record<string, any>} [attrs]
 * @returns {MenuItem['run']}
 */
const turnInto = (typeName, attrs = {}) => (editor, range) => {
  const { state } = editor;
  const tr = state.tr.delete(range.from, range.to);
  const block = blockAt(tr.doc, range.from);
  if (!block) return;
  const type = /** @type {any} */ (state.schema.nodes[typeName]);
  if (block.node.content.size === 0 || block.node.type.name === 'divider') {
    setBlockType(tr, block.pos, type, attrs);
    if (typeName === 'divider') insertBlockAfter(tr, block.pos, 'paragraph');
  } else {
    const at = insertBlockAfter(tr, block.pos, typeName, attrs);
    if (typeName === 'divider') insertBlockAfter(tr, at, 'paragraph');
  }
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
};

/**
 * The block types, in menu order. Shared by the `/` menu and the side menu's
 * "Turn into".
 * @type {{ title: string, icon: string, aliases: string[], type: string, attrs?: Record<string, any> }[]}
 */
export const BLOCK_TYPES = [
  { title: 'Text', icon: 'T', aliases: ['paragraph', 'plain'], type: 'paragraph' },
  { title: 'Heading 1', icon: 'H1', aliases: ['h1', 'title'], type: 'heading', attrs: { level: 1 } },
  { title: 'Heading 2', icon: 'H2', aliases: ['h2', 'subtitle'], type: 'heading', attrs: { level: 2 } },
  { title: 'Heading 3', icon: 'H3', aliases: ['h3'], type: 'heading', attrs: { level: 3 } },
  { title: 'Bulleted list', icon: '•', aliases: ['ul', 'bullet', 'list'], type: 'bulletItem' },
  { title: 'Numbered list', icon: '1.', aliases: ['ol', 'number', 'ordered'], type: 'numberedItem' },
  { title: 'To-do list', icon: '☐', aliases: ['todo', 'task', 'check', 'checkbox'], type: 'todo' },
  { title: 'Quote', icon: '❝', aliases: ['blockquote', 'citation'], type: 'quote' },
  { title: 'Code', icon: '</>', aliases: ['codeblock', 'snippet', 'pre'], type: 'codeBlock' },
  { title: 'Divider', icon: '—', aliases: ['hr', 'line', 'separator', 'rule'], type: 'divider' },
];

/** @type {MenuItem[]} */
const BLOCK_ITEMS = BLOCK_TYPES.map(({ type, attrs, ...item }) => ({ ...item, group: 'Blocks', run: turnInto(type, attrs) }));

/** Slash-menu extras. */
/** @type {MenuItem[]} */
const INLINE_ITEMS = [
  {
    title: 'Date',
    icon: '@',
    aliases: ['today', 'mention', 'when', 'day'],
    group: 'Inline',
    subtext: 'Today, 2 days ago, next fri…',
    run: (editor, range) => editor.chain().focus().deleteRange(range).insertContent('@').run(),
  },
];

/**
 * `/` menu: block types, matched on title or alias prefix/substring.
 * @param {string} query
 */
export function slashItems(query) {
  const q = query.toLowerCase().trim();
  const all = [...BLOCK_ITEMS, ...INLINE_ITEMS];
  if (!q) return all;
  return all.filter((item) => item.title.toLowerCase().includes(q) || item.aliases?.some((a) => a.startsWith(q)));
}

/**
 * `@` menu: dates parsed from what's typed.
 * @param {string} query
 * @returns {MenuItem[]}
 */
export function dateItems(query) {
  return dateSuggestions(query).map(({ title, date, subtext }) => ({
    title,
    subtext,
    group: 'Date',
    icon: '@',
    run: (editor, range) =>
      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          { type: 'date', attrs: { date } },
          { type: 'text', text: ' ' },
        ])
        .run(),
  }));
}
