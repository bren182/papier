import { Extension, InputRule } from '@tiptap/core';
import { blockAt, insertBlockAfter, setBlockType } from './blockOps.js';

/**
 * Markdown-style shortcuts typed at the start of a text block. They change the
 * block's type in place, so its id, indent and children are kept.
 *   "# " "## " "### "  headings      "- " "* "  bullet      "1. "  numbered
 *   "[] " "[ ] " "[x] " to-do         "> "       toggle      '" '     quote       "```"  code
 *   "---"               divider
 * (Inline marks — **bold**, *italic*, `code`, ~~strike~~ — come with the mark extensions.)
 */

/** @type {[RegExp, string, (m: RegExpMatchArray) => Record<string, any>][]} */
const RULES = [
  [/^(#{1,3})\s$/, 'heading', (m) => ({ level: /** @type {string} */ (m[1]).length })],
  [/^[-*]\s$/, 'bulletItem', () => ({})],
  [/^1[.)]\s$/, 'numberedItem', () => ({})],
  [/^\[( |x)?\]\s$/, 'todo', (m) => ({ checked: m[1] === 'x' })],
  [/^>\s$/, 'toggle', () => ({})],
  [/^["“”]\s$/, 'quote', () => ({})],
  [/^```$/, 'codeBlock', () => ({})],
];

export const BlockInputRules = Extension.create({
  name: 'blockInputRules',

  addInputRules() {
    const blockRules = RULES.map(
      ([find, typeName, attrs]) =>
        new InputRule({
          find,
          handler: ({ state, range, match }) => {
            const block = blockAt(state.doc, range.from);
            // Only in plain text blocks, and only at their very start.
            if (!block || block.node.type.name !== 'paragraph' || range.from !== block.pos + 1) return null;
            const tr = state.tr.delete(range.from, range.to);
            setBlockType(tr, block.pos, /** @type {any} */ (state.schema.nodes[typeName]), attrs(match));
          },
        }),
    );

    const divider = new InputRule({
      find: /^---$/,
      handler: ({ state, range }) => {
        const block = blockAt(state.doc, range.from);
        if (!block || block.node.type.name !== 'paragraph' || range.from !== block.pos + 1) return null;
        const tr = state.tr.delete(range.from, range.to);
        const empty = /** @type {import('@tiptap/pm/model').Node} */ (tr.doc.nodeAt(block.pos)).content.size === 0;
        if (empty) {
          setBlockType(tr, block.pos, state.schema.nodes.divider);
          insertBlockAfter(tr, block.pos, 'paragraph');
        } else {
          // "---" before existing text: divider above, text stays.
          tr.insert(block.pos, state.schema.nodes.divider.create({ indent: block.node.attrs.indent }));
        }
      },
    });

    return [...blockRules, divider];
  },
});
