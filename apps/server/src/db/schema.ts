import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

/** The workspace migration 0011 created to adopt every existing page. */
export const DEFAULT_WORKSPACE_ID = 'default';

export const pages = sqliteTable(
  'pages',
  {
    id: text('id').primaryKey(),
    parentId: text('parent_id').references((): AnySQLiteColumn => pages.id),
    title: text('title').notNull().default(''),
    /** JSON inline content (text + date mentions); null = plain `title`. */
    titleContent: text('title_content', { mode: 'json' }).$type<Array<Record<string, unknown>>>(),
    icon: text('icon'),
    /** JSON Appearance in @papier/core: cover, layout, mood. */
    appearance: text('appearance', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    /** 'page' or 'database'. A database's child pages are its rows (no page blocks). */
    kind: text('kind').notNull().default('page'),
    /**
     * Templates: a root page (library) or a database's child (row template).
     * Kept out of the sidebar, row queries and search, with everything under them.
     */
    isTemplate: integer('is_template', { mode: 'boolean' }).notNull().default(false),
    /** Fractional index among siblings; see orderBetween in @papier/core. */
    orderKey: text('order_key').notNull(),
    /** Order among the sidebar's Favourites; null = not a favourite. */
    favoriteKey: text('favorite_key'),
    /** Set when moved to trash (ms since epoch). Descendants are hidden with it. */
    archivedAt: integer('archived_at'),
    /**
     * The workspace this page lives in: denormalised onto every page (rows too),
     * always equal to its parent's. No FK clause: SQLite can't add one with a
     * non-null default, so the invariant is kept in code.
     */
    workspaceId: text('workspace_id').notNull().default(DEFAULT_WORKSPACE_ID),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('pages_workspace_parent_order').on(t.workspaceId, t.parentId, t.orderKey), index('pages_parent_order').on(t.parentId, t.orderKey)],
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
    /** A row's property value (text, url, select names); dropped with the property. */
    propId: text('prop_id').references((): AnySQLiteColumn => dbProperties.id, { onDelete: 'cascade' }),
    text: text('text').notNull().default(''),
  },
  (t) => [
    uniqueIndex('search_rows_title').on(t.pageId).where(sql`${t.blockId} is null and ${t.propId} is null`),
    uniqueIndex('search_rows_prop').on(t.pageId, t.propId).where(sql`${t.propId} is not null`),
  ],
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

/**
 * Relation links. Each link is stored once, under the property that owns it
 * (the one without `reverseOf`): `pageId` → `targetId`. A two-way relation's twin
 * reads the same rows backwards (by `targetId`). Links to trashed pages stay and
 * are filtered on read, so restoring a page brings them back.
 */
export const propertyLinks = sqliteTable(
  'property_links',
  {
    pageId: text('page_id')
      .notNull()
      .references(() => pages.id),
    propId: text('prop_id')
      .notNull()
      .references(() => dbProperties.id, { onDelete: 'cascade' }),
    targetId: text('target_id')
      .notNull()
      .references(() => pages.id),
    /** Order within the owning cell. */
    orderKey: text('order_key').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.pageId, t.propId, t.targetId] }), index('property_links_target').on(t.propId, t.targetId)],
);

/**
 * A database's automations: a trigger (JSON Trigger in @papier/core) and the
 * actions it runs (db/actions.ts). Schedules keep their next due time in
 * `nextRunAt` for the scheduler; `lastError` says why the last run failed.
 */
export const automations = sqliteTable(
  'automations',
  {
    id: text('id').primaryKey(),
    databaseId: text('database_id')
      .notNull()
      .references(() => pages.id),
    name: text('name').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    trigger: text('trigger', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    actions: text('actions', { mode: 'json' }).$type<unknown[]>().notNull().default([]),
    /** IANA time zone: whose "today" and whose 09:00. */
    tz: text('tz').notNull().default('UTC'),
    orderKey: text('order_key').notNull(),
    nextRunAt: integer('next_run_at'),
    lastRunAt: integer('last_run_at'),
    lastError: text('last_error'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('automations_database_order').on(t.databaseId, t.orderKey), index('automations_due').on(t.enabled, t.nextRunAt)],
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

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  /** Lowercased; the login name. OAuth providers will link on a verified email. */
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  /** scrypt, see src/auth/password.ts. */
  passwordHash: text('password_hash').notNull(),
  /** Deployment admin (the account created at setup). */
  isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
  /** Ephemeral demo account — no password, purged when its session expires. */
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
});

/**
 * Login sessions. `id` is the sha256 of the token the client holds, so a leaked
 * database holds no live sessions. `kind`: 'cookie' (browser, PWA) or 'token'
 * (desktop app, `Authorization: Bearer`).
 */
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    userAgent: text('user_agent'),
    createdAt: integer('created_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [index('sessions_user').on(t.userId)],
);

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  icon: text('icon'),
  /** The page you land on (`/` with no `?p`); null = none. Cleared when that page is purged. */
  homePageId: text('home_page_id'),
  createdAt: integer('created_at').notNull(),
});

/** Workspace membership: role is 'owner' | 'editor' | 'viewer'. */
export const members = sqliteTable(
  'members',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index('members_user').on(t.userId)],
);

/**
 * Indexed `@remind` inline nodes: one row per remind node per block. Block deletes
 * cascade (FK). The route `GET /api/reminders?date=YYYY-MM-DD` returns items due
 * up to that date so the client can show/push them.
 */
export const reminders = sqliteTable(
  'reminders',
  {
    /** `${blockId}:${nodeIndex}` — stable as long as the block content doesn't change. */
    id: text('id').primaryKey(),
    pageId: text('page_id').notNull().references(() => pages.id, { onDelete: 'cascade' }),
    blockId: text('block_id').notNull().references(() => blocks.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    note: text('note').notNull().default(''),
  },
  (t) => [index('reminders_date').on(t.date), index('reminders_block').on(t.blockId)],
);

/**
 * Single-use invite links: an authenticated user creates one; the recipient
 * visits `/join?token=<id>` and sets up their account. Expires after 7 days.
 */
export const invites = sqliteTable('invites', {
  /** 32-byte random hex — the URL token the recipient receives. */
  id: text('id').primaryKey(),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  usedAt: integer('used_at'),
  usedBy: text('used_by').references(() => users.id, { onDelete: 'set null' }),
});
