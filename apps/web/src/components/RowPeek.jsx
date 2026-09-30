import { Suspense, useEffect, useRef } from 'react';
import { useContentVersion } from '../api/blocks.js';
import { ApiError } from '../api/client.js';
import { usePage } from '../api/pages.js';
import { closePeek, openPeek, usePeek } from '../useSelectedPage.js';
import { PageEditor, RowProperties, TitleEditor } from './Page.jsx';
import { TitleText } from './TitleText.jsx';

/** @typedef {import('../editor/PageEditor.jsx').PageEditorHandle} PageEditorHandle */

/**
 * The side peek: a database row opened beside its database, with ‹ › through
 * the rows of the view it came from and "Open as page". Esc (outside a text
 * field) or a click on the page behind closes it.
 * @param {{ onSelect: (id: string | null) => void }} props
 */
export function RowPeek({ onSelect }) {
  const { id, prev, next } = usePeek();

  useEffect(() => {
    if (!id) return;
    /** @param {KeyboardEvent} e */
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const t = /** @type {HTMLElement | null} */ (e.target);
      // Text fields and editors use Esc themselves; so do menus (they're portalled).
      if (t?.closest('input, textarea, [contenteditable="true"], .papier-popover, [role="dialog"]')) return;
      closePeek();
    };
    /** @param {PointerEvent} e */
    const onDown = (e) => {
      const t = /** @type {HTMLElement | null} */ (e.target);
      // Only clicks on the page behind — not on rows (they switch the peek) or on popovers.
      if (t?.closest('[data-page-scroll]') && !t.closest('[data-row-id]')) closePeek();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [id]);

  if (!id) return null;
  const nav = 'flex size-7 items-center justify-center rounded-md text-muted hover:bg-s-active hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent';
  return (
    <aside
      aria-label="Side peek"
      className="p-glass absolute top-0 right-0 bottom-0 z-30 flex w-[min(640px,100%)] flex-col border-l border-white/10 bg-s-page shadow-[-16px_0_40px_rgb(0_0_0/0.35)]"
    >
      <div className="flex h-11 shrink-0 items-center gap-1 px-3 text-[13px]">
        <button type="button" className={nav} aria-label="Close side peek" title="Close (Esc)" onClick={closePeek}>
          <Glyph path="M13 6l6 6-6 6M5 6l6 6-6 6" />
        </button>
        <button type="button" className={nav} aria-label="Previous row" disabled={!prev} onClick={() => prev && openPeek(prev)}>
          <Glyph path="M6 15l6-6 6 6" />
        </button>
        <button type="button" className={nav} aria-label="Next row" disabled={!next} onClick={() => next && openPeek(next)}>
          <Glyph path="M6 9l6 6 6-6" />
        </button>
        <button
          type="button"
          onClick={() => onSelect(id)}
          className="ml-auto flex h-7 items-center gap-1.5 rounded-md px-2 text-muted hover:bg-s-active hover:text-fg"
        >
          <Glyph path="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /> Open as page
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <PeekBody key={id} id={id} onSelect={onSelect} />
      </div>
    </aside>
  );
}

/** @param {{ id: string, onSelect: (id: string | null) => void }} props */
function PeekBody({ id, onSelect }) {
  const { data, error } = usePage(id);
  const editorRef = useRef(/** @type {PageEditorHandle | null} */ (null));
  const contentVersion = useContentVersion(id);
  if (error) {
    const trashed = error instanceof ApiError && error.status === 404;
    return <p className="px-12 pt-8 text-[14px] text-muted">{trashed ? 'This row is in the trash or doesn’t exist.' : 'Couldn’t load this row.'}</p>;
  }
  if (!data) return null;
  const template = data.page.isTemplate || data.inTemplate;
  return (
    <article className="flex flex-col px-14 pt-4 pb-24">
      {template && (
        <p role="note" className="mb-4 rounded-md border border-dashed border-line px-3 py-2 text-[13px] text-muted">
          {data.page.isTemplate && data.database
            ? `Template in “${data.database.title || 'Untitled'}” — new rows can start as a copy of this.`
            : 'Part of a template — it’s copied along with it.'}
        </p>
      )}
      {data.page.icon && <div className="mb-2 text-[40px] leading-none">{data.page.icon}</div>}
      <div className="page-title font-display text-[32px] leading-[40px] font-semibold tracking-[-0.01em] text-fg-strong">
        <Suspense
          fallback={
            <h1>
              <TitleText title={data.page.title} titleContent={data.page.titleContent} />
            </h1>
          }
        >
          <TitleEditor page={data.page} template={template} onEnter={() => editorRef.current?.focusStart()} />
        </Suspense>
      </div>
      {data.database && (
        <div className="mt-4">
          <Suspense fallback={null}>
            <RowProperties page={data.page} databaseId={data.database.id} values={data.props ?? {}} refs={data.refs} template={data.page.isTemplate} />
          </Suspense>
        </div>
      )}
      <div className="mt-4">
        <Suspense fallback={null}>
          <PageEditor key={`${id}:${contentVersion}`} pageId={id} onOpenPage={onSelect} template={template} ref={editorRef} />
        </Suspense>
      </div>
    </article>
  );
}

/** @param {{ path: string }} props */
function Glyph({ path }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}
