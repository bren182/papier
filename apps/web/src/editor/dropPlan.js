import { Fragment } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { posOfIndex } from './blockOps.js';
import { MAX_INDENT } from './schema.js';

/**
 * Where a dragged block lands, and as what. Pure document logic — the pointer
 * geometry lives in SideMenu.jsx.
 *
 * A drag moves blocks `index..end` (a block plus its children). The drop picks
 * a *gap* between blocks (from the pointer's height) and a *level* (from its
 * horizontal position), limited to what keeps the tree valid:
 * - at most one deeper than the block above the gap,
 * - no shallower than the block below the gap (otherwise the dragged block
 *   would adopt that block and its siblings as children).
 * Dropping plain text or a list item among list items at that level turns it
 * into that list's type.
 */

/** @typedef {import('@tiptap/pm/model').Node} PMNode */
/** @typedef {{ index: number, end: number }} DragRange */
/**
 * @typedef {{
 *   gap: number,          // insert before this block index (count = at the end)
 *   level: number,        // indent for the dragged block
 *   min: number, max: number,
 *   convertTo: string | null,
 *   inPlace: boolean,     // same spot: only the level/type can change
 * }} DropPlan
 */

const LISTS = new Set(['bulletItem', 'numberedItem', 'todo']);
/** Types that may turn into a list when dropped among one. Headings, quotes, code and dividers are deliberate. */
const CONVERTIBLE = new Set(['paragraph', 'bulletItem', 'numberedItem', 'todo']);

/**
 * @param {PMNode} doc
 * @param {DragRange} drag
 * @param {number} gap        raw gap from the pointer (0..childCount)
 * @param {number} wantLevel  level from the pointer's x (unclamped)
 * @returns {DropPlan}
 */
export function planDrop(doc, drag, gap, wantLevel) {
  const inPlace = gap >= drag.index && gap <= drag.end + 1;
  const at = inPlace ? drag.index : gap;

  // Neighbours around the gap, ignoring the dragged range itself.
  const prevIndex = inPlace ? drag.index - 1 : at - 1;
  const nextIndex = inPlace ? drag.end + 1 : at;
  const prev = prevIndex >= 0 ? doc.child(prevIndex) : null;
  const next = nextIndex < doc.childCount ? doc.child(nextIndex) : null;

  const max = prev ? Math.min(prev.attrs.indent + 1, MAX_INDENT) : 0;
  const min = Math.min(next ? next.attrs.indent : 0, max);
  const level = Math.min(Math.max(Math.round(wantLevel), min), max);

  // The list we'd join: nearest sibling at `level` above the gap, else below it.
  let sibling = null;
  for (let i = prevIndex; i >= 0; i--) {
    if (i >= drag.index && i <= drag.end) continue; // the blocks being moved
    const n = doc.child(i);
    if (n.attrs.indent < level) break;
    if (n.attrs.indent === level) {
      sibling = n;
      break;
    }
  }
  if (!sibling && next && next.attrs.indent === level) sibling = next;

  const root = doc.child(drag.index);
  const convertTo =
    sibling && LISTS.has(sibling.type.name) && CONVERTIBLE.has(root.type.name) && sibling.type.name !== root.type.name
      ? sibling.type.name
      : null;

  return { gap: at, level, min, max, convertTo, inPlace };
}

/**
 * The transaction for a drop plan, or null when nothing would change.
 * @param {import('@tiptap/pm/state').EditorState} state
 * @param {DragRange} drag
 * @param {DropPlan} plan
 */
export function applyDrop(state, drag, plan) {
  const doc = state.doc;
  const root = doc.child(drag.index);
  const delta = plan.level - root.attrs.indent;
  if (plan.inPlace && delta === 0 && !plan.convertTo) return null;

  /** @type {PMNode[]} */
  const moved = [];
  for (let i = drag.index; i <= drag.end; i++) {
    const n = doc.child(i);
    const indent = Math.max(0, n.attrs.indent + delta);
    const type = i === drag.index && plan.convertTo ? state.schema.nodes[plan.convertTo] : n.type;
    const attrs = type === n.type ? { ...n.attrs, indent } : { id: n.attrs.id, indent };
    moved.push(/** @type {any} */ (type).create(attrs, n.content, n.marks));
  }

  const from = posOfIndex(doc, drag.index);
  const to = posOfIndex(doc, drag.end + 1);
  const tr = state.tr;
  let landed;
  if (plan.inPlace) {
    tr.replaceWith(from, to, Fragment.fromArray(moved));
    landed = from;
  } else {
    const insertAt = posOfIndex(doc, plan.gap);
    tr.insert(insertAt, Fragment.fromArray(moved));
    tr.delete(tr.mapping.map(from), tr.mapping.map(to));
    landed = tr.mapping.slice(1).map(insertAt);
  }
  // Cursor at the end of the moved block's text.
  const size = /** @type {PMNode} */ (tr.doc.nodeAt(landed)).nodeSize;
  tr.setSelection(TextSelection.near(tr.doc.resolve(landed + size - 1), -1));
  return tr;
}
