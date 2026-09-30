import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gt, isNull, lt, ne, sql } from 'drizzle-orm';
import { orderBetween, PageCreate, PageMove, PageUpdate, plainText } from '@papier/core';
import type { Db } from '../db/index.ts';
import { liveLineage } from '../db/lineage.ts';
import { appendPageBlock, isSelfOrDescendant, removePageBlocks } from '../db/pageTree.ts';
import { indexTitle } from '../db/search.ts';
import { pages } from '../db/schema.ts';

const pageFields = {
  id: pages.id,
  parentId: pages.parentId,
  title: pages.title,
  titleContent: pages.titleContent,
  icon: pages.icon,
  order: pages.orderKey,
  // Qualified by hand: drizzle renders ${pages.id} unqualified in single-table
  // queries, which would bind to the subquery's own row.
  hasChildren: sql<boolean>`exists (
    select 1 from pages c where c.parent_id = pages.id and c.archived_at is null
  )`.mapWith(Boolean),
  createdAt: pages.createdAt,
  updatedAt: pages.updatedAt,
};

export function pageRoutes(app: FastifyInstance, db: Db) {
  /** Children of one parent (root when `parent` is omitted). The sidebar loads lazily. */
  app.get<{ Querystring: { parent?: string } }>('/api/pages', async (req) => {
    const parent = req.query.parent;
    return db
      .select(pageFields)
      .from(pages)
      .where(and(parent ? eq(pages.parentId, parent) : isNull(pages.parentId), isNull(pages.archivedAt)))
      .orderBy(asc(pages.orderKey))
      .all();
  });

  /** One page plus its ancestors (root first) for breadcrumbs. */
  app.get<{ Params: { id: string } }>('/api/pages/:id', async (req, reply) => {
    const lineage = liveLineage(db, req.params.id);
    if (!lineage) return reply.code(404).send({ error: 'Page not found' });

    const page = db.select(pageFields).from(pages).where(eq(pages.id, req.params.id)).get();
    return { page, ancestors: lineage.slice(0, -1) };
  });

  app.post('/api/pages', async (req, reply) => {
    const input = PageCreate.parse(req.body ?? {});

    if (input.parentId) {
      const parent = db
        .select({ id: pages.id })
        .from(pages)
        .where(and(eq(pages.id, input.parentId), isNull(pages.archivedAt)))
        .get();
      if (!parent) return reply.code(404).send({ error: 'Parent page not found' });
    }

    const last = db
      .select({ orderKey: pages.orderKey })
      .from(pages)
      .where(input.parentId ? eq(pages.parentId, input.parentId) : isNull(pages.parentId))
      .orderBy(desc(pages.orderKey))
      .limit(1)
      .get();

    const now = Date.now();
    const id = randomUUID();
    db.transaction((tx) => {
      tx.insert(pages)
        .values({
          id,
          parentId: input.parentId,
          title: input.title,
          orderKey: orderBetween(last?.orderKey ?? null, null),
          createdAt: now,
          updatedAt: now,
        })
        .run();
      indexTitle(tx, id, input.title);
      // The sub-page shows up in its parent's content.
      if (input.parentId && input.block) appendPageBlock(tx, input.parentId, id);
    });

    const page = db.select(pageFields).from(pages).where(eq(pages.id, id)).get();
    return reply.code(201).send(page);
  });

  app.patch<{ Params: { id: string } }>('/api/pages/:id', async (req, reply) => {
    const { titleContent, ...patch } = PageUpdate.parse(req.body ?? {});
    // One source of truth: a rich title derives the plain one; a plain title drops the rich one.
    const title =
      titleContent !== undefined
        ? { titleContent, title: plainText(titleContent).slice(0, 500) }
        : patch.title !== undefined
          ? { titleContent: null }
          : {};
    const updated = db.transaction((tx) => {
      const row = tx
        .update(pages)
        .set({ ...patch, ...title, updatedAt: Date.now() })
        .where(and(eq(pages.id, req.params.id), isNull(pages.archivedAt)))
        .returning({ id: pages.id, title: pages.title })
        .get();
      if (row && (patch.title !== undefined || titleContent !== undefined)) indexTitle(tx, row.id, row.title);
      return row;
    });
    if (!updated) return reply.code(404).send({ error: 'Page not found' });

    return db.select(pageFields).from(pages).where(eq(pages.id, updated.id)).get();
  });

  /**
   * Move a page under a new parent (null = root), before/after a sibling there
   * or last. Its page block moves from the old parent's content to the new one's.
   */
  app.post<{ Params: { id: string } }>('/api/pages/:id/move', async (req, reply) => {
    const { parentId, beforeId, afterId } = PageMove.parse(req.body ?? {});
    const id = req.params.id;
    if (!liveLineage(db, id)) return reply.code(404).send({ error: 'Page not found' });
    if (parentId) {
      if (!liveLineage(db, parentId)) return reply.code(404).send({ error: 'Target page not found' });
      if (isSelfOrDescendant(db, id, parentId)) return reply.code(400).send({ error: 'Can’t move a page inside itself' });
    }

    const inTarget = and(parentId ? eq(pages.parentId, parentId) : isNull(pages.parentId), isNull(pages.archivedAt), ne(pages.id, id));
    const refId = beforeId ?? afterId;
    const ref = refId && db.select({ orderKey: pages.orderKey }).from(pages).where(and(inTarget, eq(pages.id, refId))).get();
    if (refId && !ref) return reply.code(400).send({ error: 'Sibling not found under the target' });

    /** Nearest sibling key on one side of `key` (both ends when key is null). */
    const neighbour = (side: 'before' | 'after', key: string | null) =>
      db
        .select({ orderKey: pages.orderKey })
        .from(pages)
        .where(and(inTarget, key === null ? undefined : side === 'before' ? lt(pages.orderKey, key) : gt(pages.orderKey, key)))
        .orderBy(side === 'before' ? desc(pages.orderKey) : asc(pages.orderKey))
        .limit(1)
        .get()?.orderKey ?? null;

    const orderKey = !ref
      ? orderBetween(neighbour('before', null), null)
      : beforeId
        ? orderBetween(neighbour('before', ref.orderKey), ref.orderKey)
        : orderBetween(ref.orderKey, neighbour('after', ref.orderKey));

    db.transaction((tx) => {
      const old = tx.select({ parentId: pages.parentId }).from(pages).where(eq(pages.id, id)).get();
      tx.update(pages).set({ parentId, orderKey, updatedAt: Date.now() }).where(eq(pages.id, id)).run();
      if (old && old.parentId !== parentId) {
        if (old.parentId) removePageBlocks(tx, old.parentId, id);
        if (parentId) appendPageBlock(tx, parentId, id);
      }
    });

    return db.select(pageFields).from(pages).where(eq(pages.id, id)).get();
  });

  /** Move to trash. Descendants stay attached and disappear with it; so does its page block. */
  app.delete<{ Params: { id: string } }>('/api/pages/:id', async (req, reply) => {
    const archived = db.transaction((tx) => {
      const row = tx
        .update(pages)
        .set({ archivedAt: Date.now() })
        .where(and(eq(pages.id, req.params.id), isNull(pages.archivedAt)))
        .returning({ id: pages.id, parentId: pages.parentId })
        .get();
      if (row?.parentId) removePageBlocks(tx, row.parentId, row.id);
      return row;
    });
    if (!archived) return reply.code(404).send({ error: 'Page not found' });
    return reply.code(204).send();
  });
}
