import { useEffect, useState } from 'react';

/** @typedef {import('../usePrefs.js').Prefs} Prefs */

const toggle =
  'h-7 rounded-md border border-white/10 bg-white/[0.04] px-2.5 text-[13px] text-fg hover:bg-white/[0.08]';

/** @param {{ prefs: Prefs, onChange: (patch: Partial<Prefs>) => void }} props */
export function Topbar({ prefs, onChange }) {
  const online = useServerHealth();
  const ambient = prefs.mode === 'ambient';

  return (
    <header
      className="flex h-11 shrink-0 items-center gap-2 bg-s-top px-4 text-sm"
      style={{ backdropFilter: 'var(--s-top-glass)', WebkitBackdropFilter: 'var(--s-top-glass)' }}
    >
      <span className="text-muted">Roadmap</span>
      <span className="text-faint">/</span>
      <span className="text-fg">v0.1 — it holds my notes</span>
      <span className="flex-1" />

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
