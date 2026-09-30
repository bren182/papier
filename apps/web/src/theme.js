import { DEFAULT_THEME } from '@papier/ui';

/**
 * Which colour theme <html data-theme> shows: the open page's mood if it has
 * one, else the app's theme (a pref). Both write here; the page's wins.
 */
let appTheme = DEFAULT_THEME;
/** @type {string | null} */
let mood = null;

const apply = () => {
  document.documentElement.dataset.theme = mood ?? appTheme;
};

/** @param {string} id */
export function setAppTheme(id) {
  appTheme = id;
  apply();
}

/** The open page's mood (null: none, show the app's theme). @param {string | null} id */
export function setMood(id) {
  mood = id;
  apply();
}
