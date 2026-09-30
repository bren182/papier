import { useEffect, useRef } from 'react';

/**
 * Commands the palette asks the open page to carry out, where the page owns
 * the UI: pick an icon, a cover, customise, move. A tiny event bus, so the
 * palette doesn't need refs into the page.
 * @typedef {'icon' | 'cover' | 'customise' | 'move'} PageAction
 */

const EVENT = 'papier:page-action';

/** @param {PageAction} action */
export function requestPageAction(action) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: action }));
}

/**
 * Run `handler` when the palette requests `action` for the open page.
 * @param {PageAction} action @param {() => void} handler
 */
export function usePageAction(action, handler) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    /** @param {Event} e */
    const on = (e) => {
      if (/** @type {CustomEvent} */ (e).detail === action) latest.current();
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [action]);
}
