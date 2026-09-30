/**
 * Recently opened pages (this device), newest first — the command palette
 * shows them before you type.
 * @typedef {{ id: string, title: string, titleContent: import('@papier/core').InlineContent | null, icon: string | null }} RecentPage
 */

import { useEffect, useState } from 'react';

const KEY = 'papier.recentPages';
const MAX = 8;
const EVENT = 'papier:recents';

/** Recent pages, kept current as pages are opened (the sidebar's Recent). */
export function useRecentPages() {
  const [list, setList] = useState(recentPages);
  useEffect(() => {
    const update = () => setList(recentPages());
    window.addEventListener(EVENT, update);
    window.addEventListener('storage', update); // other tabs
    return () => {
      window.removeEventListener(EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, []);
  return list;
}

/** @param {RecentPage[]} list */
function save(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    // no storage: no recents
  }
  window.dispatchEvent(new Event(EVENT));
}

/** @returns {RecentPage[]} */
export function recentPages() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.slice(0, MAX) : [];
  } catch {
    return [];
  }
}

/** @param {{ id: string, title: string, titleContent: RecentPage['titleContent'], icon: string | null }} page */
export function rememberRecent(page) {
  const entry = {
    id: page.id,
    title: page.title,
    titleContent: page.titleContent,
    icon: page.icon,
  };
  const list = recentPages();
  const same = list[0] && JSON.stringify(list[0]) === JSON.stringify(entry);
  if (!same) save([entry, ...list.filter((p) => p.id !== page.id)]);
}

/** Drop a page (it was trashed). @param {string} id */
export function forgetRecent(id) {
  save(recentPages().filter((p) => p.id !== id));
}
