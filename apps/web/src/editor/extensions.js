import Bold from '@tiptap/extension-bold';
import Code from '@tiptap/extension-code';
import HardBreak from '@tiptap/extension-hard-break';
import Italic from '@tiptap/extension-italic';
import Link from '@tiptap/extension-link';
import Strike from '@tiptap/extension-strike';
import Underline from '@tiptap/extension-underline';
import { Dropcursor, Gapcursor, Placeholder, UndoRedo } from '@tiptap/extensions';
import { DateNode } from './DateNode.js';
import { PageBlock } from './PageBlock.js';
import { BlockInputRules } from './inputRules.js';
import { BlockKeymap } from './keymap.js';
import { dateItems, slashItems } from './menuItems.js';
import { BLOCK_NODES, ListNumbering, PapierDocument, Text, TreeInvariants } from './schema.js';
import { suggestionMenu } from './SuggestionMenu.jsx';

/** @typedef {import('@tiptap/pm/model').Node} PMNode */

/**
 * `@` date menu — shared by the page body and the title. Spaces allowed so
 * "two days ago" works; the menu hides itself once nothing matches.
 */
export const DateMenu = suggestionMenu({ name: 'dateMenu', char: '@', items: dateItems, allowSpaces: true }).extend({ priority: 300 });

const SlashMenu = suggestionMenu({ name: 'slashMenu', char: '/', items: slashItems }).extend({ priority: 300 });

/** Shift-Enter only: Mod-Enter belongs to "leave code block". */
const SoftBreak = HardBreak.extend({
  addKeyboardShortcuts() {
    return { 'Shift-Enter': () => this.editor.commands.setHardBreak() };
  },
});

/** @param {PMNode} node */
function placeholderFor(node) {
  switch (node.type.name) {
    case 'heading':
      return `Heading ${node.attrs.level}`;
    case 'bulletItem':
    case 'numberedItem':
      return 'List';
    case 'todo':
      return 'To-do';
    case 'quote':
      return 'Quote';
    case 'paragraph':
      return 'Write, or press ‘/’ for blocks and ‘@’ for dates…';
    default:
      return '';
  }
}

/**
 * Everything the page body editor is made of.
 * @param {{ pages?: Partial<import('./PageBlock.js').PageBlockOptions> }} [opts]  page blocks' data (none in tests)
 */
export function bodyExtensions({ pages = {} } = {}) {
  return [
    PapierDocument,
    Text,
    ...BLOCK_NODES,
    PageBlock.configure(pages),
    DateNode,
    SoftBreak,
    Bold,
    Italic,
    Underline,
    Strike,
    Code,
    Link.configure({
      openOnClick: false, // plain click edits; Mod-click opens (see PageEditor)
      autolink: true,
      linkOnPaste: true,
      HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
    }),
    TreeInvariants,
    ListNumbering,
    BlockKeymap.extend({ priority: 200 }),
    BlockInputRules,
    UndoRedo,
    Dropcursor.configure({ color: '#7bb2d9', width: 2 }),
    Gapcursor,
    Placeholder.configure({ placeholder: ({ node }) => placeholderFor(node), includeChildren: false }),
    SlashMenu,
    DateMenu,
  ];
}
