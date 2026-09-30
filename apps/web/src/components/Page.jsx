import { useState } from 'react';

// Static placeholder content until the block editor exists: the real v0.1 scope.
const SCOPE = [
  'Auth: single owner account, email + password, session cookie',
  'Page tree sidebar: create / rename / nest / drag-reorder / delete to trash',
  'Block editor: paragraph, H1–H3, lists, todo, quote, code, divider',
  'Markdown-style input rules and / slash menu',
  'Keyboard-first editing that feels like Notion',
  'Autosave, per-block, no save button, ever',
  'Full-text search across all pages (SQLite FTS5)',
  'Dark mode only',
  'Runs as one docker compose up on a Linux VM behind HTTPS',
];

export function Page() {
  const [done, setDone] = useState(() => SCOPE.map(() => false));
  const doneCount = done.filter(Boolean).length;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* the cover: a clear window onto the backdrop */}
      <div className="h-[170px]" />

      <div className="p-glass min-h-[calc(100%-170px)] border-t border-white/5 bg-s-page pb-24">
        <article className="mx-auto flex w-full max-w-[720px] flex-col px-6">
          <div className="-mt-[38px] flex size-[76px] items-center justify-center rounded-xl border border-line bg-[#202020]">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--p-ash)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 21v-8" />
              <path d="M12 13c0-4 3-7 7-7 0 4-3 7-7 7z" />
              <path d="M12 15c0-3-2.5-5.5-6-5.5 0 3 2.5 5.5 6 5.5z" />
            </svg>
          </div>

          <h1 className="mt-3.5 mb-2.5 font-display text-[40px] leading-[48px] font-semibold tracking-[-0.01em] text-fg-strong">
            v0.1 — it holds my notes
          </h1>

          <dl className="flex flex-col gap-0.5 border-b border-line pb-3.5 text-sm">
            <div className="flex h-[30px] items-center">
              <dt className="w-40 text-muted">Status</dt>
              <dd className="rounded bg-accent-soft px-2 py-0.5 text-accent-text">Scoping</dd>
            </div>
            <div className="flex h-[30px] items-center">
              <dt className="w-40 text-muted">Milestone</dt>
              <dd className="rounded bg-hover px-2 py-0.5 text-fg">MVP</dd>
            </div>
            <div className="flex h-[30px] items-center">
              <dt className="w-40 text-muted">Progress</dt>
              <dd className="flex items-center gap-3">
                <span className="h-1.5 w-40 overflow-hidden rounded-full bg-line">
                  <span
                    className="block h-full bg-accent transition-[width] duration-300"
                    style={{ width: `${(doneCount / SCOPE.length) * 100}%` }}
                  />
                </span>
                <span className="text-fg tabular-nums">
                  {doneCount} of {SCOPE.length}
                </span>
              </dd>
            </div>
          </dl>

          <div className="mt-4 flex gap-3 rounded-lg bg-s-callout px-4 py-3.5 text-[15px] leading-6">
            <span className="mt-2 size-2 shrink-0 rounded-full bg-accent shadow-[0_0_12px_rgb(123_178_217/0.6)]" />
            <span>Nothing built yet. This page is the living scope doc — jot freely, strike through bad ideas.</span>
          </div>

          <h3 className="mt-6 mb-1 text-xl leading-7 font-semibold text-fg-strong">Scope</h3>

          <ul>
            {SCOPE.map((text, i) => (
              <li key={text} className="group relative -ml-9 flex min-h-[30px] items-center gap-2.5 rounded pl-9 hover:bg-white/[0.05]">
                <span aria-hidden="true" className="absolute top-[7px] left-2 text-faint opacity-0 group-hover:opacity-100">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="9" cy="6" r="1.6" />
                    <circle cx="15" cy="6" r="1.6" />
                    <circle cx="9" cy="12" r="1.6" />
                    <circle cx="15" cy="12" r="1.6" />
                    <circle cx="9" cy="18" r="1.6" />
                    <circle cx="15" cy="18" r="1.6" />
                  </svg>
                </span>
                <label className="flex cursor-pointer items-center gap-2.5">
                  <span className="relative flex size-4 shrink-0">
                    <input
                      type="checkbox"
                      checked={done[i]}
                      onChange={() => setDone((d) => d.map((v, j) => (j === i ? !v : v)))}
                      className="peer size-4 cursor-pointer appearance-none rounded-[3px] border-[1.5px] border-faint checked:border-accent checked:bg-accent"
                    />
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#141414"
                      strokeWidth="3.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="pointer-events-none absolute inset-0.5 hidden peer-checked:block"
                    >
                      <path d="M5 12l5 5 9-10" />
                    </svg>
                  </span>
                  <span className={`text-[15px] leading-6 ${done[i] ? 'text-faint line-through' : 'text-fg'}`}>{text}</span>
                </label>
              </li>
            ))}
          </ul>
        </article>
      </div>
    </div>
  );
}
