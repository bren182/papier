import { useEffect, useRef } from 'react';
import { Extension, Node } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import { Placeholder, UndoRedo } from '@tiptap/extensions';
import { EditorContent, useEditor } from '@tiptap/react';
import { plainText } from '@papier/core/text';
import { useUpdatePage } from '../api/pages.js';
import { inlineFromPM, inlineToPM } from './convert.js';
import { DateNode } from './DateNode.js';
import { DateMenu } from './extensions.js';

/** @typedef {import('@papier/core').Page} PageData */

const SAVE_DELAY_MS = 400;

/** The title is one line of text + date mentions; no marks, no blocks. */
const TitleLine = Node.create({
  name: 'titleLine',
  content: 'inline*',
  marks: '',
  parseHTML: () => [{ tag: 'h1' }],
  renderHTML: () => ['h1', 0],
});

const TitleDoc = Document.extend({ content: 'titleLine' });

/**
 * Page title, saved as you type (debounced). The sidebar and breadcrumbs update
 * immediately through the optimistic cache write in useUpdatePage. `@` inserts
 * a live date, same as in the body.
 * @param {{ page: PageData, onEnter: () => void }} props
 */
export function TitleEditor({ page, onEnter }) {
  const updatePage = useUpdatePage();
  const timer = useRef(/** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined));
  const pending = useRef(/** @type {import('@papier/core').InlineContent | null} */ (null));
  const onEnterRef = useRef(onEnter);
  onEnterRef.current = onEnter;

  const flush = () => {
    clearTimeout(timer.current);
    if (pending.current === null) return;
    const content = pending.current;
    pending.current = null;
    // Plain text only? Store it as a plain title (keeps simple titles simple).
    const patch = content.some((n) => n.type === 'date') ? { titleContent: content } : { title: plainText(content) };
    updatePage.mutate({ id: page.id, patch });
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;

  const editor = useEditor({
    extensions: [
      TitleDoc,
      TitleLine,
      Text,
      DateNode,
      DateMenu,
      UndoRedo,
      Placeholder.configure({ placeholder: 'Untitled' }),
      Extension.create({
        name: 'titleKeys',
        priority: 200, // below the @ menu, which gets Enter first
        addKeyboardShortcuts: () => ({
          Enter: () => {
            flushRef.current();
            onEnterRef.current();
            return true;
          },
          'Shift-Enter': () => true,
          ArrowDown: ({ editor: e }) => {
            if (e.state.selection.to !== e.state.doc.content.size - 1) return false;
            flushRef.current();
            onEnterRef.current();
            return true;
          },
        }),
      }),
    ],
    content: {
      type: 'doc',
      content: [{ type: 'titleLine', content: inlineToPM(page.titleContent ?? (page.title ? [{ type: 'text', text: page.title }] : [])) }],
    },
    autofocus: page.title ? false : 'end',
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: 'papier-title', 'aria-label': 'Page title' },
      // Pasted line breaks become spaces.
      transformPastedText: (text) => text.replace(/\s*\n\s*/g, ' '),
    },
    onUpdate: ({ editor: e }) => {
      pending.current = inlineFromPM(/** @type {any} */ (e.getJSON().content?.[0]?.content ?? [])).map((n) =>
        n.type === 'text' ? { type: 'text', text: String(n.text).replace(/\n/g, ' '), styles: {} } : n,
      );
      clearTimeout(timer.current);
      timer.current = setTimeout(() => flushRef.current(), SAVE_DELAY_MS);
    },
    onBlur: () => flushRef.current(),
  });

  // Save anything still pending when switching pages.
  useEffect(() => () => flushRef.current(), []);

  return <EditorContent editor={editor} />;
}
