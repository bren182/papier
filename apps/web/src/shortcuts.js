/**
 * Every keyboard shortcut, for the shortcuts dialog (Ctrl+/). The bindings
 * themselves live where they act — App.jsx (global), editor/keymap.js,
 * editor/inputRules.js, the TipTap mark extensions — keep this list in step.
 *
 * `keys` are pressed together; `Mod` is Ctrl (⌘ on macOS). A `typed` entry is
 * text typed at the start of a line (markdown shortcuts).
 * @typedef {{ keys: string[], label: string, typed?: boolean }} Shortcut
 * @typedef {{ group: string, items: Shortcut[] }} ShortcutGroup
 */

/** @type {ShortcutGroup[]} */
export const SHORTCUTS = [
  {
    group: 'General',
    items: [
      { keys: ['Mod', 'K'], label: 'Search and commands (type > for commands)' },
      { keys: ['Mod', '\\'], label: 'Show / hide the sidebar' },
      { keys: ['Mod', '/'], label: 'Keyboard shortcuts' },
      { keys: ['Esc'], label: 'Close a menu, dialog or the side peek' },
    ],
  },
  {
    group: 'Editing',
    items: [
      { keys: ['Enter'], label: 'New block (lists and to-dos continue)' },
      { keys: ['Shift', 'Enter'], label: 'Line break inside a block' },
      { keys: ['Tab'], label: 'Indent (nest under the block above)' },
      { keys: ['Shift', 'Tab'], label: 'Outdent' },
      { keys: ['Backspace'], label: 'At the start: turn into text, then outdent, then join' },
      { keys: ['Mod', 'Enter'], label: 'Leave a code block' },
      { keys: ['Mod', 'Z'], label: 'Undo' },
      { keys: ['Mod', 'Shift', 'Z'], label: 'Redo' },
      { keys: ['/'], label: 'Insert a block (page, database, heading…)' },
      { keys: ['@'], label: 'Insert a date (today, next fri, oct 5…) or link a page' },
      { keys: ['[['], label: 'Link a page inline' },
      { keys: ['Right-click'], label: 'Block menu: turn into, duplicate, delete' },
      { keys: ['Shift', 'Right-click'], label: 'The browser’s own menu' },
    ],
  },
  {
    group: 'Turn into',
    items: [
      { keys: ['Mod', 'Alt', '0'], label: 'Text' },
      { keys: ['Mod', 'Alt', '1'], label: 'Heading 1 (2, 3 for the others)' },
      { keys: ['Mod', 'Alt', '4'], label: 'To-do' },
      { keys: ['Mod', 'Alt', '5'], label: 'Bulleted list' },
      { keys: ['Mod', 'Alt', '6'], label: 'Numbered list' },
      { keys: ['Mod', 'Alt', '7'], label: 'Toggle' },
      { keys: ['Mod', 'Alt', '8'], label: 'Code' },
      { keys: ['Mod', 'Alt', '9'], label: 'Callout' },
    ],
  },
  {
    group: 'Formatting',
    items: [
      { keys: ['Mod', 'B'], label: 'Bold' },
      { keys: ['Mod', 'I'], label: 'Italic' },
      { keys: ['Mod', 'U'], label: 'Underline' },
      { keys: ['Mod', 'Shift', 'S'], label: 'Strikethrough' },
      { keys: ['Mod', 'E'], label: 'Inline code' },
      { keys: ['Mod', 'K'], label: 'Link (with text selected)' },
      { keys: ['Mod', 'Click'], label: 'Open a link' },
    ],
  },
  {
    group: 'Markdown',
    items: [
      { keys: ['#', 'Space'], label: 'Heading 1 (## and ### for 2 and 3)', typed: true },
      { keys: ['-', 'Space'], label: 'Bulleted list (or *)', typed: true },
      { keys: ['1.', 'Space'], label: 'Numbered list', typed: true },
      { keys: ['[]', 'Space'], label: 'To-do ([x] starts it checked)', typed: true },
      { keys: ['>', 'Space'], label: 'Toggle', typed: true },
      { keys: ['"', 'Space'], label: 'Quote', typed: true },
      { keys: ['```'], label: 'Code block', typed: true },
      { keys: ['---'], label: 'Divider', typed: true },
    ],
  },
];

/** Whether this is a Mac, where Mod is ⌘. */
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** A key's label on this platform. @param {string} key */
export const keyLabel = (key) => (key === 'Mod' ? (isMac ? '⌘' : 'Ctrl') : key);
