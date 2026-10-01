import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { ApiError } from '../api/client.js';
import { useContentVersion } from '../api/blocks.js';
import { pageKeys, useCreatePage, usePage, useRestorePage } from '../api/pages.js';
import { useDuplicatePage } from '../api/templates.js';
import { authKey } from '../api/auth.js';
import { useWorkspace } from '../api/workspaces.js';
import { rememberRecent } from '../recentPages.js';
import { openPeek } from '../useSelectedPage.js';
import { hasCover, layoutClasses, PageCover, PageDecor, usePageMood } from './PageHeader.jsx';
import { TitleText } from './TitleText.jsx';

/** @typedef {import('@papier/core').Page} PageData */
/** @typedef {import('../editor/PageEditor.jsx').PageEditorHandle} PageEditorHandle */
/** Where the template library's "Use" puts a page (`replaceId`: an empty page it replaces). */
/** @typedef {{ parentId: string | null, replaceId?: string }} LibraryTarget */

// The editors (TipTap/ProseMirror) are one lazy chunk; the shell and sidebar
// paint without them.
const loadEditors = () => import('../editor/index.js');
export const TitleEditor = lazy(() => loadEditors().then((m) => ({ default: m.TitleEditor })));
export const PageEditor = lazy(() => loadEditors().then((m) => ({ default: m.PageEditor })));
const loadDatabases = () => import('./database/index.js');
const DatabaseView = lazy(() => loadDatabases().then((m) => ({ default: m.DatabaseView })));
export const RowProperties = lazy(() => loadDatabases().then((m) => ({ default: m.RowProperties })));

const titleClass = 'page-title font-display text-[40px] leading-[48px] font-semibold tracking-[-0.01em] text-fg-strong';

/**
 * @param {{ selectedId: string | null, onSelect: (id: string | null) => void,
 *   onTemplates: (target: LibraryTarget) => void }} props
 */
