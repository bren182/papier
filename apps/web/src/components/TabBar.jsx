import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { pageKeys } from '../api/pages.js';
import { TitleText } from './TitleText.jsx';

const PAGE_DRAG_TYPE = 'application/x-papier-page-id';

/**
 * Horizontal tab strip for explicitly-opened pages.
 * Hidden when there are no open tabs.
 * @param {{
 *   activeId: string | null,
 *   tabs: string[],
 *   closeTab: (id: string) => string | null,
 *   openInNewTab: (id: string) => void,
 *   onSelect: (id: string | null) => void,
 * }} props
 */
export function TabBar({ activeId, tabs, closeTab, openInNewTab, onSelect }) {
  const qc = useQueryClient();
  const [dropOver, setDropOver] = useState(false);

  if (tabs.length === 0) return null;

  /** @param {string} id */
  const pageOf = (id) => /** @type {any} */ (qc.getQueryData(pageKeys.detail(id)))?.page ?? null;

  return (
    <div
      className="flex min-h-0 shrink-0 items-end gap-0 overflow-x-auto border-b border-line bg-s-top px-2"
      style={{ backdropFilter: 'var(--s-top-glass)', WebkitBackdropFilter: 'var(--s-top-glass)' }}
      role="tablist"
      aria-label="Open pages"
    >
      {tabs.map((id) => {
        const page = pageOf(id);
        const active = id === activeId;
        return (
          <div
            key={id}
            role="tab"
            aria-selected={active}
            className={`group relative flex h-8 max-w-[180px] min-w-0 shrink-0 items-center gap-1.5 rounded-t-md border-x border-t px-3 text-[12px] transition-colors ${
              active
                ? 'border-line bg-s-page text-fg-strong'
                : 'border-transparent text-muted hover:bg-white/[0.06] hover:text-fg'
            }`}
          >
            {page?.icon && (
              <span className="shrink-0 text-[11px] leading-none">{page.icon}</span>
            )}
            <button
              type="button"
              onClick={() => onSelect(id)}
              className="min-w-0 flex-1 truncate text-left"
            >
              {page ? (
                <TitleText title={page.title} titleContent={page.titleContent} />
              ) : (
                <span className="text-faint">…</span>
              )}
            </button>
            <button
              type="button"
              aria-label="Close tab"
              onClick={(e) => {
                e.stopPropagation();
                const next = closeTab(id);
                if (next !== null) onSelect(next);
                else if (id === activeId) onSelect(null);
              }}
              className="flex size-4 shrink-0 items-center justify-center rounded opacity-0 hover:bg-white/[0.12] hover:text-fg group-hover:opacity-100"
            >
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        );
      })}

      {/* Drop zone: drag a sidebar page here to open it in a tab */}
      <div
        role="button"
        aria-label="Drop page here to open in new tab"
        tabIndex={-1}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(PAGE_DRAG_TYPE)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setDropOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(/** @type {Node|null} */ (e.relatedTarget))) setDropOver(false);
        }}
        onDrop={(e) => {
          const id = e.dataTransfer.getData(PAGE_DRAG_TYPE);
          if (!id) return;
          e.preventDefault();
          setDropOver(false);
          openInNewTab(id);
          onSelect(id);
        }}
        className={`ml-1 flex h-7 self-center items-center gap-1 rounded-md border px-2 text-[11px] transition-colors ${
          dropOver
            ? 'border-accent bg-accent/10 text-accent'
            : 'border-dashed border-white/15 text-faint/50'
        }`}
      >
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        {dropOver && <span>new tab</span>}
      </div>
    </div>
  );
}
