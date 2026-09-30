import Fastify from 'fastify';
import { ZodError } from 'zod';
import { BLOCK_TYPES } from '@papier/core';
import { openDb } from './db/index.ts';
import { backfillPageBlocks } from './db/pageTree.ts';
import { backfillSearch } from './db/search.ts';
import { blockRoutes } from './routes/blocks.ts';
import { pageRoutes } from './routes/pages.ts';
import { searchRoutes } from './routes/search.ts';

type AppOptions = {
  /** SQLite file path; ':memory:' for tests. */
  dbPath?: string;
  logger?: boolean;
};

export function buildApp({ dbPath = ':memory:', logger = true }: AppOptions = {}) {
  const app = Fastify({ logger: logger && { level: process.env.LOG_LEVEL ?? 'info' } });
  const { db, sqlite } = openDb(dbPath);
  const linked = backfillPageBlocks(db);
  if (linked) app.log.info({ pages: linked }, 'Added page blocks for sub-pages');
  const backfilled = backfillSearch(db);
  if (backfilled) app.log.info({ blocks: backfilled }, 'Indexed blocks for search');

  app.addHook('onClose', async () => {
    sqlite.close();
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'Invalid request', issues: err.issues });
    }
    return reply.send(err);
  });

  app.get('/api/health', async () => ({ ok: true, blockTypes: BLOCK_TYPES.length }));
  pageRoutes(app, db);
  blockRoutes(app, db);
  searchRoutes(app, db);

  return app;
}
