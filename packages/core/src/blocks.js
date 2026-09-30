import { z } from 'zod';

export { plainText } from './text.js';

/**
 * Block types available in v0.1. Later milestones extend this list. These are
 * Papier's own names — the editor maps to/from them, so stored data never
 * depends on the editor library.
 */
export const BLOCK_TYPES = /** @type {const} */ ([
  'paragraph',
  'heading',
  'bulleted_list',
  'numbered_list',
  'todo',
  'quote',
  'code',
  'divider',
  'page', // a sub-page (or a link to another page): props.pageId
]);

export const BlockType = z.enum(BLOCK_TYPES);

export const BlockId = z.string().min(1).max(64);

/**
 * Rich text inside a block: a run of styled text, a link wrapping runs, or an
 * inline node with props (e.g. a date mention `{ type: 'date', props: { date } }`).
 * Loose on purpose — style keys evolve with the editor and aren't queried.
 */
export const InlineNode = z.looseObject({
  type: z.string().min(1).max(32),
});

export const InlineContent = z.array(InlineNode).max(10_000);

/**
 * The atom of the workspace. `parentId` nests blocks within one page (null =
 * top level); `order` is a fractional index key among siblings (README §7).
 */
export const Block = z.object({
  id: BlockId,
  type: BlockType,
  parentId: BlockId.nullable(),
  order: z.string().min(1).max(256),
  props: z.record(z.string(), z.unknown()).default({}),
  content: InlineContent.default([]),
});

/** Autosave payload: changed blocks (full rows) and removed block ids. */
export const BlockBatch = z.object({
  upserts: z.array(Block).max(1000).default([]),
  deletes: z.array(BlockId).max(1000).default([]),
});

/** @typedef {z.infer<typeof BlockType>} BlockTypeName */
/** @typedef {z.infer<typeof InlineContent>} InlineContent */
/** @typedef {z.infer<typeof Block>} Block */
/** @typedef {z.infer<typeof BlockBatch>} BlockBatch */
