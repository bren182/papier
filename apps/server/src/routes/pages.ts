import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gt, isNull, lt, ne, sql } from 'drizzle-orm';
import { orderBetween, PageCreate, PageDuplicate, PageMove, PageUpdate, plainText } from '@papier/core';
import { duplicatePage, TooBig } from '../db/duplicate.ts';
import type { Db } from '../db/index.ts';
import { liveLineage } from '../db/lineage.ts';
import { appendPageBlock, isSelfOrDescendant, removePageBlocks } from '../db/pageTree.ts';
import { indexTitle } from '../db/search.ts';
import { createDefaultView } from './databases.ts';
import { pageProps, pages } from '../db/schema.ts';

const pageFields = {
  id: pages.id,
  parentId: pages.parentId,
  title: pages.title,
  titleContent: pages.titleContent,
  icon: pages.icon,
  kind: pages.kind,
  isTemplate: pages.isTemplate,
  order: pages.orderKey,
  // Qualified by hand: drizzle renders ${pages.id} unqualified in single-table
  // queries, which would bind to the subquery's own row. A database's children
  // are its rows, which the sidebar never lists.
  hasChildren: sql<boolean>`pages.kind <> 'database' and exists (
    select 1 from pages c where c.parent_id = pages.id and c.archived_at is null and c.is_template = 0
  )`.mapWith(Boolean),
  createdAt: pages.createdAt,
  updatedAt: pages.updatedAt,
};

/** The database a page is a row of, if any. */
export function rowDatabase(db: Db, pageId: string) {
  return db.get<{ id: string; title: string }>(sql`
    select d.id, d.title from pages p join pages d on d.id = p.parent_id and d.kind = 'database' where p.id = ${pageId}
  `) ?? null;
}

