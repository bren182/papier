/**
 * Database property types and their values — zod-free, so the client can import
 * it (`@papier/core/props`) without pulling zod into the main bundle.
 *
 * A database is a page; its rows are its child pages. The row title is the page
 * title (property id `title`); every other property is a `db_properties` row and
 * each row's value a `page_props` row holding normalised JSON.
 */

export const PROPERTY_TYPES = /** @type {const} */ ([
  'text',
  'number',
  'select',
  'multi_select',
  'date',
  'checkbox',
  'url',
  'created_time',
  'edited_time',
  'relation',
  'rollup',
  'button',
  'formula',
]);

/**
 * Types with no value of their own to edit: computed (from the page itself, or a
 * rollup over a relation) or a button, which does things instead. They have no
 * `page_props` rows. Relations have none either — their links live in `property_links`.
 */
export const COMPUTED_TYPES = new Set(['created_time', 'edited_time', 'rollup', 'button', 'formula']);

/**
 * Rollup functions by the type of the property they aggregate. `any` applies to
 * every type (a rollup can't aggregate a rollup or a relation).
 * @type {Record<string, readonly string[]>}
 */
export const ROLLUP_FNS = {
  any: ['show_original', 'count', 'count_values', 'count_unique', 'count_empty', 'percent_empty'],
  number: ['sum', 'avg', 'min', 'max', 'range'],
  date: ['earliest', 'latest'],
  checkbox: ['checked', 'percent_checked'],
};

/** Every rollup function name. */
export const ROLLUP_FN_NAMES = /** @type {const} */ ([
  'show_original', 'count', 'count_values', 'count_unique', 'count_empty', 'percent_empty',
  'sum', 'avg', 'min', 'max', 'range', 'earliest', 'latest', 'checked', 'percent_checked',
]);

/** Property types a rollup can aggregate (`title` too). */
export const ROLLUP_TARGET_TYPES = new Set(['title', 'text', 'number', 'select', 'multi_select', 'date', 'checkbox', 'url', 'created_time', 'edited_time']);

/**
 * Rollup functions that apply to a target property type.
 * @param {string} targetType  a property type, or 'title'
 */
export function rollupFns(targetType) {
  if (!ROLLUP_TARGET_TYPES.has(targetType)) return [];
  const dateLike = targetType === 'date' || targetType === 'created_time' || targetType === 'edited_time';
  return [...ROLLUP_FNS.any, ...(ROLLUP_FNS[dateLike ? 'date' : targetType] ?? [])];
}

/**
 * What a rollup function produces: a number, a fraction 0–1 (`percent`), a
 * `YYYY-MM-DD` date, or a list of display strings (`show_original`).
 * @param {string | undefined} fn
 * @returns {'number' | 'percent' | 'date' | 'list'}
 */
export function rollupResultType(fn) {
  if (fn === 'show_original' || !fn) return 'list';
  if (fn === 'percent_empty' || fn === 'percent_checked') return 'percent';
  if (fn === 'earliest' || fn === 'latest') return 'date';
  return 'number';
}

/** Pseudo-property ids views can sort/filter on besides real property ids. */
export const TITLE_PROP = 'title';

/**
 * Filter operators per property type. `is_empty` / `is_not_empty` take no value.
 * @type {Record<string, readonly string[]>}
 */
export const FILTER_OPS = {
  title: ['contains', 'not_contains', 'is', 'is_not', 'is_empty', 'is_not_empty'],
  text: ['contains', 'not_contains', 'is', 'is_not', 'is_empty', 'is_not_empty'],
  url: ['contains', 'not_contains', 'is', 'is_not', 'is_empty', 'is_not_empty'],
  number: ['=', '!=', '>', '<', '>=', '<=', 'is_empty', 'is_not_empty'],
  select: ['is', 'is_not', 'is_empty', 'is_not_empty'],
  multi_select: ['contains', 'not_contains', 'is_empty', 'is_not_empty'],
  date: ['is', 'before', 'after', 'on_or_before', 'on_or_after', 'within_next', 'within_past', 'anniversary_within', 'is_empty', 'is_not_empty'],
  checkbox: ['is'],
  created_time: ['is', 'before', 'after', 'on_or_before', 'on_or_after', 'within_past'],
  edited_time: ['is', 'before', 'after', 'on_or_before', 'on_or_after', 'within_past'],
  relation: ['contains', 'not_contains', 'is_empty', 'is_not_empty'],
  rollup_list: ['is_empty', 'is_not_empty'],
};

