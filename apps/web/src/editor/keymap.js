import { Extension } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { blockAt, insertBlockAfter, posOfIndex, selectedRange, setBlockType, shiftIndent, withDescendants } from './blockOps.js';
import { CONTINUES } from './schema.js';

/**
 * Notion-style block keys on the flat document:
 * - Enter: split (lists/todos continue, headings/quotes become text); on an
 *   empty list item → text; on an empty indented text block → outdent; at the
 *   start of a block → new empty block above. In code: newline; Mod-Enter or
 *   Enter on a trailing empty line leaves the block.
 * - Backspace at the start: non-text → text, then outdent, then merge up.
 * - Tab / Shift-Tab: indent / outdent the selected blocks with their children.
 */
export const BlockKeymap = Extension.create({
  name: 'blockKeymap',
  priority: 50, // after marks/suggestions, before the defaults

  addKeyboardShortcuts() {
    const editor = this.editor;

    /** Leave a code block: new paragraph after it. */
    const exitCode = () => {
      const { state } = editor;
      const block = blockAt(state.doc, state.selection.from);
      if (!block || block.node.type.name !== 'codeBlock') return false;
      const tr = state.tr;
      insertBlockAfter(tr, block.pos, 'paragraph');
      editor.view.dispatch(tr.scrollIntoView());
      return true;
    };

    return {
      Enter: () => {
        const { state } = editor;
        const sel = state.selection;

        // A selected divider (or other atom): add a paragraph after it.
        if (sel instanceof NodeSelection) {
          const block = blockAt(state.doc, sel.from);
          if (!block) return false;
          const tr = state.tr;
          insertBlockAfter(tr, block.pos, 'paragraph');
          editor.view.dispatch(tr.scrollIntoView());
          return true;
        }
        if (!(sel instanceof TextSelection)) return false;

        const block = blockAt(state.doc, sel.from);
        if (!block) return false;
        const { node, pos } = block;
        const name = node.type.name;

        if (name === 'codeBlock') {
          const { $from } = sel;
          const before = node.textContent.slice(0, $from.parentOffset);
          if (sel.empty && $from.parentOffset === node.content.size && before.endsWith('\n')) {
            // Enter on an empty last line: drop that line and leave the block.
            const tr = state.tr.delete($from.pos - 1, $from.pos);
            insertBlockAfter(tr, pos, 'paragraph');
            editor.view.dispatch(tr.scrollIntoView());
            return true;
          }
          editor.view.dispatch(state.tr.insertText('\n').scrollIntoView());
          return true;
        }

        const tr = state.tr;
        if (!sel.empty) tr.deleteSelection();
        const $from = tr.selection.$from;
        const current = /** @type {import('@tiptap/pm/model').Node} */ (tr.doc.nodeAt(pos));
        const empty = current.content.size === 0;

        if (empty && name !== 'paragraph') {
          setBlockType(tr, pos, state.schema.nodes.paragraph);
          editor.view.dispatch(tr);
          return true;
        }
        if (empty && current.attrs.indent > 0) {
          const index = block.index;
          if (shiftIndent(tr, index, index, -1)) {
            editor.view.dispatch(tr);
            return true;
          }
        }

        // At the end of a toggle: an open one gets a first child, a folded one a sibling after its children.
        if (name === 'toggle' && $from.parentOffset === current.content.size) {
          const para = state.schema.nodes.paragraph;
          if (current.attrs.collapsed) {
            const end = withDescendants(tr.doc, block.index, block.index);
            const at = posOfIndex(tr.doc, end + 1);
            tr.insert(at, /** @type {any} */ (para).create({ indent: current.attrs.indent }));
            tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1)));
          } else {
            const at = pos + current.nodeSize;
            tr.insert(at, /** @type {any} */ (para).create({ indent: current.attrs.indent + 1 }));
            tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1)));
          }
          editor.view.dispatch(tr.scrollIntoView());
          return true;
        }

        const nextType = CONTINUES.has(name) ? name : 'paragraph';
        if ($from.parentOffset === 0 && !empty) {
          // At the start: open an empty block above; the text keeps its id.
          const type = state.schema.nodes[nextType];
          tr.insert(pos, /** @type {any} */ (type).create({ indent: current.attrs.indent }));
          editor.view.dispatch(tr.scrollIntoView());
          return true;
        }

        const type = state.schema.nodes[nextType];
        tr.split($from.pos, 1, [{ type: /** @type {any} */ (type), attrs: { indent: current.attrs.indent } }]);
        editor.view.dispatch(tr.scrollIntoView());
        return true;
      },

      'Mod-Enter': exitCode,

      Backspace: () => {
        const { state } = editor;
        const sel = state.selection;
        if (!(sel instanceof TextSelection) || !sel.empty || sel.$from.parentOffset !== 0) return false;
        const block = blockAt(state.doc, sel.from);
        if (!block) return false;
        const { node, pos, index } = block;

        if (node.type.name !== 'paragraph') {
          const tr = state.tr;
          setBlockType(tr, pos, state.schema.nodes.paragraph);
          editor.view.dispatch(tr);
          return true;
        }
        if (node.attrs.indent > 0) {
          const tr = state.tr;
          if (shiftIndent(tr, index, index, -1)) {
            editor.view.dispatch(tr);
            return true;
          }
        }
        return false; // default: join with the block above
      },

      Tab: () => {
        const { state } = editor;
        const block = blockAt(state.doc, state.selection.from);
        if (block?.node.type.name === 'codeBlock') {
          editor.view.dispatch(state.tr.insertText('  '));
          return true;
        }
        const { first, last } = selectedRange(state);
        const tr = state.tr;
        if (shiftIndent(tr, first, last, 1)) editor.view.dispatch(tr);
        return true; // never tab out of the editor
      },

      'Shift-Tab': () => {
        const { state } = editor;
        const { first, last } = selectedRange(state);
        const tr = state.tr;
        if (shiftIndent(tr, first, last, -1)) editor.view.dispatch(tr);
        return true;
      },
    };
  },
});
