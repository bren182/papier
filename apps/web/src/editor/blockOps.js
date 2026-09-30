import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { MAX_INDENT } from './schema.js';

/**
 * Block-level operations on the flat document. A "block" is a direct child of
 * the doc; its children are the following blocks with a deeper indent.
 */

/** @typedef {import('@tiptap/pm/state').EditorState} EditorState */
/** @typedef {import('@tiptap/pm/state').Transaction} Transaction */
/** @typedef {import('@tiptap/pm/model').Node} PMNode */
/** @typedef {{ node: PMNode, pos: number, index: number }} BlockAt */

/**
 * Block containing a document position.
 * @param {PMNode} doc @param {number} pos
 * @returns {BlockAt | null}
 */
export function blockAt(doc, pos) {
  const index = doc.resolve(Math.min(Math.max(pos, 0), doc.content.size)).index(0);
  const node = doc.maybeChild(index);
  if (!node) return null;
  let start = 0;
  for (let i = 0; i < index; i++) start += /** @type {PMNode} */ (doc.child(i)).nodeSize;
  return { node, pos: start, index };
}

/** @param {PMNode} doc @param {number} index */
export function posOfIndex(doc, index) {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += /** @type {PMNode} */ (doc.child(i)).nodeSize;
  return pos;
}

/**
 * Indexes [first, last] of the blocks touched by the selection.
 * @param {EditorState} state
 */
export function selectedRange(state) {
  const { from, to } = state.selection;
  const a = blockAt(state.doc, from);
  const b = blockAt(state.doc, Math.max(from, to - (state.selection.empty ? 0 : 1)));
  return { first: a?.index ?? 0, last: Math.max(a?.index ?? 0, b?.index ?? 0) };
}

/**
 * Extends `last` over the descendants of blocks first..last.
 * @param {PMNode} doc @param {number} first @param {number} last
 */
export function withDescendants(doc, first, last) {
  let min = Infinity;
  for (let i = first; i <= last; i++) min = Math.min(min, /** @type {PMNode} */ (doc.child(i)).attrs.indent);
  let end = last;
  while (end + 1 < doc.childCount && /** @type {PMNode} */ (doc.child(end + 1)).attrs.indent > min) end++;
  return end;
}

/**
 * Shift blocks first..last (and their descendants) by `delta` levels. Returns
 * false when that would break the tree (first block deeper than its parent + 1,
 * or anything below 0).
 * @param {Transaction} tr @param {number} first @param {number} last @param {1 | -1} delta
 */
export function shiftIndent(tr, first, last, delta) {
  const doc = tr.doc;
  const end = withDescendants(doc, first, last);
  const head = /** @type {PMNode} */ (doc.child(first));
  if (delta > 0) {
    const prev = first > 0 ? /** @type {PMNode} */ (doc.child(first - 1)) : null;
    if (!prev || head.attrs.indent + 1 > prev.attrs.indent + 1 || head.attrs.indent + 1 > MAX_INDENT) return false;
  } else {
    for (let i = first; i <= last; i++) if (/** @type {PMNode} */ (doc.child(i)).attrs.indent === 0) return false;
  }
  let pos = posOfIndex(doc, first);
  for (let i = first; i <= end; i++) {
    const node = /** @type {PMNode} */ (doc.child(i));
    tr.setNodeAttribute(pos, 'indent', node.attrs.indent + delta);
    pos += node.nodeSize;
  }
  return true;
}

/**
 * Change a block's type in place, keeping its id, indent and (where the new
 * type allows it) its text.
 * @param {Transaction} tr @param {number} pos @param {import('@tiptap/pm/model').NodeType} type @param {Record<string, any>} [attrs]
 */
export function setBlockType(tr, pos, type, attrs = {}) {
  const node = /** @type {PMNode} */ (tr.doc.nodeAt(pos));
  const base = { id: node.attrs.id, indent: node.attrs.indent };
  if (type.name === 'divider') {
    tr.replaceWith(pos, pos + node.nodeSize, type.create(base));
    return;
  }
  if (node.type.name === 'divider') {
    tr.replaceWith(pos, pos + node.nodeSize, type.create({ ...base, ...attrs }));
    return;
  }
  // Into or out of code: carry plain text only. Otherwise inline content stays as-is.
  if (Boolean(type.spec.code) !== Boolean(node.type.spec.code)) {
    tr.replaceWith(pos, pos + node.nodeSize, type.create({ ...base, ...attrs }, node.textContent ? type.schema.text(node.textContent) : null));
    return;
  }
  tr.setNodeMarkup(pos, type, { ...base, ...attrs });
}

/**
 * Insert an empty block of `typeName` after the block at `pos` (at the same
 * indent), put the cursor in it, and return its position.
 * @param {Transaction} tr @param {number} pos @param {string} typeName @param {Record<string, any>} [attrs]
 */
export function insertBlockAfter(tr, pos, typeName, attrs = {}) {
  const node = /** @type {PMNode} */ (tr.doc.nodeAt(pos));
  const type = tr.doc.type.schema.nodes[typeName] ?? tr.doc.type.schema.nodes.paragraph;
  const at = pos + node.nodeSize;
  tr.insert(at, /** @type {import('@tiptap/pm/model').NodeType} */ (type).create({ indent: node.attrs.indent, ...attrs }));
  tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1)));
  return at;
}

/**
 * Delete block `index` together with its children.
 * @param {EditorState} state @param {number} index
 */
export function deleteBlock(state, index) {
  const end = withDescendants(state.doc, index, index);
  const from = posOfIndex(state.doc, index);
  const to = posOfIndex(state.doc, end + 1);
  const tr = state.tr.delete(from, to);
  if (tr.doc.childCount === 0) tr.insert(0, state.schema.nodes.paragraph.create());
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(from, tr.doc.content.size))));
  return tr;
}

/**
 * Copy block `index` with its children right after them (ids are refreshed by
 * the tree invariants).
 * @param {EditorState} state @param {number} index
 */
export function duplicateBlock(state, index) {
  const end = withDescendants(state.doc, index, index);
  const from = posOfIndex(state.doc, index);
  const to = posOfIndex(state.doc, end + 1);
  const tr = state.tr.insert(to, state.doc.slice(from, to).content);
  tr.setSelection(TextSelection.near(tr.doc.resolve(to + 1)));
  return tr;
}

/**
 * Select a whole block (used for atoms like dividers).
 * @param {EditorState} state @param {number} pos
 */
export const selectBlock = (state, pos) => state.tr.setSelection(NodeSelection.create(state.doc, pos));
