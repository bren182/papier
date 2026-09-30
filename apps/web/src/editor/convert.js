import { rebalanceOrder } from '@papier/core';

/**
 * Mapping between Papier's stored block model (@papier/core) and the editor's
 * ProseMirror JSON. The editor document is a flat list of blocks, each with an
 * `indent`; storage is a tree (`parentId` + `order`). Stored inline content is
 * editor-agnostic:
 *   { type: 'text', text, styles: { bold: true, … } }
 *   { type: 'link', href, content: [text…] }
 *   { type: 'date', props: { date: 'YYYY-MM-DD' } }
 * Newlines inside text are hard breaks (except in code, where they're literal).
 */

/** @typedef {import('@papier/core').Block} Block */
/** @typedef {import('@papier/core').BlockTypeName} BlockTypeName */
/** @typedef {import('@papier/core').InlineContent} InlineContent */
/** @typedef {{ type: string, attrs?: Record<string, any>, content?: PMNode[], text?: string, marks?: PMMark[] }} PMNode */
/** @typedef {{ type: string, attrs?: Record<string, any> }} PMMark */

/** @type {Record<BlockTypeName, string>} */
const TO_NODE = {
  paragraph: 'paragraph',
  heading: 'heading',
  bulleted_list: 'bulletItem',
  numbered_list: 'numberedItem',
  todo: 'todo',
  quote: 'quote',
  code: 'codeBlock',
  divider: 'divider',
};

/** @type {Record<string, BlockTypeName>} */
const FROM_NODE = Object.fromEntries(Object.entries(TO_NODE).map(([ours, node]) => [node, /** @type {BlockTypeName} */ (ours)]));

/** Stored props per type — also the node attrs of the same name. */
/** @type {Partial<Record<BlockTypeName, string[]>>} */
const PROPS = {
  heading: ['level'],
  todo: ['checked'],
  code: ['language'],
};

/** Inline styles, in the fixed order they're stored (keeps saves diff-stable). */
const STYLES = /** @type {const} */ (['bold', 'italic', 'underline', 'strike', 'code']);

// ── inline ────────────────────────────────────────────────────────────────

/**
 * Stored inline content → ProseMirror inline nodes.
 * @param {InlineContent} content
 * @param {{ code?: boolean }} [opts]  code blocks keep newlines and drop marks
 * @returns {PMNode[]}
 */
export function inlineToPM(content, { code = false } = {}) {
  /** @type {PMNode[]} */
  const out = [];

  /** @param {string} text @param {PMMark[]} marks */
  const pushText = (text, marks) => {
    const parts = code ? [text] : text.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) out.push({ type: 'hardBreak' });
      if (part) out.push(code || !marks.length ? { type: 'text', text: part } : { type: 'text', text: part, marks });
    });
  };

  /** @param {Record<string, unknown>} node @param {PMMark[]} outer */
  const visit = (node, outer) => {
    if (node.type === 'text' && typeof node.text === 'string') {
      const styles = /** @type {Record<string, unknown>} */ (node.styles ?? {});
      /** @type {PMMark[]} */
      const marks = [...STYLES.filter((s) => styles[s]).map((type) => ({ type })), ...outer];
      pushText(node.text, marks);
    } else if (node.type === 'link' && Array.isArray(node.content)) {
      const link = { type: 'link', attrs: { href: String(node.href ?? '') } };
      for (const child of node.content) visit(child, [...outer, link]);
    } else if (node.type === 'date' && !code) {
      const props = /** @type {{ date?: unknown }} */ (node.props ?? {});
      out.push({ type: 'date', attrs: { date: String(props.date ?? '') } });
    }
  };

  for (const node of content) visit(node, []);
  return out;
}

/**
 * ProseMirror inline nodes → stored inline content. Adjacent runs with the same
 * styles (and link) merge, so equal documents always serialize the same way.
 * @param {PMNode[] | undefined} nodes
 * @returns {InlineContent}
 */
