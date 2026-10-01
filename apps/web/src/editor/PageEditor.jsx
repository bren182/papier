import { lazy, Suspense, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { QueryObserver, useQueryClient } from '@tanstack/react-query';
import { EditorContent, useEditor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import { api, ApiError, SIGNED_IN_EVENT } from '../api/client.js';
import { pageQuery } from '../api/pages.js';
import { openPeek, useTargetBlock } from '../useSelectedPage.js';
import { saveBlocks, usePageBlocks } from '../api/blocks.js';
import { createBlockSaver } from './blockSaver.js';
import { docToRows, rowsToDoc } from './convert.js';
import { bodyExtensions } from './extensions.js';
import { FormatToolbar } from './FormatToolbar.jsx';
import { SideMenu } from './SideMenu.jsx';
import { InlineDatabase } from '../components/database/InlineDatabase.jsx';
import { LinkedDatabase } from '../components/database/LinkedDatabase.jsx';
import { HomeWidget } from '../components/HomeWidgets.jsx';
import { ButtonBlockSettings } from '../components/database/ButtonBlockSettings.jsx';
import { Popover } from '../components/database/Popover.jsx';
import { useRunButton } from '../api/actions.js';
import { recentPages } from '../recentPages.js';

/** @typedef {import('@papier/core').Block} Block */

const EmojiPicker = lazy(() => import('../components/EmojiPicker.jsx').then((m) => ({ default: m.EmojiPicker })));
/** @typedef {{ focusStart: () => void }} PageEditorHandle */
/** @typedef {import('@papier/core').Page} Page */

/**
 * The page body. Loads the page's blocks once, then the editor owns them and
 * autosaves changes per block.
 * @param {{ pageId: string, onOpenPage: (id: string) => void, onEmptyChange?: (empty: boolean) => void, template?: boolean,
 *   ref?: import('react').Ref<PageEditorHandle> }} props
 *   onEmptyChange: whether the content is just one empty line (a new page)
 */
export function PageEditor({ pageId, onOpenPage, onEmptyChange, template = false, ref }) {
  const { data, error } = usePageBlocks(pageId);
  if (error) return <p className="text-[15px] leading-6 text-muted">Couldn’t load this page’s content.</p>;
  if (!data) return null;
  return <Editor pageId={pageId} rows={data} onOpenPage={onOpenPage} onEmptyChange={onEmptyChange} template={template} editorRef={ref} />;
}

/**
 * @param {{ pageId: string, rows: Block[], onOpenPage: (id: string) => void, onEmptyChange?: (empty: boolean) => void,
 *   template: boolean, editorRef?: import('react').Ref<PageEditorHandle> }} props
 */
function Editor({ pageId, rows, onOpenPage, onEmptyChange, template, editorRef }) {
  const [container, setContainer] = useState(/** @type {HTMLDivElement | null} */ (null));
  const qc = useQueryClient();
  // Button blocks run by id, so their latest settings must be saved first.
  const saverRef = useRef(/** @type {ReturnType<typeof createBlockSaver> | null} */ (null));
  const { runBlock } = useRunButton();
  const runBlockRef = useRef(runBlock);
  runBlockRef.current = runBlock;
  // A callout's icon picker, opened from its node view.
  const [iconPick, setIconPick] = useState(
    /** @type {{ anchor: HTMLElement, current: import('./schema.js').CalloutLook, onChange: (patch: Partial<import('./schema.js').CalloutLook>) => void } | null} */ (null),
  );
  const editor = useEditor({
    extensions: bodyExtensions({
      template,
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
        createPage: async (kind = 'page', title = '') => {
          const page = /** @type {Page} */ (await api('/pages', { method: 'POST', body: { parentId: pageId, kind, title, block: false } }));
          qc.invalidateQueries({ queryKey: ['pages', 'children'] });
          return page.id;
        },
        saveContent: (id, rows) => saveBlocks(id, { upserts: rows, deletes: [] }),
      },
      databases: { View: InlineDatabase, openPage: (id) => onOpenPage(id) },
      linked: { View: LinkedDatabase, openPage: (id) => onOpenPage(id) },
      widgets: { View: HomeWidget, openPage: (id) => onOpenPage(id) },
      links: {
        searchPages: async (q) => {
          const res = /** @type {{ items: { page: import('./PageMention.js').PageHit }[] }} */ (await api(`/search?q=${encodeURIComponent(q)}&limit=8`));
          return res.items.map((i) => i.page).filter((p) => p.id !== pageId);
        },
        recentPages: () => recentPages().filter((p) => p.id !== pageId),
      },
      callouts: { pickIcon: (anchor, current, onChange) => setIconPick({ anchor, current, onChange }) },
      buttons: {
        Settings: ButtonBlockSettings,
        onRun: async (id) => {
          await saverRef.current?.flush();
          return runBlockRef.current(id);
        },
        openRow: (id) => openPeek(id),
      },
      images: {
        onSearch: async (q) => {
          const data = /** @type {{ results?: { url: string, preview: string }[] }} */ (
            await api(`/ai/giphy?q=${encodeURIComponent(q)}`).catch(() => ({ results: [] }))
          );
          return data.results ?? [];
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
      onPending: () => window.dispatchEvent(new CustomEvent('papier:saving')),
      onSettled: () => window.dispatchEvent(new CustomEvent('papier:saved')),
    });

    saverRef.current = saver;
    const onUpdate = () => saver.schedule();
    const onHide = () => saver.flushOnExit();
    const onManualSave = () => saver.flush();
    editor.on('update', onUpdate);
    window.addEventListener('pagehide', onHide);
    window.addEventListener('papier:save', onManualSave);
    // A save refused while signed out resends once signed back in.
    window.addEventListener(SIGNED_IN_EVENT, onUpdate);
    return () => {
      editor.off('update', onUpdate);
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('papier:save', onManualSave);
      window.removeEventListener(SIGNED_IN_EVENT, onUpdate);
      saver.flush();
      saver.dispose();
      if (saverRef.current === saver) saverRef.current = null;
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

  useEffect(() => {
    if (!onEmptyChange) return;
    const check = () => {
      const first = editor.state.doc.firstChild;
      onEmptyChange(editor.state.doc.childCount === 1 && first?.type.name === 'paragraph' && first.content.size === 0);
    };
    check();
    editor.on('update', check);
    return () => {
      editor.off('update', check);
    };
  }, [editor, onEmptyChange]);

  return (
    // The left padding is the gutter for the + / drag handle — inside the page
    // column, so the scroll container can't clip it.
    <div ref={setContainer} className="relative -ml-14 pl-14">
      <EditorContent editor={editor} />
      {iconPick && (
        <Popover anchor={iconPick.anchor} onClose={() => setIconPick(null)} width={340}>
          <div className="flex items-center gap-1 px-1 pt-1 pb-1.5 text-[12px] text-muted" role="group" aria-label="Callout tone">
            Tone
            {/** @type {const} */ (['plain', 'accent']).map((tone) => (
              <button
                key={tone}
                type="button"
                aria-pressed={iconPick.current.tone === tone}
                onClick={() => {
                  iconPick.onChange({ tone });
                  setIconPick({ ...iconPick, current: { ...iconPick.current, tone } });
                }}
                className={`rounded-md px-2 py-0.5 capitalize ${iconPick.current.tone === tone ? 'bg-hover text-fg' : 'hover:bg-hover'}`}
              >
                {tone}
              </button>
            ))}
          </div>
          <Suspense fallback={<div className="h-10" />}>
            <EmojiPicker
              onPick={(emoji) => {
                iconPick.onChange({ icon: emoji });
                setIconPick(null);
              }}
            />
          </Suspense>
        </Popover>
      )}
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
