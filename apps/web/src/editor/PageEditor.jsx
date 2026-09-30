import '@blocknote/mantine/style.css';
import { useEffect, useImperativeHandle, useRef } from 'react';
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs, defaultStyleSpecs, createHeadingBlockSpec } from '@blocknote/core';
import {
  BlockNoteContext,
  DragHandleMenu,
  FormattingToolbar,
  FormattingToolbarController,
  getFormattingToolbarItems,
  RemoveBlockItem,
  SideMenu,
  SideMenuController,
  SuggestionMenuController,
  useCreateBlockNote,
} from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import { ApiError } from '../api/client.js';
import { saveBlocks, usePageBlocks } from '../api/blocks.js';
import { createBlockSaver } from './blockSaver.js';
import { DateMention, getDateMenuItems } from './DateMention.jsx';
import { fromEditorDoc, toEditorDoc } from './convert.js';

/** @typedef {import('@papier/core').Block} Block */
/** @typedef {import('./convert.js').EditorBlock} EditorBlock */
/** @typedef {{ focusStart: () => void }} PageEditorHandle */

/**
 * v0.1 blocks only. No colour styles: colour lives behind the glass, so the
 * colour picker (which BlockNote shows only when these exist) stays hidden.
 */
const schema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    heading: createHeadingBlockSpec({ levels: [1, 2, 3], allowToggleHeadings: false }),
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    checkListItem: defaultBlockSpecs.checkListItem,
    quote: defaultBlockSpecs.quote,
    codeBlock: defaultBlockSpecs.codeBlock,
    divider: defaultBlockSpecs.divider,
  },
  inlineContentSpecs: { ...defaultInlineContentSpecs, date: DateMention },
  styleSpecs: {
    bold: defaultStyleSpecs.bold,
    italic: defaultStyleSpecs.italic,
    underline: defaultStyleSpecs.underline,
    strike: defaultStyleSpecs.strike,
    code: defaultStyleSpecs.code,
  },
});

/** Mantine theme mapped onto Papier tokens; the editor itself stays transparent over the glass. */
const theme = {
  colors: {
    editor: { text: 'var(--p-text)', background: 'transparent' },
    menu: { text: 'var(--p-text)', background: 'var(--p-sidebar)' },
    tooltip: { text: 'var(--p-strong)', background: 'var(--p-hover)' },
    hovered: { text: 'var(--p-strong)', background: 'var(--p-hover)' },
    selected: { text: 'var(--p-root)', background: 'var(--p-accent)' },
    disabled: { text: 'var(--p-faint)', background: 'var(--p-sidebar)' },
    shadow: 'rgb(0 0 0 / 0.5)',
    border: 'var(--p-line)',
    sideMenu: 'var(--p-faint)',
  },
  borderRadius: 6,
  fontFamily: 'var(--p-font-sans)',
};

/** Papier is dark-only, whatever the OS prefers. */
const darkOnly = { colorSchemePreference: /** @type {const} */ ('dark') };

/**
 * The page body. Loads the page's blocks once, then the editor owns them and
 * autosaves changes per block.
 * @param {{ pageId: string, ref?: import('react').Ref<PageEditorHandle> }} props
 */
export function PageEditor({ pageId, ref }) {
  const { data, error } = usePageBlocks(pageId);
  if (error) return <p className="text-[15px] leading-6 text-muted">Couldn’t load this page’s content.</p>;
  if (!data) return null;
  return <Editor pageId={pageId} rows={data} editorRef={ref} />;
}

/** Formatting toolbar without alignment (not stored) — colour is already absent from the schema. */
function Toolbar() {
  return <FormattingToolbar>{getFormattingToolbarItems().filter((item) => !String(item.key).startsWith('textAlign'))}</FormattingToolbar>;
}

/** Drag-handle menu without block colours. */
function DragMenu() {
  return (
    <DragHandleMenu>
      <RemoveBlockItem>Delete</RemoveBlockItem>
    </DragHandleMenu>
  );
}

/** @param {import('@blocknote/react').SideMenuProps} props */
function PapierSideMenu(props) {
  return <SideMenu {...props} dragHandleMenu={DragMenu} />;
}

/**
 * @param {{ pageId: string, rows: Block[], editorRef?: import('react').Ref<PageEditorHandle> }} props
 */
function Editor({ pageId, rows, editorRef }) {
  const editor = useCreateBlockNote({
    schema,
    initialContent: rows.length ? /** @type {any} */ (toEditorDoc(rows)) : undefined,
  });
  const saver = useRef(/** @type {ReturnType<typeof createBlockSaver> | null} */ (null));

  useEffect(() => {
    // Current document as stored rows, reusing the last known order keys.
    let known = new Map(rows.map((r) => [r.id, r]));
    const read = () => {
      const next = fromEditorDoc(/** @type {EditorBlock[]} */ (editor.document), known);
      known = new Map(next.map((r) => [r.id, r]));
      return next;
    };

    const s = createBlockSaver({
      // What the editor shows right after loading is, by definition, saved.
      initial: read(),
      read,
      send: (batch, opts) => saveBlocks(pageId, batch, opts),
      onError: (err) => console.error('Autosave failed', err),
      // A 4xx won't fix itself by resending; the next edit tries again.
      retry: (err) => !(err instanceof ApiError && err.status < 500),
    });
    saver.current = s;

    const onHide = () => s.flushOnExit();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      s.flush();
      s.dispose();
      saver.current = null;
    };
  }, [editor, pageId, rows]);

  useImperativeHandle(
    editorRef,
    () => ({
      focusStart() {
        const first = editor.document[0];
        if (first) editor.setTextCursorPosition(first, 'start');
        editor.focus();
      },
    }),
    [editor],
  );

  return (
    <BlockNoteContext.Provider value={darkOnly}>
      <BlockNoteView
        editor={editor}
        theme={theme}
        formattingToolbar={false}
        sideMenu={false}
        onChange={() => saver.current?.schedule()}
        className="papier-editor"
      >
        <FormattingToolbarController formattingToolbar={Toolbar} />
        <SideMenuController sideMenu={PapierSideMenu} />
        <SuggestionMenuController triggerCharacter="@" getItems={(query) => getDateMenuItems(editor, query)} />
      </BlockNoteView>
    </BlockNoteContext.Provider>
  );
}
