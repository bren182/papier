import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { orderBetween, PageCreate, PageUpdate, plainText } from '@papier/core';
import type { Db } from '../db/index.ts';
import { liveLineage } from '../db/lineage.ts';
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
    db.insert(pages)
      .values({
        id,
        parentId: input.parentId,
        title: input.title,
        orderKey: orderBetween(last?.orderKey ?? null, null),
        createdAt: now,
        updatedAt: now,
      })
      .run();

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
    const updated = db
      .update(pages)
      .set({ ...patch, ...title, updatedAt: Date.now() })
      .where(and(eq(pages.id, req.params.id), isNull(pages.archivedAt)))
      .returning({ id: pages.id })
      .get();
    if (!updated) return reply.code(404).send({ error: 'Page not found' });

    return db.select(pageFields).from(pages).where(eq(pages.id, updated.id)).get();
  });

  /** Move to trash. Descendants stay attached and disappear with it. */
  app.delete<{ Params: { id: string } }>('/api/pages/:id', async (req, reply) => {
    const archived = db
      .update(pages)
      .set({ archivedAt: Date.now() })
      .where(and(eq(pages.id, req.params.id), isNull(pages.archivedAt)))
      .returning({ id: pages.id })
      .get();
    if (!archived) return reply.code(404).send({ error: 'Page not found' });
    return reply.code(204).send();
  });
}
