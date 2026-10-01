import { useEffect, useState } from 'react';
import { useAuthState } from '../api/auth.js';
import { useFavorites } from '../api/pages.js';
import { useWorkspace } from '../api/workspaces.js';
import { useReminders } from '../api/reminders.js';
import { formatDateLong, formatDateMention, toISODate } from '../editor/dates.js';
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
  if (kind === 'reminders') return <RemindersWidget onOpenPage={onOpenPage} />;
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

// ── Reminders widget ──────────────────────────────────────────────────────────

/** Request browser notification permission once, stored in localStorage to avoid re-asking. */
function requestNotifPermission() {
  if (typeof Notification === 'undefined' || Notification.permission !== 'default') return;
  try {
    if (localStorage.getItem('notif-asked')) return;
    localStorage.setItem('notif-asked', '1');
  } catch { /* private mode */ }
  Notification.requestPermission().catch(() => {});
}

/**
 * Fire a native notification for each reminder due today (once per session per id).
 * @param {import('../api/reminders.js').Reminder[]} due
 */
function fireBrowserNotifications(due) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const key = `notif-fired-${toISODate(new Date())}`;
  let fired = /** @type {string[]} */ ([]);
  try { fired = JSON.parse(localStorage.getItem(key) ?? '[]'); } catch { /* */ }
  for (const r of due) {
    if (fired.includes(r.id)) continue;
    new Notification(`Reminder: ${r.pageTitle || 'Untitled'}`, {
      body: formatDateLong(r.date),
      icon: '/favicon.ico',
      tag: r.id,
    });
    fired.push(r.id);
  }
  try { localStorage.setItem(key, JSON.stringify(fired)); } catch { /* */ }
}

/** @param {{ onOpenPage: (id: string) => void }} props */
function RemindersWidget({ onOpenPage }) {
  const today = toISODate(new Date());
  const { data: due, isPending } = useReminders(today);

  useEffect(() => {
    if (!due) return;
    requestNotifPermission();
    fireBrowserNotifications(due.filter((r) => r.date === today));
  }, [due, today]);

  if (isPending) return <div className="h-12" />;
  if (!due || due.length === 0) {
    return <p className="py-2 text-[14px] text-faint">No reminders due. Add @remind dates in pages.</p>;
  }

  return (
    <ul className="flex flex-col gap-1 py-1">
      {due.map((r) => {
        const overdue = r.date < today;
        return (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onOpenPage(r.pageId)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover"
            >
              <span className="text-[16px] leading-none">{r.pageIcon ?? '🔔'}</span>
              <span className="flex-1 min-w-0">
                <span className="block truncate text-[14px] font-medium text-fg">{r.pageTitle || 'Untitled'}</span>
                <span className={`text-[12px] ${overdue ? 'text-red-400' : 'text-muted'}`}>
                  {overdue ? 'Overdue · ' : ''}{formatDateMention(r.date)}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
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
