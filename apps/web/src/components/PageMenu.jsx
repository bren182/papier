import { useRef, useState } from 'react';
import { useArchivePage, useMovePage } from '../api/pages.js';
import { useDuplicatePage } from '../api/templates.js';
import { menuItem, Popover } from './database/Popover.jsx';
import { SearchDialog } from './SearchDialog.jsx';

/** @typedef {import('@papier/core').Page} Page */

/**
 * The open page's ⋯ menu: Duplicate, Save as template, Move to…, Delete.
 * @param {{ page: Page, isRow: boolean, onSelect: (id: string | null) => void }} props
 */
export function PageMenu({ page, isRow, onSelect }) {
  const ref = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [saved, setSaved] = useState(false);
  const duplicate = useDuplicatePage();
  const archive = useArchivePage();
  const move = useMovePage();
  const close = () => setOpen(false);

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
