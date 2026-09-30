import { useCallback, useSyncExternalStore } from 'react';

const PARAM = 'p';
/** A block to bring into view once the page is open (e.g. a search hit). */
const BLOCK_PARAM = 'b';

/** @param {() => void} onChange */
function subscribe(onChange) {
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
}

const read = () => new URLSearchParams(window.location.search).get(PARAM);
const readBlock = () => new URLSearchParams(window.location.search).get(BLOCK_PARAM);

/** @param {URL} url @param {'push' | 'replace'} how */
function navigate(url, how) {
  if (how === 'push') window.history.pushState(null, '', url);
  else window.history.replaceState(null, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/**
 * The open page lives in the URL (?p=<id>) so reloads, back/forward and links work.
 * `select(id, blockId)` also asks the page to bring that block into view.
 * @returns {readonly [string | null, (id: string | null, blockId?: string | null) => void]}
 */
export function useSelectedPage() {
  const id = useSyncExternalStore(subscribe, read);

  const select = useCallback((/** @type {string | null} */ next, /** @type {string | null} */ blockId = null) => {
    if (next === read() && !blockId) return;
    const url = new URL(window.location.href);
    if (next) url.searchParams.set(PARAM, next);
    else url.searchParams.delete(PARAM);
    if (blockId) url.searchParams.set(BLOCK_PARAM, blockId);
    else url.searchParams.delete(BLOCK_PARAM);
    navigate(url, 'push');
  }, []);

  return [id, select];
}

/**
 * The block the URL asks to show (?b=<id>), and a way to clear it once shown —
 * without a history entry, so Back doesn't jump to it again.
 * @returns {readonly [string | null, () => void]}
 */
export function useTargetBlock() {
  const blockId = useSyncExternalStore(subscribe, readBlock);
  const clear = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete(BLOCK_PARAM);
    navigate(url, 'replace');
  }, []);
  return [blockId, clear];
}
