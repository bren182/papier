import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_THEME } from '@papier/ui';
import { setAppTheme } from './theme.js';

/**
 * @typedef {{ mode: 'ambient' | 'grayscale', glass: 'frosted' | 'clear', motion: boolean, sidebar: boolean, theme: string }} Prefs
 *   theme: a colour theme id (@papier/ui THEMES)
 */

const KEY = 'papier.prefs';

/** @type {Prefs} */
const DEFAULTS = { mode: 'ambient', glass: 'frosted', motion: true, sidebar: true, theme: DEFAULT_THEME };

/** @returns {Prefs} */
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

/**
 * Display preferences, persisted per device and mirrored onto <html> as
 * data-mode / data-glass / data-motion (and data-theme, via theme.js) so the
 * theme tokens can react.
 */
export function usePrefs() {
  const [prefs, setPrefs] = useState(load);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.mode = prefs.mode;
    root.dataset.glass = prefs.glass;
    root.dataset.motion = prefs.motion ? 'on' : 'off';
    setAppTheme(prefs.theme);
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      // storage unavailable (private window etc.): prefs just won't persist
    }
  }, [prefs]);

  /** A patch, or a function of the current prefs returning one. Stable across renders. */
  const update = useCallback(
    /** @param {Partial<Prefs> | ((p: Prefs) => Partial<Prefs>)} patch */
    (patch) => setPrefs((p) => ({ ...p, ...(typeof patch === 'function' ? patch(p) : patch) })),
    [],
  );

  return /** @type {const} */ ([prefs, update]);
}