export function pageRoutes(app: FastifyInstance, db: Db) {
  /** Children of one parent (root when `parent` is omitted). The sidebar loads lazily. */
  app.get<{ Querystring: { parent?: string } }>('/api/pages', async (req) => {
    const parent = req.query.parent;
    return db
      .select(pageFields)
      .from(pages)
      .where(and(parent ? eq(pages.parentId, parent) : isNull(pages.parentId), isNull(pages.archivedAt), eq(pages.isTemplate, false)))
      .orderBy(asc(pages.orderKey))
      .all();
  });

  /** The template library: page templates (database templates live in their database). */
  app.get('/api/templates', async () =>
    db
      .select({ id: pages.id, title: pages.title, titleContent: pages.titleContent, icon: pages.icon, kind: pages.kind, updatedAt: pages.updatedAt })
      .from(pages)
      .where(and(isNull(pages.parentId), eq(pages.isTemplate, true), isNull(pages.archivedAt)))
      .orderBy(asc(sql`lower(${pages.title})`))
      .limit(200)
      .all(),
  );

  /** One page plus its ancestors (root first) for breadcrumbs. */
  app.get<{ Params: { id: string } }>('/api/pages/:id', async (req, reply) => {
    const lineage = liveLineage(db, req.params.id);
    if (!lineage) return reply.code(404).send({ error: 'Page not found' });

    const page = db.select(pageFields).from(pages).where(eq(pages.id, req.params.id)).get();
    const database = rowDatabase(db, req.params.id);
    // A row carries its property values (the database's schema is loaded separately).
    const props = database
      ? Object.fromEntries(
          db.select({ propId: pageProps.propId, value: pageProps.value }).from(pageProps).where(eq(pageProps.pageId, req.params.id)).all()
            .map((v) => [v.propId, v.value]),
        )
      : null;
    // Inside a template (not one itself): its dates stay dynamic too.
    const inTemplate = Boolean(
      db.get<{ hit: number }>(sql`
        with recursive up(id, parent_id) as (
          select id, parent_id from pages where id = ${req.params.id}
          union all
          select p.id, p.parent_id from pages p join up on p.id = up.parent_id
        )
        select exists (select 1 from up join pages p on p.id = up.id where up.id <> ${req.params.id} and p.is_template = 1) as hit
      `)?.hit,
    );
    return { page, ancestors: lineage.slice(0, -1), database, props, inTemplate };
  });

  app.post('/api/pages', async (req, reply) => {
    const input = PageCreate.parse(req.body ?? {});

    if (input.parentId) {
      const parent = db
        .select({ id: pages.id, kind: pages.kind })
        .from(pages)
        .where(and(eq(pages.id, input.parentId), isNull(pages.archivedAt)))
        .get();
      if (!parent) return reply.code(404).send({ error: 'Parent page not found' });
      if (parent.kind === 'database') return reply.code(400).send({ error: 'Add rows through /api/databases/:id/rows' });
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
          kind: input.kind,
          orderKey: orderBetween(last?.orderKey ?? null, null),
          createdAt: now,
          updatedAt: now,
        })
        .run();
      indexTitle(tx, id, input.title);
      if (input.kind === 'database') createDefaultView(tx, id);
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
    // Rows stay in their database (reorder them through the database routes).
    const intoDatabase = parentId && db.select({ kind: pages.kind }).from(pages).where(eq(pages.id, parentId)).get()?.kind === 'database';
    if (intoDatabase || rowDatabase(db, id)) return reply.code(400).send({ error: 'Rows can’t move between databases and pages' });

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

  /**
   * Deep copy: Duplicate (next to the original), Save as template (a library
   * template, or a row template in the row's database) and Use template.
   */
  app.post<{ Params: { id: string } }>('/api/pages/:id/duplicate', async (req, reply) => {
    const input = PageDuplicate.parse(req.body ?? {});
    const id = req.params.id;
    if (!liveLineage(db, id)) return reply.code(404).send({ error: 'Page not found' });
    const src = db.select({ parentId: pages.parentId, orderKey: pages.orderKey, isTemplate: pages.isTemplate }).from(pages).where(eq(pages.id, id)).get()!;
    const srcDatabase = rowDatabase(db, id);

    // Rows and row templates stay in their database; everything else can go anywhere.
    const parentId = srcDatabase ? srcDatabase.id : input.asTemplate ? null : input.parentId === undefined ? src.parentId : input.parentId;
    if (srcDatabase && input.parentId !== undefined && input.parentId !== srcDatabase.id) {
      return reply.code(400).send({ error: 'Database templates and rows stay in their database' });
    }
    if (parentId && !srcDatabase) {
      if (!liveLineage(db, parentId)) return reply.code(404).send({ error: 'Target page not found' });
      const parent = db.select({ kind: pages.kind }).from(pages).where(eq(pages.id, parentId)).get();
      if (parent?.kind === 'database') return reply.code(400).send({ error: 'Only rows and row templates go in a database' });
    }

    // Beside the original when duplicating in place; otherwise last.
    const siblings = and(parentId ? eq(pages.parentId, parentId) : isNull(pages.parentId), isNull(pages.archivedAt));
    const beside = parentId === src.parentId && !input.asTemplate && !src.isTemplate;
    const after = beside
      ? db.select({ k: pages.orderKey }).from(pages).where(and(siblings, gt(pages.orderKey, src.orderKey))).orderBy(asc(pages.orderKey)).limit(1).get()?.k ?? null
      : null;
    const before = beside ? src.orderKey : db.select({ k: pages.orderKey }).from(pages).where(siblings).orderBy(desc(pages.orderKey)).limit(1).get()?.k ?? null;

    let newId: string;
    try {
      newId = db.transaction((tx) => {
        const copy = duplicatePage(tx, id, { parentId, orderKey: orderBetween(before, after), isTemplate: input.asTemplate }, input.today);
        const parentKind = parentId && tx.select({ kind: pages.kind }).from(pages).where(eq(pages.id, parentId)).get()?.kind;
        if (parentId && parentKind === 'page' && input.block) appendPageBlock(tx, parentId, copy);
        return copy;
      });
    } catch (err) {
      if (err instanceof TooBig) return reply.code(400).send({ error: err.message });
      throw err;
    }
    return reply.code(201).send(db.select(pageFields).from(pages).where(eq(pages.id, newId)).get());
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
