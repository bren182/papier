import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, isNull, lt, type SQL } from 'drizzle-orm';
import { InvalidValue, orderBetween, validateValue } from '@papier/core';
import { duplicatePage } from './duplicate.ts';
import { properties, writeValue, type Conn, type Prop, type Tx } from './props.ts';
import { writeLinks } from './relations.ts';
import { automations, dbProperties, dbViews, pages } from './schema.ts';
import { indexTitle } from './search.ts';

/**
 * Row writes shared by the routes and the actions engine. Bad input throws
 * `InvalidValue`, which the routes turn into a 400.
 */

/**
 * Order key for an item placed before/after a sibling (default: last), among
 * rows matched by `scope`. Shared by properties, views and rows.
 */
export function placeKey(
  db: Conn,
  table: typeof pages | typeof dbProperties | typeof dbViews | typeof automations,
  scope: SQL | undefined,
  { beforeId, afterId }: { beforeId?: string; afterId?: string },
) {
  const col = table.orderKey;
  const key = (where: SQL | undefined, dir: 'asc' | 'desc') =>
    db.select({ k: col }).from(table).where(and(scope, where)).orderBy(dir === 'asc' ? asc(col) : desc(col)).limit(1).get()?.k ?? null;
  const refId = beforeId ?? afterId;
  if (!refId) return orderBetween(key(undefined, 'desc'), null);
  const ref = key(eq(table.id, refId), 'asc');
  if (ref === null) throw new InvalidValue('Sibling not found');
  return beforeId ? orderBetween(key(lt(col, ref), 'desc'), ref) : orderBetween(ref, key(gt(col, ref), 'asc'));
}

/** Validate and write a set of values for one row. */
export function writeValues(db: Conn, pageId: string, props: Prop[], values: Record<string, unknown>, { template = false } = {}) {
  const byId = new Map(props.map((p) => [p.id, p]));
  for (const [propId, raw] of Object.entries(values)) {
    const prop = byId.get(propId);
    if (!prop) throw new InvalidValue(`Unknown property ${propId}`);
    const value = validateValue(prop, raw, { template });
    if (prop.type === 'relation') writeLinks(db, pageId, prop, value as string[] | null);
    else writeValue(db, pageId, prop, value);
  }
}


/**
 * A new row: blank, or a copy of one of the database's templates (whose values,
 * content and sub-pages it takes); `title` and `props` win over the template's.
 */
export function createRow(
  tx: Tx,
  databaseId: string,
  input: { title?: string; props?: Record<string, unknown>; templateId?: string | null; beforeId?: string; afterId?: string },
  today: string | undefined,
) {
  const now = Date.now();
  const orderKey = placeKey(tx, pages, and(eq(pages.parentId, databaseId), isNull(pages.archivedAt)), input);
  let rowId: string;
  if (input.templateId) {
    const t = tx.select({ parentId: pages.parentId, isTemplate: pages.isTemplate, archivedAt: pages.archivedAt }).from(pages).where(eq(pages.id, input.templateId)).get();
    if (!t || t.parentId !== databaseId || !t.isTemplate || t.archivedAt !== null) throw new InvalidValue('Not a template of this database');
    if (!today) throw new InvalidValue('today is required with a template');
    rowId = duplicatePage(tx, input.templateId, { parentId: databaseId, orderKey, isTemplate: false }, today);
    if (input.title) {
      tx.update(pages).set({ title: input.title, titleContent: null }).where(eq(pages.id, rowId)).run();
      indexTitle(tx, rowId, input.title);
    }
  } else {
    rowId = randomUUID();
    tx.insert(pages).values({ id: rowId, parentId: databaseId, title: input.title ?? '', orderKey, createdAt: now, updatedAt: now }).run();
    indexTitle(tx, rowId, input.title ?? '');
  }
  writeValues(tx, rowId, properties(tx, databaseId), input.props ?? {});
  return rowId;
}
