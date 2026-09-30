/**
 * Colour themes: each swaps the backdrop palette (--p-walnut/olive/steel/sky/ash)
 * and the one accent — the CSS lives in theme.css under [data-theme='…']. Text
 * and surfaces stay grayscale, so a theme changes the mood, never legibility.
 * A page can set its own mood (a theme id) while it's open.
 *
 * `swatches` are for pickers: the palette, darkest first, then the accent.
 */
export const THEMES = /** @type {const} */ ([
  { id: 'forest', name: 'Forest', swatches: ['#46351d', '#646f4b', '#839d9a', '#bfd2bf', '#7bb2d9'] },
  { id: 'dusk', name: 'Dusk', swatches: ['#3b2238', '#6b3f5c', '#a27a9a', '#f0cfd6', '#d99ab4'] },
  { id: 'ocean', name: 'Ocean', swatches: ['#10303a', '#1f5560', '#4f8f9a', '#bfe6ea', '#6cc3d5'] },
  { id: 'ember', name: 'Ember', swatches: ['#4a2414', '#7a3b1c', '#b0703f', '#f2d3a8', '#e8a45c'] },
  { id: 'meadow', name: 'Meadow', swatches: ['#3d3a17', '#5f6b2b', '#9aa56a', '#e3e8c2', '#cdbb62'] },
  { id: 'frost', name: 'Frost', swatches: ['#26303d', '#3e5166', '#8aa3bd', '#e6eef7', '#a9c8ea'] },
]);

export const DEFAULT_THEME = 'forest';

/**
 * Page covers without uploads: gradients drawn from the active palette, so a
 * cover follows the theme (and the page's mood). `clear` is the plain window
 * onto the backdrop. Image covers ('asset:…') come with uploads.
 */
export const COVERS = /** @type {const} */ ([
  { id: 'clear', name: 'Clear', css: 'none' },
  { id: 'dawn', name: 'Dawn', css: 'linear-gradient(115deg, var(--p-walnut) 0%, var(--p-steel) 55%, var(--p-sky) 100%)' },
  {
    id: 'canopy',
    name: 'Canopy',
    css: 'radial-gradient(ellipse at 20% 110%, var(--p-olive) 0%, transparent 60%), linear-gradient(180deg, var(--p-steel) 0%, var(--p-walnut) 100%)',
  },
  { id: 'tide', name: 'Tide', css: 'linear-gradient(160deg, var(--p-walnut) 0%, var(--p-steel) 45%, var(--p-sky) 80%, var(--p-ash) 100%)' },
  {
    id: 'embers',
    name: 'Embers',
    css: 'radial-gradient(circle at 82% 18%, var(--p-sky) 0%, transparent 42%), linear-gradient(90deg, var(--p-walnut) 0%, var(--p-olive) 100%)',
  },
  { id: 'mist', name: 'Mist', css: 'linear-gradient(180deg, var(--p-ash) 0%, var(--p-steel) 70%, var(--p-olive) 100%)' },
  { id: 'night', name: 'Night', css: 'linear-gradient(200deg, var(--p-walnut) 0%, #0c0c0d 75%)' },
]);

/** @param {string | null | undefined} id */
export const coverCss = (id) => COVERS.find((c) => c.id === id)?.css ?? 'none';
