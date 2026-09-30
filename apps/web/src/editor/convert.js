import { rebalanceOrder } from '@papier/core';

/**
 * Mapping between Papier's stored block model (@papier/core) and BlockNote's
 * document. Only the props that mean something to Papier are kept, so stored
 * data never depends on the editor library.
 */

/** @typedef {import('@papier/core').Block} Block */
/** @typedef {import('@papier/core').BlockTypeName} BlockTypeName */
/**
 * The subset of a BlockNote block this module reads and writes.
 * @typedef {{ id: string, type: string, props?: Record<string, unknown>, content?: unknown, children?: EditorBlock[] }} EditorBlock
 */

/** @type {Record<BlockTypeName, string>} */
const TO_EDITOR = {
  paragraph: 'paragraph',
  heading: 'heading',
  bulleted_list: 'bulletListItem',
  numbered_list: 'numberedListItem',
  todo: 'checkListItem',
  quote: 'quote',
  code: 'codeBlock',
  divider: 'divider',
};

/** @type {Record<string, BlockTypeName>} */
const FROM_EDITOR = Object.fromEntries(
  Object.entries(TO_EDITOR).map(([ours, theirs]) => [theirs, /** @type {BlockTypeName} */ (ours)]),
);

/** Props Papier stores, per type. Everything else (colours, alignment) is editor-only. */
/** @type {Partial<Record<BlockTypeName, string[]>>} */
const KEPT_PROPS = {
  heading: ['level'],
  numbered_list: ['start'],
  todo: ['checked'],
  code: ['language'],
};

/**
 * @param {BlockTypeName} type
 * @param {Record<string, unknown> | undefined} props
 */
function pickProps(type, props = {}) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const key of KEPT_PROPS[type] ?? []) {
    if (props[key] !== undefined && props[key] !== '') out[key] = props[key];
  }
  return out;
}

/**
 * Stored rows (flat, any order) → BlockNote's nested document.
 * @param {Block[]} rows
 * @returns {EditorBlock[]}
 */
export function toEditorDoc(rows) {
  /** @type {Map<string | null, Block[]>} */
  const byParent = new Map();
  for (const row of rows) {
    const list = byParent.get(row.parentId) ?? [];
    list.push(row);
    byParent.set(row.parentId, list);
  }

  /** @param {string | null} parentId @returns {EditorBlock[]} */
  const build = (parentId) =>
    (byParent.get(parentId) ?? [])
      .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
      .map((row) => {
        const type = TO_EDITOR[row.type] ?? 'paragraph';
        /** @type {EditorBlock} */
        const block = { id: row.id, type, props: { ...row.props }, children: build(row.id) };
        if (type !== 'divider') block.content = row.content;
        return block;
      });

  return build(null);
}

/**
 * BlockNote's document → flat rows. Order keys are reused from `prev` wherever
 * the sibling order still allows it, so a move rewrites only the moved block.
 * @param {EditorBlock[]} doc
 * @param {Map<string, Block>} prev  last known rows by id
 * @returns {Block[]}
 */
export function fromEditorDoc(doc, prev) {
  /** @type {Block[]} */
  const out = [];

  /** @param {EditorBlock[]} siblings @param {string | null} parentId */
  const walk = (siblings, parentId) => {
    const keys = rebalanceOrder(
      siblings.map((b) => {
        const before = prev.get(b.id);
        return before && before.parentId === parentId ? before.order : null;
      }),
    );
    siblings.forEach((b, i) => {
      const type = FROM_EDITOR[b.type] ?? 'paragraph';
      out.push({
        id: b.id,
        type,
        parentId,
        order: /** @type {string} */ (keys[i]),
        props: pickProps(type, b.props),
        content: Array.isArray(b.content) ? b.content : [],
      });
      if (b.children?.length) walk(b.children, b.id);
    });
  };

  walk(doc, null);
  return out;
}
