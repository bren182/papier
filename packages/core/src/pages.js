import { z } from 'zod';
import { generateKeyBetween } from 'fractional-indexing';

export const PageId = z.string().min(1).max(64);

/** A page as the sidebar and page view see it. */
export const Page = z.object({
  id: PageId,
  parentId: PageId.nullable(),
  title: z.string(),
  icon: z.string().nullable(),
  order: z.string(),
  hasChildren: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const PageCreate = z.object({
  parentId: PageId.nullable().default(null),
  title: z.string().max(500).default(''),
});

export const PageUpdate = z
  .object({
    title: z.string().max(500),
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

/** @typedef {z.infer<typeof Page>} Page */
/** @typedef {z.infer<typeof PageCreate>} PageCreate */
/** @typedef {z.infer<typeof PageUpdate>} PageUpdate */
