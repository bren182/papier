import { useEffect, useState } from 'react';
import { useAuthState } from '../api/auth.js';
import { useFavorites } from '../api/pages.js';
import { useWorkspace } from '../api/workspaces.js';
import { useReminders } from '../api/reminders.js';
import { ensurePushSubscription, removePushSubscription } from '../api/push.js';
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

/**
 * Fire an in-app Notification for each reminder due today (once per session).
 * This is the fallback for when the app is open; push covers the closed case.
 * @param {import('../api/reminders.js').Reminder[]} due
 * @param {string} today
 */
function fireBrowserNotifications(due, today) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const key = `notif-fired-${today}`;
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

/**
 * Ask for notification permission (once per device). On grant, also subscribes
 * to Web Push so notifications fire even when the app is closed.
 */
async function requestAndSubscribe() {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'granted') {
    await ensurePushSubscription();
    return;
  }
  if (Notification.permission !== 'default') return;
  try {
    if (localStorage.getItem('notif-asked')) return;
    localStorage.setItem('notif-asked', '1');
  } catch { /* private mode */ }
  const perm = await Notification.requestPermission().catch(() => 'denied');
  if (perm === 'granted') await ensurePushSubscription();
}

/** @param {{ onOpenPage: (id: string) => void }} props */
function RemindersWidget({ onOpenPage }) {
  const today = toISODate(new Date());
  const { data: due, isPending } = useReminders(today);
  const [notifState, setNotifState] = useState(
    () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission),
  );

  // On first load with data: ask for permission + subscribe to push, fire in-app notifs
  useEffect(() => {
    if (!due) return;
    requestAndSubscribe().then(() => {
      if (typeof Notification !== 'undefined') setNotifState(Notification.permission);
    });
    fireBrowserNotifications(due.filter((r) => r.date === today), today);
  }, [due, today]);

  if (isPending) return <div className="h-12" />;

  return (
    <div className="flex flex-col gap-2">
      {/* Prompt to enable if not yet granted */}
      {notifState === 'default' && (
        <button
          type="button"
          onClick={() => requestAndSubscribe().then(() => {
            if (typeof Notification !== 'undefined') setNotifState(Notification.permission);
          })}
          className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-[13px] text-muted hover:bg-s-active hover:text-fg"
        >
          <span aria-hidden="true">🔔</span>
          Enable notifications to get reminders when the app is closed
        </button>
      )}
      {notifState === 'granted' && (
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-faint">Push notifications on</span>
          <button
            type="button"
            onClick={() => removePushSubscription().then(() => setNotifState('denied'))}
            className="text-[12px] text-faint hover:text-muted"
          >
            Turn off
          </button>
        </div>
      )}
      {(!due || due.length === 0) ? (
        <p className="py-1 text-[14px] text-faint">No reminders due. Add @remind dates in pages.</p>
      ) : (
        <ul className="flex flex-col gap-1">
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
      )}
    </div>
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
