import { useQueryClient } from '@tanstack/react-query';
import { pageKeys } from '../api/pages.js';
import { useTabs } from '../useTabs.js';
import { TitleText } from './TitleText.jsx';

/**
 * Horizontal tab strip showing open pages. Hidden when only one tab is open.
 * @param {{ activeId: string | null, onSelect: (id: string | null) => void }} props
 */
export function TabBar({ activeId, onSelect }) {
  const { tabs, closeTab } = useTabs(activeId);
  const qc = useQueryClient();

  if (tabs.length <= 1) return null;

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
    </div>
  );
}