/**
 * Filter operators for a property (or the `title` pseudo-property); a rollup
 * filters like its result.
 * @param {{ type: string, config?: PropertyConfig } | undefined} prop
 * @returns {readonly string[]}
 */
export function filterOps(prop) {
  if (!prop) return [];
  if (prop.type === 'formula') {
    // Filtered like what it computes (resultType is kept up to date by the server).
    const t = prop.config?.resultType;
    return t === 'boolean' ? FILTER_OPS.checkbox ?? [] : t ? (FILTER_OPS[t] ?? []) : [];
  }
  if (prop.type !== 'rollup') return FILTER_OPS[prop.type] ?? [];
  const result = rollupResultType(prop.config?.fn ?? undefined);
  return FILTER_OPS[result === 'list' ? 'rollup_list' : result === 'percent' ? 'number' : result] ?? [];
}

/**
 * A date that means "the day a page is made from this template". Only valid in
 * templates (property values and `@date` mentions); copying resolves it.
 */
export const DYNAMIC_TODAY = '@today';

/** Operators that take no value. */
export const VALUELESS_OPS = new Set(['is_empty', 'is_not_empty']);

/**
 * Date operators whose value is a number of days from the viewer's today:
 * `within_next` / `within_past` (the date itself), `anniversary_within` (its next
 * yearly recurrence — birthdays).
 */
export const RELATIVE_DATE_OPS = new Set(['within_next', 'within_past', 'anniversary_within']);

/**
 * @typedef {{ id: string, name: string }} SelectOption
 * @typedef {object} PropertyConfig
 * @property {SelectOption[]} [options]  select, multi_select
 * @property {'number' | 'percent'} [format]  number, and number-valued rollups
 * @property {string | null} [databaseId]  relation: the target database
 * @property {string | null} [reverseId]  relation: its two-way twin in the target (this side owns the links)
 * @property {string | null} [reverseOf]  relation: the twin that owns the links (this side reads them backwards)
 * @property {string | null} [relationId]  rollup: the relation it aggregates over
 * @property {string | null} [targetPropId]  rollup: the target database property (or `title`)
 * @property {string | null} [fn]  rollup: one of ROLLUP_FN_NAMES
 * @property {string} [label]  button: its label (default: the property name)
 * @property {import('./actions.js').Action[]} [actions]  button: what it does
 * @property {string} [expression]  formula: its source (see formula.js)
 * @property {'number' | 'text' | 'date' | 'boolean' | null} [resultType]  formula: what it computes (null while invalid)
 * @typedef {{ id: string, name: string, type: string, config: PropertyConfig }} PropertyDef
 * @typedef {string | number | boolean | string[] | null} PropValue
 */

/** Most rows one relation cell links to. */
export const MAX_LINKS = 500;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class InvalidValue extends Error {}

/**
 * Normalise a value for a property, or throw `InvalidValue`. Empty values
 * (blank text, no options, unchecked) normalise to null — null means "no row".
 * @param {PropertyDef} prop
 * @param {unknown} v
 * @param {{ template?: boolean }} [opts]  templates may hold DYNAMIC_TODAY in dates
 * @returns {PropValue}
 */
export function validateValue(prop, v, { template = false } = {}) {
  if (v === null || v === undefined) return null;
  const fail = () => {
    throw new InvalidValue(`Invalid ${prop.type} value for "${prop.name}"`);
  };
  const optionIds = () => new Set((prop.config.options ?? []).map((o) => o.id));
  switch (prop.type) {
    case 'text':
    case 'url':
      if (typeof v !== 'string' || v.length > (prop.type === 'url' ? 2048 : 10_000)) fail();
      return /** @type {string} */ (v).trim() === '' ? null : /** @type {string} */ (v);
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v)) fail();
      return /** @type {number} */ (v);
    case 'select':
      if (typeof v !== 'string' || !optionIds().has(v)) fail();
      return /** @type {string} */ (v);
    case 'multi_select': {
      if (!Array.isArray(v) || v.length > 100) fail();
      const ids = optionIds();
      const out = [...new Set(/** @type {unknown[]} */ (v))];
      if (!out.every((id) => typeof id === 'string' && ids.has(id))) fail();
      return out.length ? /** @type {string[]} */ (out) : null;
    }
    case 'date':
      if (template && v === DYNAMIC_TODAY) return v;
      if (typeof v !== 'string' || !DATE_RE.test(v)) fail();
      return /** @type {string} */ (v);
    case 'checkbox':
      if (typeof v !== 'boolean') fail();
      return v ? true : null;
    case 'relation': {
      if (!Array.isArray(v) || v.length > MAX_LINKS) fail();
      const out = [...new Set(/** @type {unknown[]} */ (v))];
      if (!out.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 64)) fail();
      return out.length ? /** @type {string[]} */ (out) : null;
    }
    default:
      throw new InvalidValue(`"${prop.name}" is read-only`);
  }
}

