import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { InvalidValue, orderBetween } from '@papier/core';
import type { Db } from './index.ts';
import { liveLineage, type Crumb } from './lineage.ts';
import { appendPageBlock, OWNING_BLOCKS } from './pageTree.ts';
import type { Tx } from './props.ts';
import { automations, blocks, dbProperties, dbViews, pageProps, pages, propertyLinks, searchRows, workspaces } from './schema.ts';

/**
 * The trash. Trashing sets `archived_at` on one page; everything under it is
 * hidden with it (liveLineage). The trash lists the top-most trashed pages,
 * restores them (keeping the page-block invariant, see pageTree.ts), and purges
 * them for good — by hand, or after RETENTION_DAYS.
 */

export const RETENTION_DAYS = 30;
const DAY = 86_400_000;

export type TrashItem = {
  page: Crumb & { kind: string; isTemplate: boolean };
  trashedAt: number;
  /** Where it was: its parent, if that's still live (null for the top level, or a parent that's gone too). */
  parent: Crumb | null;
  /** A database row (restoring it puts it back in its database). */
  isRow: boolean;
};

/** Top-most trashed pages, newest first: trashed themselves, with no trashed ancestor. */
export function listTrash(db: Db, q = '', limit = 200, workspaceId: string | null = null): TrashItem[] {
  const like = `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const wsFilter = workspaceId ? sql`and p.workspace_id = ${workspaceId}` : sql``;
  const rows = db.all<{ id: string; parent_id: string | null; title: string; title_content: string | null; icon: string | null; kind: string; is_template: number; archived_at: number; parent_kind: string | null }>(sql`
    select p.id, p.parent_id, p.title, p.title_content, p.icon, p.kind, p.is_template, p.archived_at, par.kind as parent_kind
    from pages p left join pages par on par.id = p.parent_id
    where p.archived_at is not null ${q ? sql`and lower(p.title) like ${like} escape '\\'` : sql``} ${wsFilter}
    order by p.archived_at desc
    limit 2000
  `);
  const out: TrashItem[] = [];
  for (const r of rows) {
    const lineage = r.parent_id ? liveLineage(db, r.parent_id) : null;
    // Under a trashed ancestor: it comes back with that one, so it isn't listed on its own.
    if (r.parent_id && !lineage && ancestorTrashed(db, r.parent_id)) continue;
    out.push({
      page: { id: r.id, title: r.title, titleContent: r.title_content === null ? null : JSON.parse(r.title_content), icon: r.icon, kind: r.kind, isTemplate: Boolean(r.is_template) },
      trashedAt: r.archived_at,
      parent: lineage ? lineage[lineage.length - 1]! : null,
      isRow: r.parent_kind === 'database',
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Whether a page or one of its ancestors is in the trash (vs. missing). */
function ancestorTrashed(db: Db, pageId: string) {
  return (
    (db.get<{ n: number }>(sql`
      with recursive up(id, parent_id, archived_at) as (
        select id, parent_id, archived_at from pages where id = ${pageId}
        union all
        select p.id, p.parent_id, p.archived_at from pages p join up on p.id = up.parent_id
      )
      select count(*) as n from up where archived_at is not null
    `)?.n ?? 0) > 0
  );
}

/**
 * Take a page out of the trash. Under a live page it gets its page (or
 * database) block back; a row goes back into its database; with its parent
 * gone it lands at the top level. Returns the parent whose content changed.
 */
export function restorePage(tx: Tx, id: string): { parentId: string | null; contentChanged: string | null } {
  const page = tx.select({ parentId: pages.parentId, kind: pages.kind, archivedAt: pages.archivedAt }).from(pages).where(eq(pages.id, id)).get();
  if (!page || page.archivedAt === null) throw new InvalidValue('That page isn’t in the trash');
  const parent = page.parentId ? tx.select({ kind: pages.kind }).from(pages).where(eq(pages.id, page.parentId)).get() : null;
  const parentLive = Boolean(page.parentId && liveLineage(tx as unknown as Db, page.parentId));
  const now = Date.now();

  if (page.parentId && parentLive) {
    tx.update(pages).set({ archivedAt: null, updatedAt: now }).where(eq(pages.id, id)).run();
    if (parent?.kind === 'database') return { parentId: page.parentId, contentChanged: null };
    const owned = tx
      .select({ id: blocks.id })
      .from(blocks)
      .where(and(eq(blocks.pageId, page.parentId), inArray(blocks.type, OWNING_BLOCKS), sql`json_extract(${blocks.props}, '$.pageId') = ${id}`))
      .get();
    if (!owned) appendPageBlock(tx, page.parentId, id, page.kind === 'database' ? 'database' : 'page');
    return { parentId: page.parentId, contentChanged: page.parentId };
  }

  // A row needs its database: it can't live on its own.
  if (parent?.kind === 'database') throw new InvalidValue('Restore its database first');
  const last = tx.select({ k: pages.orderKey }).from(pages).where(isNull(pages.parentId)).orderBy(desc(pages.orderKey)).limit(1).get();
  tx.update(pages).set({ archivedAt: null, parentId: null, orderKey: orderBetween(last?.k ?? null, null), updatedAt: now }).where(eq(pages.id, id)).run();
  return { parentId: null, contentChanged: null };
}

/**
 * Delete pages for good, with everything under them: content, values, links
 * (also links other databases hold to these rows), search rows, and the
 * schema, views and automations of databases among them. Relations elsewhere
 * that were twinned with a purged property become one-way.
 * Returns how many pages went.
 */
export function purgePages(tx: Tx, rootIds: string[]) {
  if (!rootIds.length) return 0;
  const roots = sql.join(rootIds.map((id) => sql`${id}`), sql`, `);
  const ids = tx
    .all<{ id: string; depth: number }>(sql`
      with recursive t(id, depth) as (
        select id, 0 from pages where id in (${roots})
        union all
        select p.id, t.depth + 1 from pages p join t on p.parent_id = t.id
      )
      select id, max(depth) as depth from t group by id order by depth desc
    `)
    .map((r) => r.id);
  if (!ids.length) return 0;
  tx.run(sql`pragma defer_foreign_keys = on`);

  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const inChunk = sql.join(chunk.map((id) => sql`${id}`), sql`, `);
    // Relations elsewhere twinned with properties of purged databases lose their twin.
    const props = tx.select({ id: dbProperties.id }).from(dbProperties).where(inArray(dbProperties.databaseId, chunk)).all().map((p) => p.id);
    if (props.length) {
      const inProps = sql.join(props.map((id) => sql`${id}`), sql`, `);
      tx.run(sql`update db_properties set config = json_remove(config, '$.reverseOf') where json_extract(config, '$.reverseOf') in (${inProps})`);
      tx.run(sql`update db_properties set config = json_remove(config, '$.reverseId') where json_extract(config, '$.reverseId') in (${inProps})`);
    }
    tx.delete(propertyLinks).where(sql`${propertyLinks.pageId} in (${inChunk}) or ${propertyLinks.targetId} in (${inChunk})`).run();
    tx.delete(pageProps).where(inArray(pageProps.pageId, chunk)).run();
    tx.delete(searchRows).where(inArray(searchRows.pageId, chunk)).run();
    tx.delete(blocks).where(inArray(blocks.pageId, chunk)).run();
    tx.delete(automations).where(inArray(automations.databaseId, chunk)).run();
    tx.delete(dbViews).where(inArray(dbViews.databaseId, chunk)).run();
    // Values, links and search rows of these properties cascade.
    tx.delete(dbProperties).where(inArray(dbProperties.databaseId, chunk)).run();
    tx.update(workspaces).set({ homePageId: null }).where(inArray(workspaces.homePageId, chunk)).run();
  }
  // Deepest first, so each page goes after its children.
  for (const id of ids) tx.delete(pages).where(eq(pages.id, id)).run();
  return ids.length;
}

/** Purge what has been in the trash longer than RETENTION_DAYS. */
export function purgeExpired(db: Db, now = Date.now()) {
  const old = db
    .select({ id: pages.id })
    .from(pages)
    .where(sql`${pages.archivedAt} is not null and ${pages.archivedAt} < ${now - RETENTION_DAYS * DAY}`)
    .all()
    .map((r) => r.id);
  if (!old.length) return 0;
  return db.transaction((tx) => purgePages(tx, old));
}

