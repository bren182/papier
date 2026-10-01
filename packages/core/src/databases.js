import { z } from 'zod';
import { MAX_ACTIONS } from './actions.js';
import { MAX_FORMULA } from './formula.js';
import { FILTER_OPS, PROPERTY_TYPES, ROLLUP_FN_NAMES } from './props.js';

export * from './actions.js';
export * from './formula.js';
export * from './props.js';

export const PropertyId = z.string().min(1).max(64);
export const PropertyType = z.enum(PROPERTY_TYPES);

export const SelectOption = z.object({
  /** Omitted for new options; the server assigns one. */
  id: z.string().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(100),
});

const Ref = z.string().min(1).max(64).nullable();
const Id = z.string().min(1).max(64);

/** One action (see actions.js). Values are checked against their property when it runs. */
export const Action = z.discriminatedUnion('type', [
  z.object({ type: z.literal('set'), propId: Id, value: z.unknown() }),
  z.object({ type: z.literal('set_today'), propId: Id }),
  z.object({
    type: z.literal('shift_date'),
    propId: Id,
    amount: z.number().int().min(-10_000).max(10_000),
    unit: z.enum(['day', 'week', 'month', 'year']),
    from: z.enum(['value', 'today']).default('value'),
  }),
  z.object({ type: z.literal('check'), propId: Id, to: z.union([z.boolean(), z.literal('toggle')]) }),
  z.object({ type: z.literal('add_number'), propId: Id, amount: z.number().finite() }),
  z.object({ type: z.literal('link'), propId: Id, rowIds: z.array(Id).max(100), mode: z.enum(['add', 'remove']) }),
  z.object({ type: z.literal('set_formula'), propId: Id, formula: z.string().max(MAX_FORMULA) }),
  z.object({
    type: z.literal('add_row'),
    databaseId: Id,
    templateId: Id.nullable().optional(),
    title: z.string().max(500).optional(),
    values: z.record(Id, z.unknown()).default({}),
  }),
]);

export const Actions = z.array(Action).max(MAX_ACTIONS);

/** Running a button (or an automation by hand): the viewer's day, for "today". */
export const ActionRun = z.object({
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tzOffset: z.number().int().min(-900).max(900).default(0),
});

/** Put back what a run changed: values as they were, rows it added go to the trash. */
export const ActionUndo = z.object({
  rows: z.array(z.object({ id: Id, props: z.record(Id, z.unknown()) })).max(1000).default([]),
  created: z.array(Id).max(1000).default([]),
});

/**
 * One config shape for every type; each type reads its own keys. `reverseId` /
 * `reverseOf` are managed by the server (input ones are ignored); `twoWay` is
 * input only — it adds or removes a relation's twin in the target database.
 */
