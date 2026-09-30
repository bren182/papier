import { useEffect, useState } from 'react';
import { usePage } from '../api/pages.js';
import { TitleText } from './TitleText.jsx';

/** @typedef {import('../usePrefs.js').Prefs} Prefs */

const toggle =
  'h-7 rounded-md border border-white/10 bg-white/[0.04] px-2.5 text-[13px] text-fg hover:bg-white/[0.08]';

/**
 * @param {{
 *   selectedId: string | null,
 *   onSelect: (id: string | null) => void,
 *   prefs: Prefs,
 *   onChange: (patch: Partial<Prefs>) => void,
 * }} props
 */
export function Topbar({ selectedId, onSelect, prefs, onChange }) {
  const online = useServerHealth();
  const ambient = prefs.mode === 'ambient';
  const { data } = usePage(selectedId);

  return (
    <header
      className="flex h-11 shrink-0 items-center gap-2 bg-s-top px-4 text-sm"
      style={{ backdropFilter: 'var(--s-top-glass)', WebkitBackdropFilter: 'var(--s-top-glass)' }}
    >
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
                  <TitleText title={crumb.title} titleContent={crumb.titleContent} />
                </button>
              </span>
            );
          })}
      </nav>

      <span className="flex items-center gap-1.5 text-[13px] text-muted" title="API server status">
        <span className={`size-2 rounded-full ${online ? 'bg-accent' : 'bg-faint'}`} />
        {online === null ? 'Connecting…' : online ? 'Server online' : 'Server offline'}
      </span>

      <button type="button" className={toggle} onClick={() => onChange({ mode: ambient ? 'grayscale' : 'ambient' })}>
        {ambient ? 'Grayscale' : 'Ambient'}
      </button>
      {ambient && (
        <button
          type="button"
          className={toggle}
          aria-pressed={prefs.glass === 'clear'}
          onClick={() => onChange({ glass: prefs.glass === 'clear' ? 'frosted' : 'clear' })}
        >
          {prefs.glass === 'clear' ? 'Frosted glass' : 'Clear glass'}
        </button>
      )}
      <button type="button" className={toggle} onClick={() => onChange({ motion: !prefs.motion })}>
        {prefs.motion ? 'Pause motion' : 'Play motion'}
      </button>
    </header>
  );
}

/** @returns {boolean | null} null while the first check is in flight */
function useServerHealth() {
  const [online, setOnline] = useState(/** @type {boolean | null} */ (null));

  useEffect(() => {
    let cancelled = false;
    const check = () =>
      fetch('/api/health')
        .then((res) => res.ok)
        .catch(() => false)
        .then((ok) => {
          if (!cancelled) setOnline(ok);
        });
    check();
    const id = setInterval(check, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return online;
}
