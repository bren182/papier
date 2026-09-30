import { z } from 'zod';
import { FILTER_OPS, PROPERTY_TYPES } from './props.js';

export * from './props.js';

export const PropertyId = z.string().min(1).max(64);
export const PropertyType = z.enum(PROPERTY_TYPES);

export const SelectOption = z.object({
  /** Omitted for new options; the server assigns one. */
  id: z.string().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(100),
});

export const PropertyConfig = z
  .object({
    options: z.array(SelectOption).max(500),
    format: z.enum(['number', 'percent']),
  })
  .partial();

export const PropertyCreate = z.object({
  name: z.string().trim().min(1).max(100),
  type: PropertyType,
  config: PropertyConfig.default({}),
  /** Insert after this property (default: last). */
  afterId: PropertyId.optional(),
});

export const PropertyUpdate = z
  .object({
    name: z.string().trim().min(1).max(100),
    type: PropertyType,
    config: PropertyConfig,
    /** Move: before/after a sibling property. */
    beforeId: PropertyId,
    afterId: PropertyId,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const VIEW_TYPES = /** @type {const} */ (['table', 'board']);
export const ViewType = z.enum(VIEW_TYPES);

export const Sort = z.object({ propId: PropertyId, dir: z.enum(['asc', 'desc']).default('asc') });

export const Filter = z
  .object({
    propId: PropertyId,
    op: z.string().max(32),
    value: z.union([z.string().max(2048), z.number(), z.boolean(), z.null()]).optional(),
  })
  .refine((f) => Object.values(FILTER_OPS).some((ops) => ops.includes(f.op)), 'Unknown filter operator');

export const ViewConfig = z.object({
  sorts: z.array(Sort).max(10).default([]),
  filters: z.array(Filter).max(20).default([]),
  /** Property ids hidden in this view. */
  hidden: z.array(PropertyId).max(500).default([]),
  /** Column widths in px by property id. */
  widths: z.record(PropertyId, z.number().int().min(60).max(1200)).default({}),
  /** Column order (property ids); unlisted properties follow in schema order. */
  propOrder: z.array(PropertyId).max(500).default([]),
  /** Board: the select property that defines the columns. */
  groupBy: PropertyId.nullable().default(null),
});

export const ViewCreate = z.object({
  name: z.string().trim().min(1).max(100).default('View'),
  type: ViewType.default('table'),
  config: ViewConfig.default(ViewConfig.parse({})),
});

export const ViewUpdate = z
  .object({
    name: z.string().trim().min(1).max(100),
    type: ViewType,
    config: ViewConfig,
    beforeId: z.string().min(1).max(64),
    afterId: z.string().min(1).max(64),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

/**
 * Rows of a database. Sorts/filters come from `viewId` unless given; `group`
 * narrows to one board column (`groupBy` property = value, null = no value).
 */
export const DatabaseQuery = z.object({
  viewId: z.string().min(1).max(64).optional(),
  sorts: z.array(Sort).max(10).optional(),
  filters: z.array(Filter).max(20).optional(),
  group: z.object({ propId: PropertyId, value: z.string().max(64).nullable() }).optional(),
  offset: z.number().int().min(0).max(1_000_000).default(0),
  limit: z.number().int().min(1).max(200).default(50),
  /** The viewer's `Date#getTimezoneOffset()`, so created/edited-time filters use local days. */
  tzOffset: z.number().int().min(-900).max(900).default(0),
});

export const RowCreate = z.object({
  title: z.string().max(500).default(''),
  props: z.record(PropertyId, z.unknown()).default({}),
  beforeId: z.string().min(1).max(64).optional(),
  afterId: z.string().min(1).max(64).optional(),
});

export const RowMove = z
  .object({ beforeId: z.string().min(1).max(64).optional(), afterId: z.string().min(1).max(64).optional() })
  .refine((v) => !(v.beforeId && v.afterId), 'Give beforeId or afterId, not both');

/** `PATCH /api/pages/:id/props`: property id → value (null clears). */
export const PropsPatch = z.record(PropertyId, z.unknown()).refine((v) => Object.keys(v).length > 0, 'Nothing to update');

/** @typedef {z.infer<typeof ViewConfig>} ViewConfig */
/** @typedef {z.infer<typeof DatabaseQuery>} DatabaseQuery */
/** @typedef {z.infer<typeof Filter>} Filter */
/** @typedef {z.infer<typeof Sort>} Sort */
