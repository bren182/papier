import { useCallback, useEffect, useState } from 'react';
import { pageKeys } from './api/pages.js';
import { useQueryClient } from '@tanstack/react-query';

const STORAGE_KEY = 'papier:tabs';
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
 * Open-page tabs, persisted in localStorage.
 * Active tab is the URL's ?p= param; this hook syncs it in and out.
 * @param {string | null} activeId
 */
export function useTabs(activeId) {
  const [tabs, setTabs] = useState(load);
  const qc = useQueryClient();

  useEffect(() => {
    if (!activeId) return;
    setTabs((prev) => {
      if (prev.includes(activeId)) return prev;
      const next = [...prev, activeId].slice(-MAX_TABS);
      save(next);
      return next;
    });
  }, [activeId]);

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

  return { tabs, closeTab, titleOf };
}
