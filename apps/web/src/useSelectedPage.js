import { useCallback, useSyncExternalStore } from 'react';

const PARAM = 'p';
/** A block to bring into view once the page is open (e.g. a search hit). */
const BLOCK_PARAM = 'b';
/** A database row shown in the side peek, over the open page. */
const PEEK_PARAM = 'peek';

/** @param {() => void} onChange */
function subscribe(onChange) {
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
}

const read = () => new URLSearchParams(window.location.search).get(PARAM);
const readBlock = () => new URLSearchParams(window.location.search).get(BLOCK_PARAM);
const readPeek = () => new URLSearchParams(window.location.search).get(PEEK_PARAM);

/** @param {URL} url @param {'push' | 'replace'} how @param {unknown} [state] */
function navigate(url, how, state = null) {
  if (how === 'push') window.history.pushState(state, '', url);
  else window.history.replaceState(state ?? window.history.state, '', url);
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
    url.searchParams.delete(PEEK_PARAM);
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

/** The rows around the peeked one (the view it was opened from), for ‹ ›. */
let peekList = /** @type {string[] | null} */ (null);

/**
 * Show a database row in the side peek. Opening pushes a history entry (Back
 * closes it); switching rows while it's open replaces it.
 * @param {string} id
 * @param {string[] | null} [ids]  the rows it's among, in view order
 */
export function openPeek(id, ids = null) {
  if (ids) peekList = ids;
  else if (!peekList?.includes(id)) peekList = null;
  const open = readPeek();
  if (open === id) return;
  const url = new URL(window.location.href);
  url.searchParams.set(PEEK_PARAM, id);
  url.searchParams.delete(BLOCK_PARAM);
  navigate(url, open ? 'replace' : 'push', open ? undefined : { peek: true });
}

/** Close the side peek: back out of the entry that opened it, when there is one. */
export function closePeek() {
  if (!readPeek()) return;
  if (window.history.state?.peek) {
    window.history.back();
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.delete(PEEK_PARAM);
  navigate(url, 'replace');
}

/**
 * The peeked row (?peek=<id>) and its neighbours in the view it came from.
 * @returns {{ id: string | null, prev: string | null, next: string | null }}
 */
export function usePeek() {
  const id = useSyncExternalStore(subscribe, readPeek);
  const i = id && peekList ? peekList.indexOf(id) : -1;
  return { id, prev: i > 0 ? (peekList?.[i - 1] ?? null) : null, next: i >= 0 ? (peekList?.[i + 1] ?? null) : null };
}
