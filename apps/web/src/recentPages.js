/**
 * Recently opened pages (this device), newest first — the command palette
 * shows them before you type.
 * @typedef {{ id: string, title: string, titleContent: import('@papier/core').InlineContent | null, icon: string | null }} RecentPage
 */

const KEY = 'papier.recentPages';
const MAX = 8;

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
  const entry = { id: page.id, title: page.title, titleContent: page.titleContent, icon: page.icon };
  try {
    localStorage.setItem(KEY, JSON.stringify([entry, ...recentPages().filter((p) => p.id !== page.id)].slice(0, MAX)));
  } catch {
    // no storage: no recents
  }
}

/** Drop a page (it was trashed). @param {string} id */
export function forgetRecent(id) {
  try {
    localStorage.setItem(KEY, JSON.stringify(recentPages().filter((p) => p.id !== id)));
  } catch {
    // no storage
  }
}
