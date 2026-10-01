import { lazy, Suspense, useRef, useState } from 'react';
import { useArchivePage, useMovePage } from '../api/pages.js';
import { useDuplicatePage } from '../api/templates.js';
import { useUpdateWorkspace, useWorkspace } from '../api/workspaces.js';
import { usePageAction } from '../pageActions.js';
import { menuItem, Popover } from './database/Popover.jsx';
import { SearchDialog } from './SearchDialog.jsx';

/** @typedef {import('@papier/core').Page} Page */

const TransferDialog = lazy(() => import('./database/TransferDialog.jsx').then((m) => ({ default: m.TransferDialog })));

/**
 * The open page's ⋯ menu: Duplicate, Set as Home, Save as template, Move to…, Delete —
 * and for a database row, Move / Copy to another database.
 * @param {{ page: Page, databaseId: string | null, onSelect: (id: string | null) => void }} props
 */
export function PageMenu({ page, databaseId, onSelect }) {
  const isRow = Boolean(databaseId);
  const [transfer, setTransfer] = useState(/** @type {'move' | 'copy' | null} */ (null));
  const ref = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [saved, setSaved] = useState(false);
  const duplicate = useDuplicatePage();
  const archive = useArchivePage();
  const move = useMovePage();
  const { workspace } = useWorkspace();
  const setHome = useUpdateWorkspace();
  const isHome = workspace?.homePageId === page.id;
  const close = () => setOpen(false);
  // The command palette's "Move to…".
  usePageAction('move', () => !isRow && !page.isTemplate && setMoving(true));

  return (
    <>
      {saved && <span className="text-[13px] text-muted" role="status">Saved to templates</span>}
      <button
        ref={ref}
        type="button"
        aria-label="Page actions"
        onClick={() => setOpen((o) => !o)}
        className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-s-active hover:text-fg"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
          <path d="M5 12h.01M12 12h.01M19 12h.01" />
        </svg>
      </button>

      {open && (
        <Popover anchor={ref.current} onClose={close} width={220} align="end">
          <button
            type="button"
            className={menuItem}
            onClick={() => {
              close();
              duplicate.mutate({ id: page.id }, { onSuccess: (copy) => onSelect(copy.id) });
            }}
          >
            Duplicate
          </button>
          {!isRow && !page.isTemplate && workspace && workspace.role !== 'viewer' && (
            <button
              type="button"
              className={menuItem}
              onClick={() => {
                close();
                setHome.mutate({ id: workspace.id, homePageId: isHome ? null : page.id });
              }}
            >
              {isHome ? 'Remove as Home' : 'Set as Home'}
            </button>
          )}
          {!page.isTemplate && (
            <button
              type="button"
              className={menuItem}
              onClick={() => {
                close();
                duplicate.mutate(
                  { id: page.id, asTemplate: true },
                  {
                    onSuccess: () => {
                      setSaved(true);
                      setTimeout(() => setSaved(false), 2500);
                    },
                  },
                );
              }}
            >
              {isRow ? 'Save as database template' : 'Save as template'}
            </button>
          )}
          {!isRow && !page.isTemplate && (
            <button
              type="button"
              className={menuItem}
              onClick={() => {
                close();
                setMoving(true);
              }}
            >
              Move to…
            </button>
          )}
          {isRow && !page.isTemplate && (
            <>
              <button
                type="button"
                className={menuItem}
                onClick={() => {
                  close();
                  setTransfer('move');
                }}
              >
                Move to another database…
              </button>
              <button
                type="button"
                className={menuItem}
                onClick={() => {
                  close();
                  setTransfer('copy');
                }}
              >
                Copy to another database…
              </button>
            </>
          )}
          <div className="my-1 h-px bg-line" />
          <button
            type="button"
            className={menuItem}
            onClick={() => {
              close();
              archive.mutate({ id: page.id, parentId: page.parentId }, { onSuccess: () => onSelect(page.parentId) });
            }}
          >
            {page.isTemplate ? 'Delete template' : 'Delete'}
          </button>
        </Popover>
      )}

      {transfer && databaseId && (
        <Suspense fallback={null}>
          <TransferDialog sourceId={databaseId} rowIds={[page.id]} mode={transfer} onClose={() => setTransfer(null)} />
        </Suspense>
      )}
      {moving && (
        <SearchDialog
          label={`Move “${page.title || 'Untitled'}” to…`}
          rootOption
          exclude={page.id}
          onClose={() => setMoving(false)}
          onOpen={(parentId) => move.mutate({ id: page.id, from: page.parentId, parentId })}
        />
      )}
    </>
  );
}
