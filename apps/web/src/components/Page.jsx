import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client.js';
import { useCreatePage, usePage, useUpdatePage } from '../api/pages.js';

/** @typedef {import('@papier/core').Page} PageData */

const SAVE_DELAY_MS = 400;

/** @param {{ selectedId: string | null, onSelect: (id: string | null) => void }} props */
export function Page({ selectedId, onSelect }) {
  const { data, isPending, error } = usePage(selectedId);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* the cover: a clear window onto the backdrop */}
      <div className="h-[170px]" />

      <div className="p-glass min-h-[calc(100%-170px)] border-t border-white/5 bg-s-page pb-24">
        <article className="mx-auto flex w-full max-w-[720px] flex-col px-6 pt-10">
          {!selectedId ? (
            <EmptyState onSelect={onSelect} />
          ) : error ? (
            <Message>
              {error instanceof ApiError && error.status === 404
                ? 'This page is in the trash or doesn’t exist.'
                : 'Couldn’t load this page.'}
            </Message>
          ) : isPending ? null : (
            <>
              <TitleEditor key={data.page.id} page={data.page} />
              <p className="mt-4 text-[15px] leading-6 text-faint">Blocks arrive with the editor — next iteration.</p>
            </>
          )}
        </article>
      </div>
    </div>
  );
}

/**
 * Page title, saved as you type (debounced). The sidebar and breadcrumbs update
 * immediately through the optimistic cache write in useUpdatePage.
 * @param {{ page: PageData }} props
 */
function TitleEditor({ page }) {
  const [title, setTitle] = useState(page.title);
  const updatePage = useUpdatePage();
  const ref = useRef(/** @type {HTMLTextAreaElement | null} */ (null));
  const timer = useRef(/** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined));
  const pending = useRef(/** @type {string | null} */ (null));

  const flush = () => {
    clearTimeout(timer.current);
    if (pending.current === null) return;
    updatePage.mutate({ id: page.id, patch: { title: pending.current } });
    pending.current = null;
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;

  // Grow with the text instead of scrolling.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  // Save anything still pending when switching pages.
  useEffect(() => () => flushRef.current(), []);

  /** @param {string} next */
  const onChange = (next) => {
    const clean = next.replace(/\n/g, ' ');
    setTitle(clean);
    pending.current = clean;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY_MS);
  };

  return (
    <textarea
      ref={ref}
      rows={1}
      value={title}
      placeholder="Untitled"
      aria-label="Page title"
      autoFocus={!page.title}
      onChange={(e) => onChange(e.target.value)}
      onBlur={flush}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.preventDefault();
      }}
      className="w-full resize-none overflow-hidden bg-transparent font-display text-[40px] leading-[48px] font-semibold tracking-[-0.01em] text-fg-strong outline-none placeholder:text-[#3d3d3d] focus-visible:outline-none"
    />
  );
}

/** @param {{ onSelect: (id: string | null) => void }} props */
function EmptyState({ onSelect }) {
  const createPage = useCreatePage();
  return (
    <div className="flex flex-col items-start gap-4">
      <h1 className="font-display text-[40px] leading-[48px] font-semibold text-fg-strong">Papier</h1>
      <p className="text-[15px] leading-6 text-muted">Pick a page in the sidebar, or start a new one.</p>
      <button
        type="button"
        disabled={createPage.isPending}
        onClick={() => createPage.mutate({ parentId: null }, { onSuccess: (page) => onSelect(page.id) })}
        className="h-9 rounded-md bg-accent px-4 text-sm font-medium text-[#141414] hover:bg-accent-text disabled:opacity-60"
      >
        New page
      </button>
    </div>
  );
}

/** @param {{ children: import('react').ReactNode }} props */
function Message({ children }) {
  return <p className="text-[15px] leading-6 text-muted">{children}</p>;
}
