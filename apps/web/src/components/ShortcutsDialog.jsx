import { useState } from 'react';
import { keyLabel, SHORTCUTS } from '../shortcuts.js';

/**
 * Every keyboard shortcut, grouped, with a filter. Ctrl/Cmd-/ or the sidebar opens it.
 * @param {{ onClose: () => void }} props
 */
export function ShortcutsDialog({ onClose }) {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const groups = SHORTCUTS.map((g) => ({
    ...g,
    items: g.items.filter((s) => !query || s.label.toLowerCase().includes(query) || s.keys.some((k) => keyLabel(k).toLowerCase() === query)),
  })).filter((g) => g.items.length);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center bg-black/40 px-4 pt-[8vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" className="papier-popover flex h-fit max-h-[80vh] w-full max-w-[760px] flex-col overflow-hidden">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <h2 className="shrink-0 text-[15px] font-semibold text-fg-strong">Keyboard shortcuts</h2>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter…"
            aria-label="Filter shortcuts"
            style={{ outline: 'none' }}
            className="h-12 min-w-0 flex-1 bg-transparent text-[14px] text-fg placeholder:text-faint"
          />
          <button type="button" onClick={onClose} aria-label="Close" className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg">
            ×
          </button>
        </div>
        <div className="grid min-h-0 gap-x-8 gap-y-5 overflow-y-auto px-5 py-4 sm:grid-cols-2">
          {groups.length === 0 && <p className="text-[14px] text-muted">No shortcut matches “{q}”.</p>}
          {groups.map((g) => (
            <section key={g.group} aria-label={g.group}>
              <h3 className="mb-1.5 text-[11px] font-medium tracking-wide text-faint uppercase">{g.group}</h3>
              <ul className="flex flex-col">
                {g.items.map((s) => (
                  <li key={s.label} className="flex items-center justify-between gap-3 border-b border-line/60 py-1.5 last:border-b-0">
                    <span className="text-[13px] text-fg">{s.label}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {s.keys.map((k, i) => (
                        <kbd
                          key={i}
                          className={`min-w-[22px] rounded-[5px] border border-line bg-white/[0.05] px-1.5 py-px text-center text-[12px] text-fg-strong ${s.typed ? 'font-mono' : 'font-sans'}`}
                        >
                          {keyLabel(k)}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
