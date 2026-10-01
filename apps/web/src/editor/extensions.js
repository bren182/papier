import { Extension } from '@tiptap/core';
import Bold from '@tiptap/extension-bold';
import Code from '@tiptap/extension-code';
import HardBreak from '@tiptap/extension-hard-break';
import Italic from '@tiptap/extension-italic';
import Link from '@tiptap/extension-link';
import Strike from '@tiptap/extension-strike';
import Underline from '@tiptap/extension-underline';
import { Dropcursor, Gapcursor, Placeholder, UndoRedo } from '@tiptap/extensions';
import { DateNode } from './DateNode.js';
import { RemindNode } from './RemindNode.js';
import { PageBlock } from './PageBlock.js';
import { PageMention } from './PageMention.js';
import { ButtonBlock } from './ButtonBlock.jsx';
import { DatabaseBlock } from './DatabaseBlock.jsx';
import { LinkedDatabaseBlock } from './LinkedDatabaseBlock.jsx';
import { ImageBlock } from './ImageBlock.jsx';
import { WidgetBlock } from './WidgetBlock.jsx';
import { BlockInputRules } from './inputRules.js';
import { BlockKeymap } from './keymap.js';
import { dateItems, mentionItems, pageLinkItems, slashItems } from './menuItems.js';
import { BLOCK_NODES, ListNumbering, Outline, PapierDocument, Text, TreeInvariants } from './schema.js';
import { suggestionMenu } from './SuggestionMenu.jsx';

/** @typedef {import('@tiptap/pm/model').Node} PMNode */

/**
 * `@` date menu — shared by the page body and the title. Spaces allowed so
 * "two days ago" works; the menu hides itself once nothing matches.
 */
/** Marks an editor as editing a template (or a page inside one): dates may stay "today". */
export const TemplateMode = Extension.create({
  name: 'templateMode',
  addOptions: () => ({ enabled: false }),
});

export const DateMenu = suggestionMenu({ name: 'dateMenu', char: '@', items: dateItems, allowSpaces: true }).extend({ priority: 300 });

/** The page body's `@`: dates, then pages to link. */
const MentionMenu = suggestionMenu({ name: 'mentionMenu', char: '@', items: mentionItems, allowSpaces: true }).extend({ priority: 300 });

/** `[[`: link a page inline. */
const PageLinkMenu = suggestionMenu({ name: 'pageLinkMenu', char: '[[', items: pageLinkItems, allowSpaces: true }).extend({ priority: 300 });

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
    case 'toggle':
      return 'Toggle';
    case 'callout':
      return 'Callout';
    case 'paragraph':
      return 'Write, or press ‘/’ for blocks, ‘@’ for dates and pages…';
    default:
      return '';
  }
}

/**
 * Everything the page body editor is made of.
 * @param {{ pages?: Partial<import('./PageBlock.js').PageBlockOptions>, databases?: Partial<import('./DatabaseBlock.jsx').DatabaseBlockOptions>,
 *   buttons?: Partial<import('./ButtonBlock.jsx').ButtonBlockOptions>, callouts?: Partial<import('./schema.js').CalloutOptions>,
 *   widgets?: Partial<import('./WidgetBlock.jsx').WidgetBlockOptions>, linked?: Partial<import('./LinkedDatabaseBlock.jsx').LinkedDatabaseOptions>,
 *   images?: Partial<import('./ImageBlock.jsx').ImageBlockOptions>,
 *   links?: Partial<Pick<import('./PageMention.js').PageMentionOptions, 'searchPages' | 'recentPages'>>, template?: boolean }} [opts]
 *   page, database and button blocks' data and views, the callout icon picker, page search for inline links (none in tests);
 *   images.onUpload: upload a File and return its URL; images.onSearch: Giphy search;
 *   template: a template page
 */
export function bodyExtensions({ pages = {}, databases = {}, buttons = {}, callouts = {}, widgets = {}, linked = {}, images = {}, links = {}, template = false } = {}) {
  return [
    TemplateMode.configure({ enabled: template }),
    PapierDocument,
    Text,
    ...BLOCK_NODES.map((node) => (node.name === 'callout' ? node.configure(callouts) : node)),
    PageBlock.configure(pages),
    DatabaseBlock.configure(databases),
    ButtonBlock.configure(buttons),
    WidgetBlock.configure(widgets),
    LinkedDatabaseBlock.configure(linked),
    ImageBlock.configure(images),
    DateNode,
    RemindNode,
    PageMention.configure({ watchPage: pages.watchPage ?? null, openPage: pages.openPage ?? null, ...links }),
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
    Outline,
    BlockKeymap.extend({ priority: 200 }),
    BlockInputRules,
    UndoRedo,
    Dropcursor.configure({ color: '#7bb2d9', width: 2 }),
    Gapcursor,
    Placeholder.configure({ placeholder: ({ node }) => placeholderFor(node), includeChildren: false }),
    SlashMenu,
    MentionMenu,
    PageLinkMenu,
  ];
}
