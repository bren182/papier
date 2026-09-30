import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { coerceValue, COMPUTED_TYPES, InvalidValue, splitNames, valueToText, type PropertyDef, type PropValue } from '@papier/core';
import { firePropsChanged, fireRowAdded } from './automations.ts';
import { duplicatePage } from './duplicate.ts';
import { properties, type Prop, type Tx } from './props.ts';
import { rowValues } from './relations.ts';
import { placeKey, writeValues } from './rows.ts';
import { dbProperties, pageProps, pages, searchRows } from './schema.ts';

/**
 * Moving and copying rows between databases. Values follow property **names**
 * (case-insensitive): the same type copies, other types convert (coerceValue;
 * select options are created in the target as needed), and properties the
 * target lacks are dropped — or created first (`addMissing`). A relation only
 * maps onto a relation with the same name that points at the same database.
 * Links that belonged to the old database's relations are removed.
 */

export const MAX_TRANSFER = 200;

type Summary = { id: string; name: string; type: string };
export type Mapping = { mapped: { from: Summary; to: Summary; convert: boolean }[]; dropped: Summary[] };

const summary = (p: PropertyDef): Summary => ({ id: p.id, name: p.name, type: p.type });
/** Properties with values of their own to carry over (not computed from the row, not buttons). */
const carries = (p: PropertyDef) => !COMPUTED_TYPES.has(p.type) && p.type !== 'formula';

/** How a source database's properties land in a target database. */
export function mapProperties(source: Prop[], target: Prop[]): Mapping & { pairs: [Prop, Prop][] } {
  const byName = new Map(target.filter(carries).map((p) => [p.name.trim().toLowerCase(), p]));
  const out: Mapping & { pairs: [Prop, Prop][] } = { mapped: [], dropped: [], pairs: [] };
  for (const from of source.filter(carries)) {
    const to = byName.get(from.name.trim().toLowerCase());
    const fits =
      to &&
      (from.type === 'relation' || to.type === 'relation'
        ? from.type === to.type && Boolean(from.config.databaseId) && from.config.databaseId === to.config.databaseId
        : true);
    if (to && fits) {
      out.mapped.push({ from: summary(from), to: summary(to), convert: from.type !== to.type });
      out.pairs.push([from, to]);
    } else out.dropped.push(summary(from));
  }
  return out;
}

/** Give the target the properties it lacks (same type; options copied; relations one-way). */
function addMissing(tx: Tx, sourceId: string, targetId: string) {
  const { dropped } = mapProperties(properties(tx, sourceId), properties(tx, targetId));
  const taken = new Set(properties(tx, targetId).map((p) => p.name.trim().toLowerCase()));
  const source = new Map(properties(tx, sourceId).map((p) => [p.id, p]));
  for (const d of dropped) {
    const p = source.get(d.id)!;
    // A same-named property of another type or target exists: leave it (the value is dropped).
    if (taken.has(p.name.trim().toLowerCase())) continue;
    const config =
      p.type === 'relation' ? { databaseId: p.config.databaseId ?? null } : { ...(p.config.options ? { options: p.config.options } : {}), ...(p.config.format ? { format: p.config.format } : {}) };
    tx.insert(dbProperties)
      .values({ id: randomUUID(), databaseId: targetId, name: p.name, type: p.type, config, orderKey: placeKey(tx, dbProperties, eq(dbProperties.databaseId, targetId), {}), createdAt: Date.now() })
      .run();
  }
}

/** A value converted for its new property; select option names missing in the target are added first. */
function convert(tx: Tx, from: Prop, to: Prop, value: unknown): PropValue {
  if (value === null || value === undefined) return null;
  if (from.type === to.type && from.type !== 'select' && from.type !== 'multi_select') return value as PropValue;
  if (to.type === 'select' || to.type === 'multi_select') {
    // Match options by name (ids differ between databases), creating the missing ones.
    const names = to.type === 'select' ? [valueToText(from, value as PropValue).trim()] : splitNames(valueToText(from, value as PropValue));
    const options = [...(to.config.options ?? [])];
    for (const name of names) {
      if (name && !options.some((o) => o.name.toLowerCase() === name.toLowerCase())) options.push({ id: randomUUID().slice(0, 8), name: name.slice(0, 100) });
    }
    if (options.length !== (to.config.options ?? []).length) {
      to.config = { ...to.config, options };
      tx.update(dbProperties).set({ config: to.config }).where(eq(dbProperties.id, to.id)).run();
    }
    return coerceValue({ ...from, type: 'text' }, to, valueToText(from, value as PropValue) || null);
  }
  return coerceValue(from, to, value as PropValue);
}

