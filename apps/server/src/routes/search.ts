import type { FastifyInstance } from 'fastify';
import { SearchQuery } from '@papier/core';
import type { Db } from '../db/index.ts';
import { liveLineage } from '../db/lineage.ts';
import { searchPages } from '../db/search.ts';

export function searchRoutes(app: FastifyInstance, db: Db) {
  /** Full-text search over page titles and blocks: one hit per page, best first, paginated. */
  app.get('/api/search', async (req) => {
    const { q, limit, offset } = SearchQuery.parse(req.query ?? {});
    const { items, nextOffset } = searchPages(db, q, { limit, offset });
    return {
      items: items.map(({ pageId, title, titleContent, icon, blockId, snippet }) => ({
        page: { id: pageId, title, titleContent, icon },
        // Every hit is live, so its lineage is too; drop the page itself.
        ancestors: (liveLineage(db, pageId) ?? []).slice(0, -1),
        blockId,
        snippet,
      })),
      nextOffset,
    };
  });
}
