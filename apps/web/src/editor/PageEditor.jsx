import { useEffect, useImperativeHandle, useState } from 'react';
import { QueryObserver, useQueryClient } from '@tanstack/react-query';
import { EditorContent, useEditor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import { api, ApiError } from '../api/client.js';
import { pageQuery } from '../api/pages.js';
import { useTargetBlock } from '../useSelectedPage.js';
import { saveBlocks, usePageBlocks } from '../api/blocks.js';
import { createBlockSaver } from './blockSaver.js';
import { docToRows, rowsToDoc } from './convert.js';
import { bodyExtensions } from './extensions.js';
import { FormatToolbar } from './FormatToolbar.jsx';
import { SideMenu } from './SideMenu.jsx';

/** @typedef {import('@papier/core').Block} Block */
/** @typedef {{ focusStart: () => void }} PageEditorHandle */
/** @typedef {import('@papier/core').Page} Page */

/**
 * The page body. Loads the page's blocks once, then the editor owns them and
 * autosaves changes per block.
 * @param {{ pageId: string, onOpenPage: (id: string) => void, ref?: import('react').Ref<PageEditorHandle> }} props
 */
export function PageEditor({ pageId, onOpenPage, ref }) {
  const { data, error } = usePageBlocks(pageId);
  if (error) return <p className="text-[15px] leading-6 text-muted">Couldn’t load this page’s content.</p>;
  if (!data) return null;
  return <Editor pageId={pageId} rows={data} onOpenPage={onOpenPage} editorRef={ref} />;
}

/**
 * @param {{ pageId: string, rows: Block[], onOpenPage: (id: string) => void, editorRef?: import('react').Ref<PageEditorHandle> }} props
 */
function Editor({ pageId, rows, onOpenPage, editorRef }) {
  const [container, setContainer] = useState(/** @type {HTMLDivElement | null} */ (null));
  const qc = useQueryClient();
  const editor = useEditor({
    extensions: bodyExtensions({
      pages: {
        // Page blocks follow their page's cached title (renames show live).
        watchPage: (id, onChange) => {
          const observer = new QueryObserver(qc, { ...pageQuery(id), staleTime: 30_000 });
          /** @param {{ data?: { page: Page }, status: string }} r */
          const report = (r) => onChange(r.data ? r.data.page : r.status === 'error' ? null : undefined);
          report(observer.getCurrentResult());
          return observer.subscribe(report);
        },
        openPage: (id) => onOpenPage(id),
        createPage: async () => {
          const page = /** @type {Page} */ (await api('/pages', { method: 'POST', body: { parentId: pageId, block: false } }));
          qc.invalidateQueries({ queryKey: ['pages', 'children'] });
          return page.id;
        },
      },
    }),
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

  // A block the URL points at (a search hit): scroll to it, put the caret in it
  // and flash it once, then drop it from the URL. The flash is an overlay:
  // ProseMirror owns its nodes' DOM and would redraw away a class added there.
  const [target, clearTarget] = useTargetBlock();
  const [flash, setFlash] = useState(/** @type {{ key: number, top: number, left: number, width: number, height: number } | null} */ (null));
  useEffect(() => {
    if (!target || !container) return; // (the container arrives a render after mount)
    clearTarget();
    const { doc } = editor.state;
    let pos = -1;
    doc.forEach((node, offset) => {
      if (pos < 0 && node.attrs.id === target) pos = offset;
    });
    if (pos < 0) return;
    const dom = editor.view.nodeDOM(pos);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(doc.resolve(pos + 1))));
    editor.view.focus();
    if (!(dom instanceof HTMLElement)) return;
    dom.scrollIntoView({ block: 'center' });
    const box = dom.getBoundingClientRect();
    const outer = container.getBoundingClientRect();
    setFlash({ key: Date.now(), top: box.top - outer.top, left: box.left - outer.left, width: box.width, height: box.height });
  }, [editor, container, target, clearTarget]);

  useImperativeHandle(editorRef, () => ({ focusStart: () => editor.commands.focus('start') }), [editor]);

  return (
    // The left padding is the gutter for the + / drag handle — inside the page
    // column, so the scroll container can't clip it.
    <div ref={setContainer} className="relative -ml-14 pl-14">
      <EditorContent editor={editor} />
      {flash && (
        <div
          key={flash.key}
          className="papier-flash pointer-events-none absolute -mx-1 px-1"
          style={{ top: flash.top, left: flash.left, width: flash.width, height: flash.height, boxSizing: 'content-box' }}
          onAnimationEnd={() => setFlash(null)}
          aria-hidden="true"
        />
      )}
      <SideMenu editor={editor} container={container} />
      <FormatToolbar editor={editor} />
    </div>
  );
}
