import { useEffect, useImperativeHandle, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { ApiError } from '../api/client.js';
import { saveBlocks, usePageBlocks } from '../api/blocks.js';
import { createBlockSaver } from './blockSaver.js';
import { docToRows, rowsToDoc } from './convert.js';
import { bodyExtensions } from './extensions.js';
import { FormatToolbar } from './FormatToolbar.jsx';
import { SideMenu } from './SideMenu.jsx';

/** @typedef {import('@papier/core').Block} Block */
/** @typedef {{ focusStart: () => void }} PageEditorHandle */

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

/**
 * @param {{ pageId: string, rows: Block[], editorRef?: import('react').Ref<PageEditorHandle> }} props
 */
function Editor({ pageId, rows, editorRef }) {
  const [container, setContainer] = useState(/** @type {HTMLDivElement | null} */ (null));
  const editor = useEditor({
    extensions: bodyExtensions(),
    content: rowsToDoc(rows),
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: 'papier-editor', 'aria-label': 'Page content' },
      // Links: plain click edits text, Ctrl/Cmd-click opens.
      handleClick: (_view, _pos, event) => {
        const link = /** @type {HTMLElement} */ (event.target).closest?.('a[href]');
        if (link && (event.ctrlKey || event.metaKey)) {
          window.open(/** @type {HTMLAnchorElement} */ (link).href, '_blank', 'noopener,noreferrer');
          return true;
        }
        return false;
      },
    },
  });

  // Autosave: diff the document against what the server has, per block.
  useEffect(() => {
    let known = new Map(rows.map((r) => [r.id, r]));
    const read = () => {
      const next = docToRows(/** @type {any} */ (editor.getJSON()), known);
      known = new Map(next.map((r) => [r.id, r]));
      return next;
    };

    const saver = createBlockSaver({
      // What the editor shows right after loading is, by definition, saved.
      initial: read(),
      read,
      send: (batch, opts) => saveBlocks(pageId, batch, opts),
      onError: (err) => console.error('Autosave failed', err),
      // A 4xx won't fix itself by resending; the next edit tries again.
      retry: (err) => !(err instanceof ApiError && err.status < 500),
    });

    const onUpdate = () => saver.schedule();
    const onHide = () => saver.flushOnExit();
    editor.on('update', onUpdate);
    window.addEventListener('pagehide', onHide);
    return () => {
      editor.off('update', onUpdate);
      window.removeEventListener('pagehide', onHide);
      saver.flush();
      saver.dispose();
    };
  }, [editor, pageId, rows]);

  useImperativeHandle(editorRef, () => ({ focusStart: () => editor.commands.focus('start') }), [editor]);

  return (
    // The left padding is the gutter for the + / drag handle — inside the page
    // column, so the scroll container can't clip it.
    <div ref={setContainer} className="relative -ml-14 pl-14">
      <EditorContent editor={editor} />
      <SideMenu editor={editor} container={container} />
      <FormatToolbar editor={editor} />
    </div>
  );
}
