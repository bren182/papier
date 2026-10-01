import { useEffect, useState } from 'react';
import { useAuthState } from '../api/auth.js';
import { useFavorites } from '../api/pages.js';
import { useWorkspace } from '../api/workspaces.js';
import { formatDateLong, toISODate } from '../editor/dates.js';
import { useRecentPages } from '../recentPages.js';
import { TitleText } from './TitleText.jsx';

/** @typedef {import('../editor/WidgetBlock.jsx').WidgetKind} WidgetKind */

/**
 * The editor's widget blocks (see editor/WidgetBlock.jsx).
 * @param {{ kind: WidgetKind, onOpenPage: (id: string) => void }} props
 */
export function HomeWidget({ kind, onOpenPage }) {
  if (kind === 'greeting') return <Greeting />;
  if (kind === 'favorites') return <FavoriteCards onOpenPage={onOpenPage} />;
  return <RecentCards onOpenPage={onOpenPage} />;
}

/** "Good morning" / "Good afternoon" / "Good evening" (from 18:00), by the local hour. @param {Date} now */
export function greetingFor(now) {
  const h = now.getHours();
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** The current time, updated every minute (so the greeting and date roll over). */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function Greeting() {
  const now = useNow();
  const { data } = useAuthState();
  const first = data?.user?.name.trim().split(/\s+/)[0];
  return (
    <div className="flex flex-col gap-1 py-2">
      <div className="font-display text-[32px] leading-10 font-semibold text-fg-strong">
        {greetingFor(now)}
        {first ? `, ${first}` : ''}
      </div>
      <div className="text-[15px] text-muted">{formatDateLong(toISODate(now))}</div>
    </div>
  );
}

/** @param {{ onOpenPage: (id: string) => void }} props */
function FavoriteCards({ onOpenPage }) {
  const { data, isPending } = useFavorites();
  if (isPending) return <div className="h-16" />;
  return <PageCards pages={data ?? []} empty="Star a page (☆ at the top right) to pin it here." onOpenPage={onOpenPage} />;
}

/** @param {{ onOpenPage: (id: string) => void }} props */
function RecentCards({ onOpenPage }) {
  const { workspace } = useWorkspace();
  // Home itself is always the most recent page here; leave it out.
  const recent = useRecentPages().filter((p) => p.id !== workspace?.homePageId);
  return <PageCards pages={recent.slice(0, 6)} empty="Pages you open show up here." onOpenPage={onOpenPage} />;
}

/**
 * A wrapping row of small cards, one per page.
 * @param {{ pages: { id: string, title: string, titleContent: import('@papier/core').InlineContent | null, icon: string | null }[],
 *   empty: string, onOpenPage: (id: string) => void }} props
 */
export function PageCards({ pages, empty, onOpenPage }) {
  if (!pages.length) return <p className="py-2 text-[14px] text-faint">{empty}</p>;
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 py-1">
      {pages.map((p) => (
        <li key={p.id}>
          <button
            type="button"
            onClick={() => onOpenPage(p.id)}
            className="flex h-[76px] w-full flex-col justify-between rounded-lg border border-line bg-white/[0.03] p-3 text-left hover:border-white/15 hover:bg-white/[0.07]"
          >
            <span className="text-[20px] leading-none">{p.icon ?? <span className="text-faint">▤</span>}</span>
            <span className={`truncate text-[14px] font-medium ${p.title ? 'text-fg' : 'text-faint'}`}>
              <TitleText title={p.title || 'Untitled'} titleContent={p.titleContent} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
