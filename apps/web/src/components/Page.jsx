import { lazy, Suspense, useRef } from 'react';
import { ApiError } from '../api/client.js';
import { useContentVersion } from '../api/blocks.js';
import { useCreatePage, usePage } from '../api/pages.js';
import { TitleText } from './TitleText.jsx';

/** @typedef {import('@papier/core').Page} PageData */
/** @typedef {import('../editor/PageEditor.jsx').PageEditorHandle} PageEditorHandle */

// The editors (TipTap/ProseMirror) are one lazy chunk; the shell and sidebar
// paint without them.
const loadEditors = () => import('../editor/index.js');
const TitleEditor = lazy(() => loadEditors().then((m) => ({ default: m.TitleEditor })));
const PageEditor = lazy(() => loadEditors().then((m) => ({ default: m.PageEditor })));

const titleClass = 'font-display text-[40px] leading-[48px] font-semibold tracking-[-0.01em] text-fg-strong';

/** @param {{ selectedId: string | null, onSelect: (id: string | null) => void }} props */
export function Page({ selectedId, onSelect }) {
  const { data, isPending, error } = usePage(selectedId);
  const editorRef = useRef(/** @type {PageEditorHandle | null} */ (null));
  const contentVersion = useContentVersion(selectedId ?? '');

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* the cover: a clear window onto the backdrop */}
      <div className="h-[170px]" />

      <div className="p-glass min-h-[calc(100%-170px)] border-t border-white/5 bg-s-page pb-24">
        {/* px-14: room for the block handles, inside the column */}
        <article className="mx-auto flex w-full max-w-[784px] flex-col px-14 pt-10">
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
              <div className={titleClass}>
                <Suspense
                  fallback={
                    <h1 className={data.page.title ? '' : 'text-[#3d3d3d]'}>
                      <TitleText title={data.page.title} titleContent={data.page.titleContent} />
                    </h1>
                  }
                >
                  <TitleEditor key={data.page.id} page={data.page} onEnter={() => editorRef.current?.focusStart()} />
                </Suspense>
              </div>
              <div className="mt-4">
                <Suspense fallback={null}>
                  <PageEditor key={`${data.page.id}:${contentVersion}`} pageId={data.page.id} onOpenPage={onSelect} ref={editorRef} />
                </Suspense>
              </div>
            </>
          )}
        </article>
      </div>
    </div>
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