export function inlineFromPM(nodes = []) {
  /** @type {InlineContent} */
  const out = [];
  /** @type {{ href: string, content: InlineContent } | null} */
  let link = null;

  /** @param {InlineContent} target @param {string} text @param {Record<string, true>} styles */
  const appendText = (target, text, styles) => {
    const last = target[target.length - 1];
    if (last?.type === 'text' && JSON.stringify(last.styles) === JSON.stringify(styles)) {
      last.text = String(last.text) + text;
    } else {
      target.push({ type: 'text', text, styles });
    }
  };

  for (const node of nodes) {
    const marks = node.marks ?? [];
    const href = marks.find((m) => m.type === 'link')?.attrs?.href;

    if (href === undefined || node.type !== 'text') link = null;
    else if (!link || link.href !== href) {
      link = { href: String(href), content: [] };
      out.push({ type: 'link', href: link.href, content: link.content });
    }

    if (node.type === 'text') {
      /** @type {Record<string, true>} */
      const styles = {};
      for (const s of STYLES) if (marks.some((m) => m.type === s)) styles[s] = true;
      appendText(link ? link.content : out, node.text ?? '', styles);
    } else if (node.type === 'hardBreak') {
      appendText(out, '\n', {});
    } else if (node.type === 'date') {
      out.push({ type: 'date', props: { date: String(node.attrs?.date ?? '') } });
    }
  }
  return out;
}

// ── blocks ────────────────────────────────────────────────────────────────

/**
 * Stored rows (a tree, any order) → the editor's flat document.
 * @param {Block[]} rows
 * @returns {PMNode}
 */
export function rowsToDoc(rows) {
  /** @type {Map<string | null, Block[]>} */
  const byParent = new Map();
  for (const row of rows) {
    const list = byParent.get(row.parentId) ?? [];
    list.push(row);
    byParent.set(row.parentId, list);
  }

  /** @type {PMNode[]} */
  const blocks = [];
  /** @param {string | null} parentId @param {number} indent */
  const walk = (parentId, indent) => {
    const children = (byParent.get(parentId) ?? []).sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
    for (const row of children) {
      const type = TO_NODE[row.type] ?? 'paragraph';
      /** @type {Record<string, unknown>} */
      const attrs = { id: row.id, indent };
      for (const key of PROPS[row.type] ?? []) if (row.props[key] !== undefined) attrs[key] = row.props[key];
      /** @type {PMNode} */
      const node = { type, attrs };
      if (type !== 'divider') {
        const content = inlineToPM(row.content, { code: type === 'codeBlock' });
        if (content.length) node.content = content;
      }
      blocks.push(node);
      walk(row.id, indent + 1);
    }
  };
  walk(null, 0);

  if (!blocks.length) blocks.push({ type: 'paragraph', attrs: { id: null, indent: 0 } });
  return { type: 'doc', content: blocks };
}

/**
 * The editor's flat document → stored rows. Parents come from indentation (the
 * nearest earlier block one level up); order keys are reused from `prev`
 * wherever the sibling order allows, so a move rewrites only the moved block.
 * @param {PMNode} doc
 * @param {Map<string, Block>} prev  last known rows by id
 * @returns {Block[]}
 */
export function docToRows(doc, prev) {
  /** @type {(string | null)[]} */
  const stack = []; // stack[i] = id of the latest block at indent i
  /** @type {Map<string | null, Block[]>} */
  const siblings = new Map();
  /** @type {Block[]} */
  const out = [];

  for (const node of doc.content ?? []) {
    const id = node.attrs?.id;
    if (typeof id !== 'string' || !id) continue; // not yet stamped by the editor
    const indent = Math.min(Math.max(0, Number(node.attrs?.indent) || 0), stack.length);
    const parentId = indent > 0 ? (stack[indent - 1] ?? null) : null;
    stack.length = indent;
    stack.push(id);

    const type = FROM_NODE[node.type] ?? 'paragraph';
    /** @type {Record<string, unknown>} */
    const props = {};
    for (const key of PROPS[type] ?? []) {
      const value = node.attrs?.[key];
      if (value !== undefined && value !== null && value !== '') props[key] = value;
    }

    /** @type {Block} */
    const row = { id, type, parentId, order: '', props, content: type === 'divider' ? [] : inlineFromPM(node.content) };
    out.push(row);
    const list = siblings.get(parentId) ?? [];
    list.push(row);
    siblings.set(parentId, list);
  }

  for (const [parentId, list] of siblings) {
    const keys = rebalanceOrder(
      list.map((row) => {
        const before = prev.get(row.id);
        return before && before.parentId === parentId ? before.order : null;
      }),
    );
    list.forEach((row, i) => (row.order = /** @type {string} */ (keys[i])));
  }
  return out;
}
