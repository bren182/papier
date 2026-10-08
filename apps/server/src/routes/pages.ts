import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { InvalidValue, orderBetween, PageCreate, PageDuplicate, PageMove, PageUpdate, plainText } from '@papier/core';
import { duplicatePage, TooBig } from '../db/duplicate.ts';
import type { Db } from '../db/index.ts';
import { liveLineage } from '../db/lineage.ts';
import { appendPageBlock, isSelfOrDescendant, removePageBlocks } from '../db/pageTree.ts';
import { rowValues } from '../db/relations.ts';
import { indexTitle } from '../db/search.ts';
import { listTrash, purgePages, restorePage } from '../db/trash.ts';
import { createDefaultView } from './databases.ts';
import { pages } from '../db/schema.ts';

const pageFields = {
  id: pages.id,
  parentId: pages.parentId,
  title: pages.title,
  titleContent: pages.titleContent,
  icon: pages.icon,
  appearance: pages.appearance,
  kind: pages.kind,
  isTemplate: pages.isTemplate,
  order: pages.orderKey,
  favorite: sql<boolean>`${pages.favoriteKey} is not null`.mapWith(Boolean),
  // Qualified by hand: drizzle renders ${pages.id} unqualified in single-table
  // queries, which would bind to the subquery's own row. A database's children
  // are its rows, which the sidebar never lists.
  hasChildren: sql<boolean>`pages.kind <> 'database' and exists (
    select 1 from pages c where c.parent_id = pages.id and c.archived_at is null and c.is_template = 0
  )`.mapWith(Boolean),
  shareToken: pages.shareToken,
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
    const wsFilter = req.workspaceId ? eq(pages.workspaceId, req.workspaceId) : undefined;
    return db
      .select(pageFields)
      .from(pages)
      .where(and(parent ? eq(pages.parentId, parent) : isNull(pages.parentId), isNull(pages.archivedAt), eq(pages.isTemplate, false), wsFilter))
      .orderBy(asc(pages.orderKey))
      .all();
  });

  /**
   * The sidebar's Favourites: starred pages that are live (no trashed or
   * template ancestor), in starring order.
   */
  app.get('/api/favorites', async (req) => {
    const wsFilter = req.workspaceId ? sql`and p.workspace_id = ${req.workspaceId}` : sql``;
    const ids = db
      .all<{ id: string }>(sql`
        with recursive up(fav, id, dead) as (
          select p.id, p.parent_id, p.archived_at is not null or p.is_template from pages p where p.favorite_key is not null ${wsFilter}
          union all
          select up.fav, a.parent_id, a.archived_at is not null or a.is_template from up join pages a on a.id = up.id where up.dead = 0
        )
        select fav as id from up group by fav having max(dead) = 0
      `)
      .map((r) => r.id);
    if (ids.length === 0) return [];
    return db.select(pageFields).from(pages).where(inArray(pages.id, ids)).orderBy(asc(pages.favoriteKey)).limit(100).all();
  });

  /** The template library: page templates (database templates live in their database). */
  app.get('/api/templates', async (req) => {
    const wsFilter = req.workspaceId ? eq(pages.workspaceId, req.workspaceId) : undefined;
    return db
      .select({ id: pages.id, title: pages.title, titleContent: pages.titleContent, icon: pages.icon, kind: pages.kind, updatedAt: pages.updatedAt })
      .from(pages)
      .where(and(isNull(pages.parentId), eq(pages.isTemplate, true), isNull(pages.archivedAt), wsFilter))
      .orderBy(asc(sql`lower(${pages.title})`))
      .limit(200)
      .all();
  });

  /** One page plus its ancestors (root first) for breadcrumbs. */
  app.get<{ Params: { id: string } }>('/api/pages/:id', async (req, reply) => {
    const lineage = liveLineage(db, req.params.id);
    if (!lineage) {
      // Say whether it's in the trash (and can be restored) or gone.
      const exists = db.select({ id: pages.id }).from(pages).where(eq(pages.id, req.params.id)).get();
      return reply.code(404).send({ error: 'Page not found', trashed: Boolean(exists) });
    }
    // Workspace isolation: deny access to pages in other workspaces.
    if (req.workspaceId) {
      const ws = db.select({ workspaceId: pages.workspaceId }).from(pages).where(eq(pages.id, req.params.id)).get();
      if (ws && ws.workspaceId !== req.workspaceId) {
        return reply.code(403).send({ error: 'Access restricted' });
      }
    }

    const page = db.select(pageFields).from(pages).where(eq(pages.id, req.params.id)).get();
    const database = rowDatabase(db, req.params.id);
    // A row carries its property values and the titles of rows it links to (the schema is loaded separately).
    const values = database ? rowValues(db, req.params.id) : null;
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
    return { page, ancestors: lineage.slice(0, -1), database, props: values?.props ?? null, refs: values?.refs ?? {}, inTemplate };
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
          workspaceId: req.workspaceId ?? undefined,
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
    const { titleContent, appearance: look, favorite, ...patch } = PageUpdate.parse(req.body ?? {});
    // One source of truth: a rich title derives the plain one; a plain title drops the rich one.
    const title =
      titleContent !== undefined
        ? { titleContent, title: plainText(titleContent).slice(0, 500) }
        : patch.title !== undefined
          ? { titleContent: null }
          : {};
    const updated = db.transaction((tx) => {
      // Appearance patches merge; a null value drops that key.
      let appearance: Record<string, unknown> | undefined;
      if (look) {
        const current = tx.select({ a: pages.appearance }).from(pages).where(eq(pages.id, req.params.id)).get()?.a ?? {};
        appearance = Object.fromEntries(Object.entries({ ...current, ...look }).filter(([, v]) => v !== null && v !== undefined));
      }
      // Starring goes last among the favourites (and keeps its place if already starred).
      let favoriteKey: { favoriteKey: string | null } | undefined;
      if (favorite === false) favoriteKey = { favoriteKey: null };
      else if (favorite) {
        const own = tx.select({ k: pages.favoriteKey }).from(pages).where(eq(pages.id, req.params.id)).get()?.k;
        const last = tx.get<{ k: string | null }>(sql`select max(favorite_key) as k from pages`)?.k ?? null;
        favoriteKey = { favoriteKey: own ?? orderBetween(last, null) };
      }
      // Starring alone isn't an edit of the page.
      const edited = Object.keys(patch).length > 0 || titleContent !== undefined || look !== undefined;
      const row = tx
        .update(pages)
        .set({ ...patch, ...title, ...(appearance ? { appearance } : {}), ...favoriteKey, ...(edited ? { updatedAt: Date.now() } : {}) })
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
  // --- trash ---

  app.get<{ Querystring: { q?: string } }>('/api/trash', async (req) => listTrash(db, String(req.query.q ?? '').trim().slice(0, 200), 200, req.workspaceId));

  app.post<{ Params: { id: string } }>('/api/pages/:id/restore', async (req, reply) => {
    try {
      const result = db.transaction((tx) => restorePage(tx, req.params.id));
      return { page: db.select(pageFields).from(pages).where(eq(pages.id, req.params.id)).get(), ...result };
    } catch (err) {
      if (err instanceof InvalidValue) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  /** Delete forever: only pages already in the trash. */
  app.delete<{ Params: { id: string } }>('/api/pages/:id/purge', async (req, reply) => {
    const page = db.select({ archivedAt: pages.archivedAt }).from(pages).where(eq(pages.id, req.params.id)).get();
    if (!page) return reply.code(404).send({ error: 'Page not found' });
    if (page.archivedAt === null) return reply.code(400).send({ error: 'Only pages in the trash can be deleted forever' });
    db.transaction((tx) => purgePages(tx, [req.params.id]));
    return reply.code(204).send();
  });

  /** Enable public sharing: generate a share token and return it. */
  app.post<{ Params: { id: string } }>('/api/pages/:id/share', async (req, reply) => {
    const page = db.select({ id: pages.id, archivedAt: pages.archivedAt, shareToken: pages.shareToken }).from(pages).where(eq(pages.id, req.params.id)).get();
    if (!page || page.archivedAt !== null) return reply.code(404).send({ error: 'Page not found' });
    const token = page.shareToken ?? randomUUID().replace(/-/g, '');
    if (!page.shareToken) {
      db.update(pages).set({ shareToken: token }).where(eq(pages.id, req.params.id)).run();
    }
    return { shareToken: token };
  });

  /** Disable public sharing: revoke the share token. */
  app.delete<{ Params: { id: string } }>('/api/pages/:id/share', async (req, reply) => {
    db.update(pages).set({ shareToken: null }).where(eq(pages.id, req.params.id)).run();
    return reply.code(204).send();
  });

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
