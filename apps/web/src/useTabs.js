import { useCallback, useState } from 'react';
import { pageKeys } from './api/pages.js';
import { useQueryClient } from '@tanstack/react-query';

// v2: bumped to clear tabs that were auto-created by the old behaviour
const STORAGE_KEY = 'papier:tabs:v2';
const MAX_TABS = 20;

/** @returns {string[]} */
function load() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); } catch { return []; }
}

/** @param {string[]} tabs */
function save(tabs) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs)); } catch {}
}

/**
 * Explicitly-opened page tabs, persisted in localStorage.
 * Tabs are only created on demand — never on ordinary navigation.
 * @param {string | null} activeId
 */
export function useTabs(activeId) {
  const [tabs, setTabs] = useState(load);
  const qc = useQueryClient();

  const openInNewTab = useCallback(/** @param {string} id */ (id) => {
    setTabs((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id].slice(-MAX_TABS);
      save(next);
      return next;
    });
  }, []);

  const closeTab = useCallback(
    /** @param {string} id @returns {string | null} */
    (id) => {
      const cur = load();
      const remaining = cur.filter((t) => t !== id);
      save(remaining);
      setTabs(remaining);
      if (id !== activeId) return null;
      const idx = cur.indexOf(id);
      return remaining[Math.max(0, idx - 1)] ?? null;
    },
    [activeId],
  );

  const titleOf = useCallback(
    /** @param {string} id */
    (id) => {
      const detail = qc.getQueryData(pageKeys.detail(id));
      return /** @type {any} */ (detail)?.page?.title ?? null;
    },
    [qc],
  );

  return { tabs, openInNewTab, closeTab, titleOf };
}
