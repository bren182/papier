import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

export const pages = sqliteTable(
  'pages',
  {
    id: text('id').primaryKey(),
    parentId: text('parent_id').references((): AnySQLiteColumn => pages.id),
    title: text('title').notNull().default(''),
    /** JSON inline content (text + date mentions); null = plain `title`. */
    titleContent: text('title_content', { mode: 'json' }).$type<Array<Record<string, unknown>>>(),
    icon: text('icon'),
    /** 'page' or 'database'. A database's child pages are its rows (no page blocks). */
    kind: text('kind').notNull().default('page'),
    /** Fractional index among siblings; see orderBetween in @papier/core. */
    orderKey: text('order_key').notNull(),
    /** Set when moved to trash (ms since epoch). Descendants are hidden with it. */
    archivedAt: integer('archived_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('pages_parent_order').on(t.parentId, t.orderKey)],
);

export const blocks = sqliteTable(
  'blocks',
  {
    id: text('id').primaryKey(),
    pageId: text('page_id')
      .notNull()
      .references(() => pages.id),
    /** Null = top level of the page. Deleting a block removes its subtree. */
    parentId: text('parent_id').references((): AnySQLiteColumn => blocks.id, { onDelete: 'cascade' }),
    /** One of BLOCK_TYPES in @papier/core. */
    type: text('type').notNull(),
    /** Fractional index among siblings. */
    orderKey: text('order_key').notNull(),
    /** JSON object: type-specific settings (heading level, checked, language). */
    props: text('props', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    /** JSON array: inline rich text (see InlineContent in @papier/core). */
    content: text('content', { mode: 'json' }).$type<Array<Record<string, unknown>>>().notNull().default([]),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('blocks_page_parent_order').on(t.pageId, t.parentId, t.orderKey)],
);

/**
 * Search projection: the plain text of every block, plus one row per page title
 * (`blockId` null). The FTS5 index `search_fts` (hand-written migration) mirrors
 * `text` through triggers; see src/db/search.ts.
 */
export const searchRows = sqliteTable(
  'search_rows',
  {
    /** Integer key: the FTS rowid, stable across VACUUM. */
    id: integer('id').primaryKey(),
    pageId: text('page_id')
      .notNull()
      .references(() => pages.id),
    /** Deleting a block (or its ancestor) drops its row, and the FTS entry with it. */
    blockId: text('block_id')
      .unique()
      .references(() => blocks.id, { onDelete: 'cascade' }),
    text: text('text').notNull().default(''),
  },
  (t) => [uniqueIndex('search_rows_title').on(t.pageId).where(sql`${t.blockId} is null`)],
);

/** A database's typed properties (the row title is the page title, not a property). */
export const dbProperties = sqliteTable(
  'db_properties',
  {
    id: text('id').primaryKey(),
    databaseId: text('database_id')
      .notNull()
      .references(() => pages.id),
    name: text('name').notNull(),
    /** One of PROPERTY_TYPES in @papier/core. */
    type: text('type').notNull(),
    /** JSON: select options, number format. */
    config: text('config', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    orderKey: text('order_key').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('db_properties_database_order').on(t.databaseId, t.orderKey)],
);

/**
 * Row values: one row per (page, property) that has a value. `value` is the
 * truth; `sortText` / `sortNum` are derived on write (sortKeys in @papier/core)
 * so filters and sorts run on indexes instead of JSON (README §8).
 */
export const pageProps = sqliteTable(
  'page_props',
  {
    pageId: text('page_id')
      .notNull()
      .references(() => pages.id),
    propId: text('prop_id')
      .notNull()
      .references(() => dbProperties.id, { onDelete: 'cascade' }),
    value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
    sortText: text('sort_text'),
    sortNum: real('sort_num'),
  },
  (t) => [
    primaryKey({ columns: [t.pageId, t.propId] }),
    index('page_props_prop_text').on(t.propId, t.sortText),
    index('page_props_prop_num').on(t.propId, t.sortNum),
  ],
);

/** Saved views of a database, shared by every place that shows it. */
export const dbViews = sqliteTable(
  'db_views',
  {
    id: text('id').primaryKey(),
    databaseId: text('database_id')
      .notNull()
      .references(() => pages.id),
    name: text('name').notNull(),
    /** 'table' | 'board' */
    type: text('type').notNull(),
    /** JSON ViewConfig: sorts, filters, hidden, widths, propOrder, groupBy. */
    config: text('config', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    orderKey: text('order_key').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('db_views_database_order').on(t.databaseId, t.orderKey)],
);
