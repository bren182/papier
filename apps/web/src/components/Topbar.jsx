import { usePage, useSetFavorite } from '../api/pages.js';
import { PageMenu } from './PageMenu.jsx';
import { ServerStatus } from './ServerStatus.jsx';
import { TitleText } from './TitleText.jsx';

/** @typedef {import('../usePrefs.js').Prefs} Prefs */

/**
 * @param {{
 *   selectedId: string | null,
 *   onSelect: (id: string | null) => void,
 *   prefs: Prefs,
 *   onChange: (patch: Partial<Prefs>) => void,
 * }} props
 */
export function Topbar({ selectedId, onSelect, prefs, onChange }) {
  const { data } = usePage(selectedId);

  return (
    <header
      className="flex h-11 shrink-0 items-center gap-2 bg-s-top px-4 text-sm"
      style={{
        backdropFilter: 'var(--s-top-glass)',
        WebkitBackdropFilter: 'var(--s-top-glass)',
      }}
    >
      {!prefs.sidebar && (
        <button
          type="button"
          aria-label="Show sidebar"
          title="Show sidebar (Ctrl+\)"
          onClick={() => onChange({ sidebar: true })}
          className="-ml-1.5 flex size-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-s-active hover:text-fg"
        >
          <SidebarIcon />
        </button>
      )}
      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1">
        {data &&
          [...data.ancestors, data.page].map((crumb, i, all) => {
            const last = i === all.length - 1;
            return (
              <span key={crumb.id} className="flex min-w-0 items-center gap-1">
                {i > 0 && <span className="text-faint">/</span>}
                <button
                  type="button"
                  onClick={() => onSelect(crumb.id)}
                  aria-current={last ? 'page' : undefined}
                  className={`max-w-[220px] truncate rounded px-1.5 py-0.5 hover:bg-s-active ${last ? 'text-fg' : 'text-muted'}`}
                >
                  {crumb.icon && <span className="mr-1">{crumb.icon}</span>}
                  <TitleText title={crumb.title} titleContent={crumb.titleContent} />
                </button>
              </span>
            );
          })}
      </nav>

      {/* With the sidebar hidden, its server status (offline only) shows here. */}
      {!prefs.sidebar && <ServerStatus />}
      {data && !data.page.isTemplate && !data.inTemplate && <FavoriteButton page={data.page} />}
      {data && <PageMenu page={data.page} databaseId={data.database?.id ?? null} onSelect={onSelect} />}
    </header>
  );
}

/** A panel-with-sidebar glyph for the show/hide sidebar buttons. */
export function SidebarIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M9.5 4.5v15" />
    </svg>
  );
}

/**
 * Star / unstar the open page (Favourites in the sidebar).
 * @param {{ page: import('@papier/core').Page }} props
 */
function FavoriteButton({ page }) {
  const setFavorite = useSetFavorite();
  const on = Boolean(page.favorite);
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? 'Remove from favourites' : 'Add to favourites'}
      title={on ? 'Remove from favourites' : 'Add to favourites'}
      onClick={() => setFavorite.mutate({ id: page.id, favorite: !on })}
      className={`flex size-7 items-center justify-center rounded-md hover:bg-s-active ${on ? 'text-fg-strong' : 'text-muted hover:text-fg'}`}
    >
      <StarIcon filled={on} />
    </button>
  );
}

/** @param {{ filled?: boolean }} props */
export function StarIcon({ filled = false }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" />
    </svg>
  );
}
