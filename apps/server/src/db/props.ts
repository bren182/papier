import { and, asc, eq } from 'drizzle-orm';
import { sortKeys, type PropertyDef, type PropValue } from '@papier/core';
import type { Db } from './index.ts';
import { dbProperties, dbViews, pageProps } from './schema.ts';

/** Database schema reads and value writes, shared by the routes and duplicate.ts. */

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type Conn = Db | Tx;
export type Prop = PropertyDef & { order: string };

export const propFields = { id: dbProperties.id, name: dbProperties.name, type: dbProperties.type, config: dbProperties.config, order: dbProperties.orderKey };
export const viewFields = { id: dbViews.id, name: dbViews.name, type: dbViews.type, config: dbViews.config, order: dbViews.orderKey };

export function properties(db: Conn, databaseId: string): Prop[] {
  return db.select(propFields).from(dbProperties).where(eq(dbProperties.databaseId, databaseId)).orderBy(asc(dbProperties.orderKey)).all() as Prop[];
}

export function views(db: Conn, databaseId: string) {
  return db.select(viewFields).from(dbViews).where(eq(dbViews.databaseId, databaseId)).orderBy(asc(dbViews.orderKey)).all();
}

/** Write one row value (null deletes it); the sort columns always follow the value. */
export function writeValue(db: Conn, pageId: string, prop: PropertyDef, value: PropValue) {
  if (value === null) {
    db.delete(pageProps).where(and(eq(pageProps.pageId, pageId), eq(pageProps.propId, prop.id))).run();
    return;
  }
  const { sortText, sortNum } = sortKeys(prop, value);
  db.insert(pageProps)
    .values({ pageId, propId: prop.id, value, sortText, sortNum })
    .onConflictDoUpdate({ target: [pageProps.pageId, pageProps.propId], set: { value, sortText, sortNum } })
    .run();
}
