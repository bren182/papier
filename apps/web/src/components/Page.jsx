import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { ApiError } from '../api/client.js';
import { useContentVersion } from '../api/blocks.js';
import { pageKeys, useCreatePage, usePage } from '../api/pages.js';
import { useDuplicatePage } from '../api/templates.js';
import { TitleText } from './TitleText.jsx';

/** @typedef {import('@papier/core').Page} PageData */
/** @typedef {import('../editor/PageEditor.jsx').PageEditorHandle} PageEditorHandle */
/** Where the template library's "Use" puts a page (`replaceId`: an empty page it replaces). */
/** @typedef {{ parentId: string | null, replaceId?: string }} LibraryTarget */

// The editors (TipTap/ProseMirror) are one lazy chunk; the shell and sidebar
// paint without them.
const loadEditors = () => import('../editor/index.js');
const TitleEditor = lazy(() => loadEditors().then((m) => ({ default: m.TitleEditor })));
const PageEditor = lazy(() => loadEditors().then((m) => ({ default: m.PageEditor })));
const loadDatabases = () => import('./database/index.js');
const DatabaseView = lazy(() => loadDatabases().then((m) => ({ default: m.DatabaseView })));
const RowProperties = lazy(() => loadDatabases().then((m) => ({ default: m.RowProperties })));

const titleClass = 'font-display text-[40px] leading-[48px] font-semibold tracking-[-0.01em] text-fg-strong';

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

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* the cover: a clear window onto the backdrop */}
      <div className="h-[170px]" />

      <div className="p-glass min-h-[calc(100%-170px)] border-t border-white/5 bg-s-page pb-24">
        {/* px-14: room for the block handles, inside the column */}
        <article className={`mx-auto flex w-full flex-col px-14 pt-10 ${isDatabase ? 'max-w-[1240px]' : 'max-w-[784px]'}`}>
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
                    <RowProperties page={data.page} databaseId={data.database.id} values={data.props ?? {}} template={data.page.isTemplate} />
                  </Suspense>
                </div>
              )}
              <div className="mt-4">
                <Suspense fallback={null}>
                  {isDatabase ? (
                    <DatabaseView key={data.page.id} databaseId={data.page.id} onOpenRow={onSelect} />
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
