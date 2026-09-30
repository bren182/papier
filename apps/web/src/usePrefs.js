import { useEffect, useState } from 'react';

/**
 * @typedef {{ mode: 'ambient' | 'grayscale', glass: 'frosted' | 'clear', motion: boolean }} Prefs
 */

const KEY = 'papier.prefs';

/** @type {Prefs} */
const DEFAULTS = { mode: 'ambient', glass: 'frosted', motion: true };

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
 * data-mode / data-glass / data-motion so the theme tokens can react.
 */
export function usePrefs() {
  const [prefs, setPrefs] = useState(load);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.mode = prefs.mode;
    root.dataset.glass = prefs.glass;
    root.dataset.motion = prefs.motion ? 'on' : 'off';
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      // storage unavailable (private window etc.): prefs just won't persist
    }
  }, [prefs]);

  /** @param {Partial<Prefs>} patch */
  const update = (patch) => setPrefs((p) => ({ ...p, ...patch }));

  return /** @type {const} */ ([prefs, update]);
}
