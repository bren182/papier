import type { FastifyInstance } from 'fastify';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { BlockBatch } from '@papier/core';
import type { Db } from '../db/index.ts';
import { liveLineage } from '../db/lineage.ts';
import { linkedChildren, OWNING_BLOCKS, syncChildren } from '../db/pageTree.ts';
import { indexBlocks } from '../db/search.ts';
import { blocks, pages } from '../db/schema.ts';

const blockFields = {
  id: blocks.id,
  type: blocks.type,
  parentId: blocks.parentId,
  order: blocks.orderKey,
  props: blocks.props,
  content: blocks.content,
};

/** Thrown inside the save transaction to roll it back with a 400. */
class InvalidBatch extends Error {}

export function blockRoutes(app: FastifyInstance, db: Db) {
  /** Every block of one page, flat; the client assembles the tree from parentId + order. */
  app.get<{ Params: { id: string } }>('/api/pages/:id/blocks', async (req, reply) => {
    if (!liveLineage(db, req.params.id)) return reply.code(404).send({ error: 'Page not found' });
    return db.select(blockFields).from(blocks).where(eq(blocks.pageId, req.params.id)).orderBy(asc(blocks.orderKey)).all();
  });

  /**
   * Autosave: upsert changed blocks and delete removed ones, atomically. Deletes
   * run after upserts, so a child moved out of a deleted parent survives.
   */
  app.post<{ Params: { id: string } }>('/api/pages/:id/blocks/batch', async (req, reply) => {
    const pageId = req.params.id;
    const { upserts, deletes } = BlockBatch.parse(req.body ?? {});
    if (!liveLineage(db, pageId)) return reply.code(404).send({ error: 'Page not found' });

    try {
      db.transaction((tx) => {
        // Parents may arrive after their children within one batch; check FKs at commit.
        tx.run(sql`pragma defer_foreign_keys = on`);
        const now = Date.now();
        // Sub-pages whose page block this batch removes go to the trash; re-added ones come back.
        const touchesPages = deletes.length > 0 || upserts.some((b) => OWNING_BLOCKS.includes(b.type));
        const children = touchesPages ? linkedChildren(tx, pageId) : null;

        if (upserts.length) {
          const foreign = tx
            .select({ id: blocks.id })
            .from(blocks)
            .where(and(inArray(blocks.id, upserts.map((b) => b.id)), sql`${blocks.pageId} <> ${pageId}`))
            .get();
          if (foreign) throw new InvalidBatch(`Block ${foreign.id} belongs to another page`);
        }

        for (const b of upserts) {
          const row = { parentId: b.parentId, type: b.type, orderKey: b.order, props: b.props, content: b.content, updatedAt: now };
          tx.insert(blocks)
            .values({ id: b.id, pageId, createdAt: now, ...row })
            .onConflictDoUpdate({ target: blocks.id, set: row })
            .run();
        }

        indexBlocks(tx, pageId, upserts);

        // Search rows go with their blocks (on delete cascade).
        if (deletes.length) {
          tx.delete(blocks).where(and(eq(blocks.pageId, pageId), inArray(blocks.id, deletes))).run();
        }

        // The page's tree must still be a tree: parents on this page, no cycles.
        const parentOf = new Map(
          tx.select({ id: blocks.id, parentId: blocks.parentId }).from(blocks).where(eq(blocks.pageId, pageId)).all()
            .map((b) => [b.id, b.parentId]),
        );
        for (const { id } of upserts) {
          if (!parentOf.has(id)) continue; // deleted in this batch
          let cur = parentOf.get(id) ?? null;
          for (let steps = 0; cur !== null; steps++) {
            if (!parentOf.has(cur)) throw new InvalidBatch(`Block ${id} has a parent outside this page`);
            if (cur === id || steps > parentOf.size) throw new InvalidBatch(`Block ${id} is nested inside itself`);
            cur = parentOf.get(cur) ?? null;
          }
        }

        if (children) syncChildren(tx, pageId, children);
        tx.update(pages).set({ updatedAt: now }).where(eq(pages.id, pageId)).run();
      });
    } catch (err) {
      if (err instanceof InvalidBatch) return reply.code(400).send({ error: err.message });
      throw err;
    }

    return { upserted: upserts.length, deleted: deletes.length };
  });
}
