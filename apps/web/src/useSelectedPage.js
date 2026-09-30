import { useCallback, useSyncExternalStore } from 'react';

const PARAM = 'p';

/** @param {() => void} onChange */
function subscribe(onChange) {
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
}

const read = () => new URLSearchParams(window.location.search).get(PARAM);

/**
 * The open page lives in the URL (?p=<id>) so reloads, back/forward and links work.
 * @returns {readonly [string | null, (id: string | null) => void]}
 */
export function useSelectedPage() {
  const id = useSyncExternalStore(subscribe, read);

  const select = useCallback((/** @type {string | null} */ next) => {
    if (next === read()) return;
    const url = new URL(window.location.href);
    if (next) url.searchParams.set(PARAM, next);
    else url.searchParams.delete(PARAM);
    window.history.pushState(null, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, []);

  return [id, select];
}
