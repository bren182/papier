import { z } from 'zod';

/** Block types available in v0.1. Later milestones extend this list. */
export const BLOCK_TYPES = /** @type {const} */ ([
  'paragraph',
  'heading',
  'bulleted_list',
  'numbered_list',
  'todo',
  'quote',
  'code',
  'divider',
]);

export const BlockType = z.enum(BLOCK_TYPES);

/**
 * The atom of the workspace. `order` is a fractional index key (see README §7),
 * so reordering is a single write.
 */
export const Block = z.object({
  id: z.string().min(1),
  type: BlockType,
  parentId: z.string().min(1).nullable(),
  order: z.string().min(1),
  props: z.record(z.string(), z.unknown()).default({}),
  content: z.string().default(''),
});

/** @typedef {z.infer<typeof BlockType>} BlockTypeName */
/** @typedef {z.infer<typeof Block>} Block */
