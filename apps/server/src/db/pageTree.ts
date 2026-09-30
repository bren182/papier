import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { orderBetween } from '@papier/core';
import type { Db } from './index.ts';
import { blocks, pages } from './schema.ts';

/**
 * Sub-pages live in their parent's content as `page` blocks (props.pageId).
 * The invariant: a child page is live exactly when its parent's content holds a
 * page block pointing at it. A page block pointing at any other page is just a
 * link and never changes that page. An inline database's `database` block
 * (also props.pageId) owns its database the same way.
 *
 * Rows are exempt: a database's child pages are its rows and have no blocks.
 */

/** Block types that own the page in props.pageId. */
export const OWNING_BLOCKS = ['page', 'database'];
const owning = sql`(${sql.join(OWNING_BLOCKS.map((t) => sql`${t}`), sql`, `)})`;

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Conn = Db | Tx;

/** Append a page block for `pageId` at the end of `parentId`'s top-level content. */
export function appendPageBlock(db: Conn, parentId: string, pageId: string) {
  const last = db
    .select({ orderKey: blocks.orderKey })
    .from(blocks)
    .where(and(eq(blocks.pageId, parentId), isNull(blocks.parentId)))
    .orderBy(desc(blocks.orderKey))
    .limit(1)
    .get();
  const now = Date.now();
  db.insert(blocks)
    .values({
      id: randomUUID(),
      pageId: parentId,
      parentId: null,
      type: 'page',
      orderKey: orderBetween(last?.orderKey ?? null, null),
      props: { pageId },
      content: [],
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

/** Remove every page/database block in `parentId`'s content that points at `pageId`. */
export function removePageBlocks(db: Conn, parentId: string, pageId: string) {
  db.delete(blocks)
    .where(and(eq(blocks.pageId, parentId), inArray(blocks.type, OWNING_BLOCKS), sql`json_extract(${blocks.props}, '$.pageId') = ${pageId}`))
    .run();
}

/** Ids of this page's children that its content currently holds a page block for. */
export function linkedChildren(db: Conn, parentId: string): Set<string> {
  const rows = db.all<{ id: string }>(sql`
    select distinct c.id from blocks b
    join pages c on c.id = json_extract(b.props, '$.pageId') and c.parent_id = b.page_id
    where b.page_id = ${parentId} and b.type in ${owning}
  `);
  return new Set(rows.map((r) => r.id));
}

/**
 * After a content save changed which children have page blocks: removed ones
 * go to the trash (with their subtree), re-added ones (undo) come back.
 */
export function syncChildren(db: Conn, parentId: string, before: Set<string>) {
  const after = linkedChildren(db, parentId);
  const gone = [...before].filter((id) => !after.has(id));
  const back = [...after].filter((id) => !before.has(id));
  const now = Date.now();
  if (gone.length) {
    db.update(pages)
      .set({ archivedAt: now })
      .where(and(inArray(pages.id, gone), isNull(pages.archivedAt)))
      .run();
  }
  if (back.length) {
    db.update(pages)
      .set({ archivedAt: null, updatedAt: now })
      .where(and(inArray(pages.id, back), isNotNull(pages.archivedAt)))
      .run();
  }
}

/** Whether `id` is `ancestorId` or somewhere below it. */
export function isSelfOrDescendant(db: Conn, ancestorId: string, id: string): boolean {
  const row = db.get<{ hit: number }>(sql`
    with recursive up(id, parent_id) as (
      select id, parent_id from pages where id = ${id}
      union all
      select p.id, p.parent_id from pages p join up on p.id = up.parent_id
    )
    select exists (select 1 from up where id = ${ancestorId}) as hit
  `);
  return Boolean(row?.hit);
}

/**
 * Give every live child page without a page block one at the end of its
 * parent's content (pages created before page blocks existed). Idempotent.
 * @returns how many blocks were added
 */
export function backfillPageBlocks(db: Db) {
  const orphans = db.all<{ id: string; parent_id: string }>(sql`
    select c.id, c.parent_id from pages c
    join pages p on p.id = c.parent_id and p.kind <> 'database'
    where c.archived_at is null
      and not exists (
        select 1 from blocks b
        where b.page_id = c.parent_id and b.type in ${owning} and json_extract(b.props, '$.pageId') = c.id
      )
    order by c.parent_id, c.order_key
  `);
  if (orphans.length) db.transaction((tx) => orphans.forEach((o) => appendPageBlock(tx, o.parent_id, o.id)));
  return orphans.length;
}