export function Page({ selectedId, onSelect, onTemplates }) {
  const { data, isPending, error } = usePage(selectedId);
  const editorRef = useRef(/** @type {PageEditorHandle | null} */ (null));
  const contentVersion = useContentVersion(selectedId ?? '');
  const isDatabase = data?.page.kind === 'database';
  // A template, or a page inside one: its dates may stay "today".
  const isTemplate = Boolean(data && (data.page.isTemplate || data.inTemplate));
  const [empty, setEmpty] = useState(false);
  useEffect(() => setEmpty(false), [selectedId]);
  // A brand-new page can still become a database instead.
  const canStartAs = Boolean(data && empty && !isDatabase && !data.database && !data.page.hasChildren);
  const look = data?.page.appearance;
  usePageMood(data?.page);
  useEffect(() => {
    if (data?.page) rememberRecent(data.page);
  }, [data?.page]);
  const width = look?.fullWidth ? 'max-w-none' : isDatabase ? 'max-w-[1240px]' : 'max-w-[784px]';

  const scrollRef = useRef(/** @type {HTMLDivElement|null} */ (null));
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.classList.remove('papier-page-in');
    void el.offsetHeight;
    el.classList.add('papier-page-in');
  }, [selectedId]);

  return (
    <div ref={scrollRef} className="papier-page-in min-h-0 flex-1 overflow-y-auto" data-page-scroll="">
      {/* the cover: a clear window onto the backdrop, or a gradient cover */}
      <PageCover page={data?.page} />

      <div className={`p-glass border-t border-white/5 bg-s-page pb-24 ${hasCover(data?.page) ? 'min-h-[calc(100vh-170px)]' : 'min-h-screen'}`} style={{ paddingBottom: 'max(6rem, calc(6rem + env(safe-area-inset-bottom, 0px)))' }}>
        {/* px-4 on mobile grows to px-14 on sm+ to leave room for block handles */}
        <article className={`mx-auto flex w-full flex-col px-4 pt-10 sm:px-14 ${width} ${layoutClasses(look)}`}>
          {!selectedId ? (
            <EmptyState onSelect={onSelect} />
          ) : error ? (
            error instanceof ApiError && error.status === 404 && error.data.trashed ? (
              <Trashed id={selectedId} onSelect={onSelect} />
            ) : (
              <Message>{error instanceof ApiError && error.status === 404 ? 'This page doesn’t exist.' : 'Couldn’t load this page.'}</Message>
            )
          ) : isPending ? null : (
            <>
              <PageDecor page={data.page} />
              {(data.page.isTemplate || data.inTemplate) && (
                <TemplateBanner page={data.page} database={data.database} inTemplate={data.inTemplate} onSelect={onSelect} />
              )}
              <div className={titleClass}>
                <Suspense
                  fallback={
                    <h1 className={data.page.title ? '' : 'text-[#3d3d3d]'}>
                      <TitleText title={data.page.title} titleContent={data.page.titleContent} />
                    </h1>
                  }
                >
                  <TitleEditor key={data.page.id} page={data.page} template={isTemplate} onEnter={() => editorRef.current?.focusStart()} />
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
                  {isDatabase ? (
                    <DatabaseView key={data.page.id} databaseId={data.page.id} onOpenRow={openPeek} />
                  ) : (
                    <PageEditor
                      key={`${data.page.id}:${contentVersion}`}
                      pageId={data.page.id}
                      onOpenPage={onSelect}
                      onEmptyChange={setEmpty}
                      template={isTemplate}
                      ref={editorRef}
                    />
                  )}
                </Suspense>
              </div>
              {!isDatabase && (
                <div
                  aria-hidden="true"
                  onClick={() => editorRef.current?.focusEnd()}
                  className="group mt-1 min-h-20 cursor-text select-none py-3"
                >
                  <span className="text-[14px] italic text-faint opacity-0 transition-opacity group-hover:opacity-40">
                    Click to keep writing…
                  </span>
                </div>
              )}
              {canStartAs && (
                <StartAs
                  pageId={data.page.id}
                  onTemplate={() => onTemplates({ parentId: data.page.parentId, replaceId: data.page.id })}
                />
              )}
            </>
          )}
        </article>
      </div>
    </div>
  );
}

/**
 * Marks a template (or a page inside one) while you edit it, with the way out.
 * @param {{ page: import('@papier/core').Page, database: { id: string, title: string } | null, inTemplate: boolean,
 *   onSelect: (id: string | null) => void }} props
 */
function TemplateBanner({ page, database, inTemplate, onSelect }) {
  const duplicate = useDuplicatePage();
  const link = 'rounded px-1.5 py-0.5 text-fg hover:bg-white/[0.08]';
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-line px-3 py-2 text-[13px] text-muted" role="note">
      <span className="flex-1">
        {inTemplate && !page.isTemplate
          ? 'Part of a template — it’s copied along with it.'
          : database
            ? `Template in “${database.title || 'Untitled'}” — new rows can start as a copy of this.`
            : 'Template — pages made from it start as a copy of this. Dates set to “Today ↻” become the day it’s used.'}
      </span>
      {page.isTemplate && !database && (
        <button type="button" className={link} disabled={duplicate.isPending} onClick={() => duplicate.mutate({ id: page.id, parentId: null }, { onSuccess: (p) => onSelect(p.id) })}>
          Use template
        </button>
      )}
      {database && (
        <button type="button" className={link} onClick={() => onSelect(database.id)}>
          Back to database
        </button>
      )}
    </div>
  );
}

/**
 * "Start as a table / board / from a template": what a new, empty page can become.
 * @param {{ pageId: string, onTemplate: () => void }} props
 */
