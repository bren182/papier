import { index, integer, sqliteTable, text, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

export const pages = sqliteTable(
  'pages',
  {
    id: text('id').primaryKey(),
    parentId: text('parent_id').references((): AnySQLiteColumn => pages.id),
    title: text('title').notNull().default(''),
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