export const PropertyConfig = z
  .object({
    options: z.array(SelectOption).max(500),
    format: z.enum(['number', 'percent']),
    databaseId: Ref,
    reverseId: Ref,
    reverseOf: Ref,
    twoWay: z.boolean(),
    relationId: Ref,
    targetPropId: Ref,
    fn: z.enum(ROLLUP_FN_NAMES).nullable(),
    /** Button: its label (default: the property name) and what it does. */
    label: z.string().trim().max(100),
    actions: Actions,
    /** Formula: its source; resultType is worked out by the server. */
    expression: z.string().max(MAX_FORMULA),
    resultType: z.enum(['number', 'text', 'date', 'boolean']).nullable(),
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

export const VIEW_TYPES = /** @type {const} */ (['table', 'board', 'calendar']);
export const ViewType = z.enum(VIEW_TYPES);

/**
 * `upcoming` (dates only): by the next anniversary of the date, from today in the
 * viewer's timezone — birthdays come round in order. Other types read it as `asc`.
 */
export const Sort = z.object({ propId: PropertyId, dir: z.enum(['asc', 'desc', 'upcoming']).default('asc') });

export const Filter = z
  .object({
    propId: PropertyId,
    op: z.string().max(32),
    value: z.union([z.string().max(2048), z.number(), z.boolean(), z.null()]).optional(),
  })
  .refine((f) => Object.values(FILTER_OPS).some((ops) => ops.includes(f.op)), 'Unknown filter operator');

/**
 * What starts an automation: a row added to its database, a property changing
 * (optionally only when the row then matches `when`), or a schedule — every day,
 * week or month at a local time (the automation's `tz`), for each row that
 * matches `filters` (`rows: 'matching'`) or once without a row (`'none'`).
 */
export const Trigger = z.discriminatedUnion('type', [
  z.object({ type: z.literal('row_added') }),
  z.object({ type: z.literal('prop_changed'), propId: PropertyId, when: Filter.nullable().default(null) }),
  z.object({
    type: z.literal('schedule'),
    every: z.enum(['day', 'week', 'month']).default('day'),
    at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('09:00'),
    /** Weekly: 0 = Sunday … 6 = Saturday. */
    weekday: z.number().int().min(0).max(6).default(1),
    /** Monthly: day of the month (the last day in shorter months). */
    monthday: z.number().int().min(1).max(31).default(1),
    rows: z.enum(['matching', 'none']).default('matching'),
    filters: z.array(Filter).max(20).default([]),
  }),
]);

/** An IANA time zone ("Europe/Amsterdam"): automations run on its days and hours. */
export const TimeZone = z.string().min(1).max(64);

export const AutomationCreate = z.object({
  name: z.string().trim().min(1).max(100).default('Automation'),
  enabled: z.boolean().default(true),
  trigger: Trigger,
  actions: Actions.default([]),
  tz: TimeZone.default('UTC'),
});

export const AutomationUpdate = z
  .object({ name: z.string().trim().min(1).max(100), enabled: z.boolean(), trigger: Trigger, actions: Actions, tz: TimeZone })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const ViewConfig = z.object({
  sorts: z.array(Sort).max(10).default([]),
  filters: z.array(Filter).max(20).default([]),
  /** Property ids hidden in this view. */
  hidden: z.array(PropertyId).max(500).default([]),
  /** Column widths in px by property id. */
  widths: z.record(PropertyId, z.number().int().min(60).max(1200)).default({}),
  /** Column order (property ids); unlisted properties follow in schema order. */
  propOrder: z.array(PropertyId).max(500).default([]),
  /** Board columns / table groups: the property the rows are grouped by. */
  groupBy: PropertyId.nullable().default(null),
  /** Tables: leave out groups with no rows. */
  hideEmptyGroups: z.boolean().default(false),
  /** Board: option ids (or '__none__' for the null group) hidden from view. */
  hiddenGroups: z.array(z.string()).max(50).default([]),
  /** Calendar: the date the rows sit on (a date, created/edited time, or date rollup). */
  dateBy: PropertyId.nullable().default(null),
  /** Template that "New" uses in this view (null = an empty row). */
  template: z.string().min(1).max(64).nullable().default(null),
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

/** The viewer's local date — resolves DYNAMIC_TODAY when copying templates. */
export const Today = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const RowCreate = z.object({
  title: z.string().max(500).default(''),
  props: z.record(PropertyId, z.unknown()).default({}),
  /** Start as a copy of this database template (props still apply on top). */
  templateId: z.string().min(1).max(64).optional(),
  today: Today.optional(),
  beforeId: z.string().min(1).max(64).optional(),
  afterId: z.string().min(1).max(64).optional(),
});

export const RowMove = z
  .object({ beforeId: z.string().min(1).max(64).optional(), afterId: z.string().min(1).max(64).optional() })
  .refine((v) => !(v.beforeId && v.afterId), 'Give beforeId or afterId, not both');

const RowIds = z.array(z.string().min(1).max(64)).min(1).max(500);

/** The same values on many rows (fill down, bulk "set"). */
export const RowsPatch = z.object({ rowIds: RowIds, values: z.record(PropertyId, z.unknown()).refine((v) => Object.keys(v).length > 0, 'Nothing to update') });

/** Trash many rows. */
export const RowsDelete = z.object({ rowIds: RowIds });

/**
 * Move or copy rows to another database; values follow property names.
 * `addMissing` first gives the target the properties it lacks.
 */
export const RowsTransfer = z.object({
  rowIds: z.array(z.string().min(1).max(64)).min(1).max(200),
  targetId: z.string().min(1).max(64),
  mode: z.enum(['move', 'copy']),
  addMissing: z.boolean().default(false),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Deep-copy a page (content, sub-pages, a database's schema and rows):
 * Duplicate (default: next to the original), Save as template (`asTemplate`),
 * and Use template (the source is a template; `parentId` is where the copy goes).
 */
export const PageDuplicate = z.object({
  /** Omitted: the source's own parent. Null: the top level. */
  parentId: z.string().min(1).max(64).nullable().optional(),
  asTemplate: z.boolean().default(false),
  /** Append a page block to a page parent. False when the editor inserts its own. */
  block: z.boolean().default(true),
  today: Today,
});

/** Turn an empty page into a database, laid out as a table or a board. */
export const PageConvert = z.object({ layout: z.enum(['table', 'board']).default('table') });

/** `PATCH /api/pages/:id/props`: property id → value (null clears). */
export const PropsPatch = z.record(PropertyId, z.unknown()).refine((v) => Object.keys(v).length > 0, 'Nothing to update');

/** @typedef {z.infer<typeof ViewConfig>} ViewConfig */
/** @typedef {z.infer<typeof DatabaseQuery>} DatabaseQuery */
/** @typedef {z.infer<typeof Filter>} Filter */
/** @typedef {z.infer<typeof Sort>} Sort */
/** @typedef {z.infer<typeof Trigger>} Trigger */
