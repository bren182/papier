import { z } from 'zod';
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import { InlineContent } from './blocks.js';

export const PageId = z.string().min(1).max(64);

export const PAGE_KINDS = /** @type {const} */ (['page', 'database']);
export const PageKind = z.enum(PAGE_KINDS);

/** A page as the sidebar and page view see it. */
export const Page = z.object({
  id: PageId,
  parentId: PageId.nullable(),
  /** Plain text (dates as ISO) — for search, sorting and fallbacks. */
  title: z.string(),
  /** Rich title (text + live date mentions); null for plain-text titles. */
  titleContent: InlineContent.nullable(),
  icon: z.string().nullable(),
  /** 'database' pages hold rows (their child pages) instead of sub-pages. */
  kind: PageKind,
  order: z.string(),
  hasChildren: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const PageCreate = z.object({
  parentId: PageId.nullable().default(null),
  title: z.string().max(500).default(''),
  kind: PageKind.default('page'),
  /** Append a page block to the parent's content. False when the editor inserts its own. */
  block: z.boolean().default(true),
});

/** Move a page: to a new parent (null = root), before or after a sibling there (default: last). */
export const PageMove = z
  .object({
    parentId: PageId.nullable(),
    beforeId: PageId.optional(),
    afterId: PageId.optional(),
  })
  .refine((v) => !(v.beforeId && v.afterId), 'Give beforeId or afterId, not both');

export const PageUpdate = z
  .object({
    title: z.string().max(500),
    /** When given, the server derives `title` from it. A title-only patch clears it. */
    titleContent: InlineContent.max(200),
    icon: z.string().max(64).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

/**
 * Order key that sorts between `before` and `after` (either may be null for the
 * ends). Fractional indexing: reordering never renumbers siblings.
 * @param {string | null} before
 * @param {string | null} after
 */
export function orderBetween(before, after) {
  return generateKeyBetween(before, after);
}

/**
 * Order keys for a sibling list after an edit. `keys` are the siblings' current
 * keys in their new order (null for new items). The longest run that is still
 * increasing is kept, and only the rest get fresh keys — moving one item rewrites one row.
 * @param {(string | null)[]} keys
 * @returns {string[]}
 */
export function rebalanceOrder(keys) {
  // Longest strictly increasing subsequence of the existing keys (patience sort).
  /** @type {number[]} */ const tails = []; // index into keys of the smallest tail per length
  /** @type {number[]} */ const prev = new Array(keys.length).fill(-1);
  keys.forEach((key, i) => {
    if (key === null) return;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (/** @type {string} */ (keys[/** @type {number} */ (tails[mid])]) < key) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = /** @type {number} */ (tails[lo - 1]);
    tails[lo] = i;
  });

  const kept = new Set();
  for (let i = tails.length ? /** @type {number} */ (tails[tails.length - 1]) : -1; i !== -1; i = /** @type {number} */ (prev[i])) {
    kept.add(i);
  }

  /** @type {string[]} */ const out = new Array(keys.length);
  let start = 0; // first index of the current gap
  for (let i = 0; i <= keys.length; i++) {
    if (i < keys.length && !kept.has(i)) continue;
    const lower = start > 0 ? /** @type {string} */ (out[start - 1]) : null;
    const upper = i < keys.length ? /** @type {string} */ (keys[i]) : null;
    generateNKeysBetween(lower, upper, i - start).forEach((k, j) => (out[start + j] = k));
    if (i < keys.length) out[i] = upper ?? '';
    start = i + 1;
  }
  return out;
}

/** @typedef {z.infer<typeof Page>} Page */
/** @typedef {z.infer<typeof PageCreate>} PageCreate */
/** @typedef {z.infer<typeof PageUpdate>} PageUpdate */