/**
 * The indexed sort/filter columns stored next to a value (README §8).
 * Select stores its option id (sorting by option order happens in SQL).
 * @param {PropertyDef} prop
 * @param {PropValue} v normalised
 * @returns {{ sortText: string | null, sortNum: number | null }}
 */
export function sortKeys(prop, v) {
  if (v === null || v === DYNAMIC_TODAY) return { sortText: null, sortNum: null };
  switch (prop.type) {
    case 'text':
    case 'url':
      return { sortText: String(v).toLowerCase(), sortNum: null };
    case 'number':
      return { sortText: null, sortNum: /** @type {number} */ (v) };
    case 'select':
    case 'date':
      return { sortText: String(v), sortNum: null };
    case 'checkbox':
      return { sortText: null, sortNum: 1 };
    default:
      return { sortText: null, sortNum: null };
  }
}

/**
 * A value as plain text — for display fallbacks and type changes.
 * @param {PropertyDef} prop
 * @param {PropValue} v
 */
export function valueToText(prop, v) {
  if (v === null || v === undefined) return '';
  const name = (/** @type {string} */ id) => prop.config.options?.find((o) => o.id === id)?.name ?? '';
  switch (prop.type) {
    case 'select':
      return name(/** @type {string} */ (v));
    case 'multi_select':
      return /** @type {string[]} */ (v).map(name).filter(Boolean).join(', ');
    case 'checkbox':
      return v ? 'Yes' : '';
    case 'date':
      return v === DYNAMIC_TODAY ? 'Today' : String(v);
    default:
      return String(v);
  }
}

/**
 * Parse text into a value of `prop`'s type; null when it doesn't fit.
 * Select options are matched by name (case-insensitive).
 * @param {PropertyDef} prop
 * @param {string} text
 * @returns {PropValue}
 */
export function textToValue(prop, text) {
  const t = text.trim();
  if (!t) return null;
  const byName = (/** @type {string} */ n) => prop.config.options?.find((o) => o.name.toLowerCase() === n.toLowerCase())?.id;
  switch (prop.type) {
    case 'text':
      return t.slice(0, 10_000);
    case 'url':
      return t.slice(0, 2048);
    case 'number': {
      const n = Number(t.replace(/[,%\s]/g, ''));
      return Number.isFinite(n) ? n : null;
    }
    case 'select':
      return byName(t) ?? null;
    case 'multi_select': {
      const ids = splitNames(t).map(byName).filter((id) => id !== undefined);
      return ids.length ? [...new Set(ids)] : null;
    }
    case 'date':
      return DATE_RE.test(t) ? t : null;
    case 'checkbox':
      return ['yes', 'true', '1', 'x', '✓', 'checked'].includes(t.toLowerCase()) ? true : null;
    default:
      return null;
  }
}

/** Option names in a text (multi-select values are comma-separated). */
export function splitNames(/** @type {string} */ text) {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Convert a value when its property changes type.
 * @param {PropertyDef} from
 * @param {PropertyDef} to options must already contain any names to match
 * @param {PropValue} v
 */
export function coerceValue(from, to, v) {
  if (from.type === to.type) return v;
  // Relations link rows; nothing else converts to or from them.
  if (from.type === 'relation' || to.type === 'relation') return null;
  // Select ↔ multi-select keep option ids (the options carry over).
  if (from.type === 'select' && to.type === 'multi_select') return v === null ? null : [/** @type {string} */ (v)];
  if (from.type === 'multi_select' && to.type === 'select') return Array.isArray(v) ? (v[0] ?? null) : null;
  return textToValue(to, valueToText(from, v));
}
