import { useEffect, useRef, useState } from 'react';
import { usePage, useSetFavorite } from '../api/pages.js';
import { useAuthState, useLogout } from '../api/auth.js';
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
 *   onAi?: () => void,
 * }} props
 */
export function Topbar({ selectedId, onSelect, prefs, onChange, onAi }) {
  const { data } = usePage(selectedId);
  const { data: auth } = useAuthState();
  const isDemo = auth?.user?.isDemo ?? false;
  const [breadcrumbExpanded, setBreadcrumbExpanded] = useState(false);
  useEffect(() => { setBreadcrumbExpanded(false); }, [selectedId]);

  return (
    <>
    {isDemo && <DemoBanner />}
    <header
      className="flex shrink-0 items-center gap-2 bg-s-top px-4 text-sm"
      style={{
        height: 'calc(2.75rem + env(safe-area-inset-top, 0px))',
        paddingTop: 'env(safe-area-inset-top, 0px)',
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
          className="-ml-1.5 flex size-11 md:size-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-s-active hover:text-fg"
        >
          <SidebarIcon />
        </button>
      )}
      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1">
        {data && (() => {
          const all = [...data.ancestors, data.page];
          const collapsed = all.length > 2 && !breadcrumbExpanded;
          const visible = collapsed ? [all[0], null, all[all.length - 1]] : all;
          return visible.map((crumb, i) => {
            if (crumb === null) {
              return (
                <span key="ellipsis" className="flex min-w-0 items-center gap-1">
                  <span className="text-faint">/</span>
                  <button
                    type="button"
                    onClick={() => setBreadcrumbExpanded(true)}
                    aria-label="Show full path"
                    className="rounded px-1.5 py-0.5 text-muted hover:bg-s-active hover:text-fg"
                  >
                    …
                  </button>
                </span>
              );
            }
            const last = crumb.id === all[all.length - 1].id;
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
          });
        })()}
      </nav>

      {/* With the sidebar hidden, its server status (offline only) shows here. */}
      {!prefs.sidebar && <ServerStatus />}
      <SaveStatus />
      {data && !data.page.isTemplate && !data.inTemplate && <FavoriteButton page={data.page} />}
      {onAi && (
        <button
          type="button"
          aria-label="Ask AI (Ctrl+Shift+A)"
          title="Ask AI (Ctrl+Shift+A)"
          onClick={onAi}
          className="flex h-7 items-center gap-1 rounded-md px-2 text-muted hover:bg-s-active hover:text-fg"
        >
          <span aria-hidden="true" className="text-[13px] font-semibold leading-none">✦</span>
          <span className="text-[11px] font-medium">AI</span>
        </button>
      )}
      {data && <PageMenu page={data.page} databaseId={data.database?.id ?? null} onSelect={onSelect} />}
    </header>
    </>
  );
}

/** A slim banner shown across the top of the app while in demo mode. */
function DemoBanner() {
  const logout = useLogout();
  return (
    <div className="flex shrink-0 items-center justify-center gap-3 bg-accent/15 px-4 py-1.5 text-[12px] text-fg">
      <span>Demo mode — data is temporary and resets after 4 hours</span>
      <button
        type="button"
        onClick={() => logout.mutate()}
        className="rounded-md border border-accent/40 px-2.5 py-0.5 text-accent hover:bg-accent/10"
      >
        Exit demo
      </button>
    </div>
  );
}

/** Fades "Saving…" → "Saved" in the topbar when blocks are written. */
function SaveStatus() {
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const timerRef = useRef(/** @type {ReturnType<typeof setTimeout>|undefined} */ (undefined));
  useEffect(() => {
    const onSaving = () => { clearTimeout(timerRef.current); setSaving(true); setShow(true); };
    const onSaved = () => {
      setSaving(false);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setShow(false), 1200);
    };
    window.addEventListener('papier:saving', onSaving);
    window.addEventListener('papier:saved', onSaved);
    return () => {
      window.removeEventListener('papier:saving', onSaving);
      window.removeEventListener('papier:saved', onSaved);
      clearTimeout(timerRef.current);
    };
  }, []);
  return (
    <span
      aria-live="polite"
      aria-atomic="true"
      className={`min-w-[44px] text-right text-[12px] transition-opacity duration-500 ${show ? 'opacity-100 text-faint' : 'opacity-0 pointer-events-none'}`}
    >
      {saving ? 'Saving…' : 'Saved'}
    </span>
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
      className={`flex h-7 items-center gap-1 rounded-md px-2 hover:bg-s-active ${on ? 'text-fg-strong' : 'text-muted hover:text-fg'}`}
    >
      <StarIcon filled={on} />
      <span className="text-[11px] font-medium">{on ? 'Starred' : 'Star'}</span>
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