function StartAs({ pageId, onTemplate }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  /** @param {'table' | 'board'} layout */
  const convert = async (layout) => {
    setBusy(true);
    try {
      await api(`/pages/${pageId}/convert`, { method: 'POST', body: { layout } });
      await qc.invalidateQueries({ queryKey: pageKeys.all });
    } finally {
      setBusy(false);
    }
  };
  const option = 'flex h-8 items-center gap-2 rounded-md border border-line px-3 text-[13px] text-muted hover:bg-hover hover:text-fg disabled:opacity-50';
  return (
    <div className="mt-6 flex flex-wrap items-center gap-2" aria-label="Start as">
      <span className="mr-1 text-[13px] text-faint">Or start as:</span>
      <button type="button" className={option} disabled={busy} onClick={() => convert('table')}>
        <GridIcon path="M3.5 5.5h17v13h-17zM3.5 10h17M9.5 10v8.5" /> Table
      </button>
      <button type="button" className={option} disabled={busy} onClick={() => convert('board')}>
        <GridIcon path="M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v11h-4z" /> Board
      </button>
      <button type="button" className={option} disabled={busy} onClick={onTemplate}>
        <GridIcon path="M4 4h16v16H4zM8 9h8M8 13h5" /> Template…
      </button>
    </div>
  );
}

/** @param {{ path: string }} props */
function GridIcon({ path }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

/**
 * No page open and no Home yet: set one up (from the starter), or start a page.
 * @param {{ onSelect: (id: string | null) => void }} props
 */
function EmptyState({ onSelect }) {
  const createPage = useCreatePage();
  const qc = useQueryClient();
  const { workspace } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const canSetUp = workspace && workspace.role !== 'viewer';

  const setUp = async () => {
    if (!workspace) return;
    setBusy(true);
    setFailed(false);
    try {
      const { setUpHome } = await import('./homeStarter.js');
      await setUpHome(workspace.id);
      await qc.invalidateQueries({ queryKey: authKey });
      qc.invalidateQueries({ queryKey: pageKeys.all });
      onSelect(null);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-4">
      <h1 className="font-display text-[40px] leading-[48px] font-semibold text-fg-strong">{workspace?.name ?? 'Papier'}</h1>
      <p className="max-w-[520px] text-[15px] leading-6 text-muted">
        {canSetUp
          ? 'Set up a Home to land on: a greeting, your favourite and recent pages, upcoming birthdays and a quick-capture button — all ordinary blocks you can change.'
          : 'Pick a page in the sidebar.'}
      </p>
      <div className="flex gap-2">
        {canSetUp && (
          <button
            type="button"
            disabled={busy}
            onClick={setUp}
            className="h-9 rounded-md bg-accent px-4 text-sm font-medium text-[#141414] hover:bg-accent-text disabled:opacity-60"
          >
            {busy ? 'Setting up…' : 'Set up Home'}
          </button>
        )}
        <button
          type="button"
          disabled={createPage.isPending}
          onClick={() => createPage.mutate({ parentId: null }, { onSuccess: (page) => onSelect(page.id) })}
          className="h-9 rounded-md border border-line px-4 text-sm text-fg hover:bg-hover disabled:opacity-60"
        >
          New page
        </button>
      </div>
      {failed && <p role="alert" className="text-[14px] text-fg">Couldn’t set up Home. Try again?</p>}
    </div>
  );
}

/**
 * An open page that's in the trash (it, or a page above it): offer it back.
 * @param {{ id: string, onSelect: (id: string | null) => void }} props
 */
function Trashed({ id, onSelect }) {
  const restore = useRestorePage();
  return (
    <div className="flex flex-col items-start gap-3">
      <Message>This page is in the trash.</Message>
      <button
        type="button"
        disabled={restore.isPending}
        onClick={() => restore.mutate(id, { onSuccess: () => onSelect(id) })}
        className="h-8 rounded-md border border-line px-3 text-[13px] text-fg hover:bg-hover disabled:opacity-50"
      >
        Restore
      </button>
      {restore.error && <Message>{restore.error.message}</Message>}
    </div>
  );
}

/** @param {{ children: import('react').ReactNode }} props */
function Message({ children }) {
  return <p className="text-[15px] leading-6 text-muted">{children}</p>;
}
