import { TextSelection } from '@tiptap/pm/state';
import { blockAt, insertBlockAfter, setBlockType, withDescendants } from './blockOps.js';
import { docToRows } from './convert.js';
import { DYNAMIC_TODAY } from '@papier/core/props';
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
  // Atoms (a divider, a button) get an empty line after them to keep typing in.
  const atom = typeName === 'divider' || typeName === 'buttonBlock';
  if (block.node.content.size === 0 || block.node.type.name === 'divider') {
    setBlockType(tr, block.pos, type, attrs);
    if (atom) insertBlockAfter(tr, block.pos, 'paragraph');
  } else {
    const at = insertBlockAfter(tr, block.pos, typeName, attrs);
    if (atom) insertBlockAfter(tr, at, 'paragraph');
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

/**
 * Create a page (or database) and put its block where the `/` was typed:
 * replacing an empty paragraph, else below the current block.
 * @param {Editor} editor @param {Range} range
 * @param {'pageBlock' | 'databaseBlock'} nodeName @param {'page' | 'database'} kind
 * @returns {Promise<string | undefined>} the new page's id
 */
const insertOwnedPage = async (editor, range, nodeName, kind) => {
  const opts = /** @type {import('./PageBlock.js').PageBlockOptions | undefined} */ (
    editor.extensionManager.extensions.find((e) => e.name === 'pageBlock')?.options
  );
  if (!opts?.createPage) return;
  editor.view.dispatch(editor.state.tr.delete(range.from, range.to));
  const pageId = await opts.createPage(kind);
  if (editor.isDestroyed) return;

  const { state } = editor;
  const block = blockAt(state.doc, state.selection.from);
  if (!block) return;
  const tr = state.tr;
  const type = state.schema.nodes[nodeName];
  const indent = block.node.attrs.indent;
  let at = block.pos;
  if (block.node.type.name === 'paragraph' && block.node.content.size === 0) {
    tr.replaceWith(block.pos, block.pos + block.node.nodeSize, type.create({ id: block.node.attrs.id, indent, pageId }));
  } else {
    at = block.pos + block.node.nodeSize;
    tr.insert(at, type.create({ indent, pageId }));
  }
  if (nodeName === 'databaseBlock') {
    // Keep writing below it (a selected database would be one Backspace from the trash).
    const after = at + /** @type {import('@tiptap/pm/model').Node} */ (tr.doc.nodeAt(at)).nodeSize;
    tr.insert(after, state.schema.nodes.paragraph.create({ indent }));
    tr.setSelection(TextSelection.create(tr.doc, after + 1));
  }
  editor.view.dispatch(tr.scrollIntoView());
  return pageId;
};

/**
 * Turn a block into a sub-page, as Notion does: its text becomes the page's
 * title, its nested blocks become the page's content, and a page block takes
 * its place. (Rich bits of the title, like date mentions, become plain text.)
 * @param {Editor} editor @param {number} index
 */
export async function turnIntoPage(editor, index) {
  const opts = /** @type {import('./PageBlock.js').PageBlockOptions | undefined} */ (
    editor.extensionManager.extensions.find((e) => e.name === 'pageBlock')?.options
  );
  if (!opts?.createPage || !opts.saveContent) return;
  const { doc } = editor.state;
  const node = doc.child(index);
  const blockId = node.attrs.id;
  const end = withDescendants(doc, index, index);
  const base = node.attrs.indent + 1;
  // Nested blocks move with fresh ids: ids are unique per page.
  const children = [];
  for (let i = index + 1; i <= end; i++) {
    const json = doc.child(i).toJSON();
    json.attrs = { ...json.attrs, id: crypto.randomUUID(), indent: json.attrs.indent - base };
    children.push(json);
  }

  const pageId = await opts.createPage('page', node.textContent.trim().slice(0, 500));
  if (children.length) await opts.saveContent(pageId, docToRows({ type: 'doc', content: children }, new Map()));
  if (editor.isDestroyed) return;

  // The document may have changed while we waited: find the block again by id.
  const now = editor.state.doc;
  let at = -1;
  now.forEach((n, _offset, i) => {
    if (n.attrs.id === blockId) at = i;
  });
  if (at < 0) return;
  let from = 0;
  for (let i = 0; i < at; i++) from += now.child(i).nodeSize;
  let to = from;
  for (let i = at; i <= withDescendants(now, at, at); i++) to += now.child(i).nodeSize;
  const tr = editor.state.tr.replaceWith(from, to, editor.schema.nodes.pageBlock.create({ id: blockId, indent: node.attrs.indent, pageId }));
  editor.view.dispatch(tr.scrollIntoView());
}

/** A new sub-page, as a block where the `/page` was typed; then open it. @type {MenuItem['run']} */
const newSubPage = async (editor, range) => {
  const pageId = await insertOwnedPage(editor, range, 'pageBlock', 'page');
  if (pageId) openPageOf(editor)?.(pageId);
};

/** A full-page database inside this page: a page block pointing at it; then open it. @type {MenuItem['run']} */
const newDatabasePage = async (editor, range) => {
  const pageId = await insertOwnedPage(editor, range, 'pageBlock', 'database');
  if (pageId) openPageOf(editor)?.(pageId);
};

/** An inline database, right here in the content. @type {MenuItem['run']} */
const newInlineDatabase = (editor, range) => insertOwnedPage(editor, range, 'databaseBlock', 'database');

/** @param {Editor} editor */
const openPageOf = (editor) =>
  /** @type {import('./PageBlock.js').PageBlockOptions | undefined} */ (editor.extensionManager.extensions.find((e) => e.name === 'pageBlock')?.options)
    ?.openPage;

/** Slash-menu extras. */
/** @type {MenuItem[]} */
const PAGE_ITEMS = [
  { title: 'Page', icon: '▤', aliases: ['subpage', 'new page', 'child'], group: 'Pages', subtext: 'A sub-page inside this one', run: newSubPage },
  { title: 'Database', icon: '▦', aliases: ['table', 'inline database', 'board', 'kanban'], group: 'Pages', subtext: 'A table or board, right here', run: newInlineDatabase },
  { title: 'Database page', icon: '▦', aliases: ['full page database', 'table page'], group: 'Pages', subtext: 'A database as a sub-page', run: newDatabasePage },
  { title: 'Button', icon: '⏵', aliases: ['action', 'automation', 'log'], group: 'Pages', subtext: 'Adds rows to a database in one click', run: turnInto('buttonBlock') },
];

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
  const all = [...BLOCK_ITEMS, ...PAGE_ITEMS, ...INLINE_ITEMS];
  if (!q) return all;
  return all.filter((item) => item.title.toLowerCase().includes(q) || item.aliases?.some((a) => a.startsWith(q)));
}

/** Whether this editor edits a template (see TemplateMode). @param {Editor} editor */
const isTemplateEditor = (editor) => Boolean(editor.extensionManager.extensions.find((e) => e.name === 'templateMode')?.options.enabled);

/**
 * `@` menu: dates parsed from what's typed — plus, in a template, "Today ↻",
 * which stays dynamic and becomes the day the template is used.
 * @param {string} query
 * @param {Editor} [editor]
 * @returns {MenuItem[]}
 */
export function dateItems(query, editor) {
  const q = query.trim().toLowerCase();
  const dynamic =
    editor && isTemplateEditor(editor) && (!q || 'today'.startsWith(q) || 'dynamic'.startsWith(q))
      ? [{ title: 'Today ↻', date: DYNAMIC_TODAY, subtext: 'The day a page is made from this template' }]
      : [];
  return [...dynamic, ...dateSuggestions(query)].map(({ title, date, subtext }) => ({
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
