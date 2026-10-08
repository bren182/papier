import { asc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/index.ts';
import { blocks, pages } from '../db/schema.ts';

/** Public fields returned for a shared page (no share_token exposed). */
const sharedPageFields = {
  id: pages.id,
  title: pages.title,
  titleContent: pages.titleContent,
  icon: pages.icon,
  appearance: pages.appearance,
  kind: pages.kind,
};

export function shareRoutes(app: FastifyInstance, db: Db) {
  /** Public: read a page by its share token (no auth required). */
  app.get<{ Params: { token: string } }>('/api/share/:token', async (req, reply) => {
    const page = db
      .select(sharedPageFields)
      .from(pages)
      .where(eq(pages.shareToken, req.params.token))
      .get();
    if (!page) return reply.code(404).send({ error: 'Shared page not found' });

    const pageBlocks = db
      .select({
        id: blocks.id,
        type: blocks.type,
        parentId: blocks.parentId,
        order: blocks.orderKey,
        props: blocks.props,
        content: blocks.content,
      })
      .from(blocks)
      .where(eq(blocks.pageId, page.id))
      .orderBy(asc(blocks.orderKey))
      .all();

    return { page, blocks: pageBlocks };
  });
}