/**
 * Links a row can't keep in its new database: ones it owns under another
 * database's relations, and ones pointing at it from relations aimed at
 * another database.
 */
function scrubLinks(tx: Tx, rowId: string, databaseId: string) {
  tx.run(sql`
    delete from property_links where page_id = ${rowId}
      and prop_id not in (select id from db_properties where database_id = ${databaseId})
  `);
  tx.run(sql`
    delete from property_links where target_id = ${rowId}
      and prop_id in (select id from db_properties where coalesce(json_extract(config, '$.databaseId'), '') <> ${databaseId})
  `);
}

/** Live rows of a database, from the ids given (in that order). */
function rowsOf(tx: Tx, databaseId: string, ids: string[]) {
  const found = new Set(
    tx
      .select({ id: pages.id })
      .from(pages)
      .where(and(inArray(pages.id, ids), eq(pages.parentId, databaseId), isNull(pages.archivedAt)))
      .all()
      .map((r) => r.id),
  );
  return ids.filter((id) => found.has(id));
}

/**
 * Move or copy rows from one database to another. Returns the rows now in
 * the target (the same ids when moving, new ones when copying) and the mapping used.
 */
export function transferRows(
  tx: Tx,
  input: { sourceId: string; targetId: string; rowIds: string[]; mode: 'move' | 'copy'; addMissing: boolean; today: string },
): Mapping & { rows: string[] } {
  const { sourceId, targetId, mode } = input;
  if (sourceId === targetId) throw new InvalidValue('Pick another database');
  const ids = rowsOf(tx, sourceId, [...new Set(input.rowIds)].slice(0, MAX_TRANSFER));
  if (!ids.length) throw new InvalidValue('No rows to move');
  if (input.addMissing) addMissing(tx, sourceId, targetId);
  const mapping = mapProperties(properties(tx, sourceId), properties(tx, targetId));
  const out: string[] = [];

  for (const id of ids) {
    const values = rowValues(tx, id).props;
    const orderKey = placeKey(tx, pages, and(eq(pages.parentId, targetId), isNull(pages.archivedAt)), {});
    let rowId = id;
    if (mode === 'copy') {
      // A deep copy (content, sub-pages); its values are rewritten below, so none are mapped here.
      rowId = duplicatePage(tx, id, { parentId: targetId, orderKey, isTemplate: false, propMap: new Map() }, input.today);
      tx.delete(pageProps).where(eq(pageProps.pageId, rowId)).run();
    } else {
      tx.delete(pageProps).where(eq(pageProps.pageId, id)).run();
      tx.update(pages).set({ parentId: targetId, orderKey, updatedAt: Date.now() }).where(eq(pages.id, id)).run();
    }
    tx.delete(searchRows).where(and(eq(searchRows.pageId, rowId), sql`${searchRows.propId} is not null`)).run();
    scrubLinks(tx, rowId, targetId);

    const next: Record<string, unknown> = {};
    for (const [from, to] of mapping.pairs) {
      const v = convert(tx, from, to, values[from.id]);
      if (v !== null) next[to.id] = v;
    }
    // Options may have grown while converting: write against the fresh schema.
    writeValues(tx, rowId, properties(tx, targetId), next);
    fireRowAdded(tx, targetId, rowId);
    out.push(rowId);
  }
  const { pairs: _pairs, ...summaryOnly } = mapping;
  return { ...summaryOnly, rows: out };
}

/**
 * Set the same values on many rows of a database (fill down, bulk "set"),
 * firing the automations that watch what really changed. Returns the ids written.
 */
export function setManyRows(tx: Tx, databaseId: string, rowIds: string[], values: Record<string, unknown>) {
  const ids = rowsOf(tx, databaseId, [...new Set(rowIds)]);
  const props = properties(tx, databaseId);
  const now = Date.now();
  for (const id of ids) {
    const before = rowValues(tx, id).props;
    writeValues(tx, id, props, values);
    tx.update(pages).set({ updatedAt: now }).where(eq(pages.id, id)).run();
    const after = rowValues(tx, id).props;
    firePropsChanged(tx, databaseId, id, Object.keys(values).filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)), now);
  }
  return ids;
}

/** Trash many rows of a database. Returns the ids trashed. */
export function trashRows(tx: Tx, databaseId: string, rowIds: string[]) {
  const ids = rowsOf(tx, databaseId, [...new Set(rowIds)]);
  if (ids.length) tx.update(pages).set({ archivedAt: Date.now() }).where(inArray(pages.id, ids)).run();
  return ids;
}

