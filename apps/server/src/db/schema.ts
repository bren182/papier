import { index, integer, sqliteTable, text, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

export const pages = sqliteTable(
  'pages',
  {
    id: text('id').primaryKey(),
    parentId: text('parent_id').references((): AnySQLiteColumn => pages.id),
    title: text('title').notNull().default(''),
    /** JSON inline content (text + date mentions); null = plain `title`. */
    titleContent: text('title_content', { mode: 'json' }).$type<Array<Record<string, unknown>>>(),
    icon: text('icon'),
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
