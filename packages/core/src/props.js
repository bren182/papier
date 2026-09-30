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
]);

/** Types whose value comes from the page itself; they have no `page_props` rows. */
export const COMPUTED_TYPES = new Set(['created_time', 'edited_time']);

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
  date: ['is', 'before', 'after', 'on_or_before', 'on_or_after', 'is_empty', 'is_not_empty'],
  checkbox: ['is'],
  created_time: ['is', 'before', 'after', 'on_or_before', 'on_or_after'],
  edited_time: ['is', 'before', 'after', 'on_or_before', 'on_or_after'],
};

/** Operators that take no value. */
export const VALUELESS_OPS = new Set(['is_empty', 'is_not_empty']);

/**
 * @typedef {{ id: string, name: string }} SelectOption
 * @typedef {{ options?: SelectOption[], format?: 'number' | 'percent' }} PropertyConfig
 * @typedef {{ id: string, name: string, type: string, config: PropertyConfig }} PropertyDef
 * @typedef {string | number | boolean | string[] | null} PropValue
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class InvalidValue extends Error {}

/**
 * Normalise a value for a property, or throw `InvalidValue`. Empty values
 * (blank text, no options, unchecked) normalise to null — null means "no row".
 * @param {PropertyDef} prop
 * @param {unknown} v
 * @returns {PropValue}
 */
export function validateValue(prop, v) {
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
      if (typeof v !== 'string' || !DATE_RE.test(v)) fail();
      return /** @type {string} */ (v);
    case 'checkbox':
      if (typeof v !== 'boolean') fail();
      return v ? true : null;
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
  if (v === null) return { sortText: null, sortNum: null };
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
  // Select ↔ multi-select keep option ids (the options carry over).
  if (from.type === 'select' && to.type === 'multi_select') return v === null ? null : [/** @type {string} */ (v)];
  if (from.type === 'multi_select' && to.type === 'select') return Array.isArray(v) ? (v[0] ?? null) : null;
  return textToValue(to, valueToText(from, v));
}
