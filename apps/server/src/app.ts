import Fastify from 'fastify';
import { ZodError } from 'zod';
import { BLOCK_TYPES } from '@papier/core';
import { openDb } from './db/index.ts';
import { backfillPageBlocks } from './db/pageTree.ts';
import { backfillSearch } from './db/search.ts';
import { startScheduler } from './automations/scheduler.ts';
import { actionRoutes } from './routes/actions.ts';
import { automationRoutes } from './routes/automations.ts';
import { blockRoutes } from './routes/blocks.ts';
import { databaseRoutes } from './routes/databases.ts';
import { pageRoutes } from './routes/pages.ts';
import { searchRoutes } from './routes/search.ts';

type AppOptions = {
  /** SQLite file path; ':memory:' for tests. */
  dbPath?: string;
  logger?: boolean;
  /** Run scheduled automations (the real server only: not tests or scripts). */
  scheduler?: boolean;
};

export function buildApp({ dbPath = ':memory:', logger = true, scheduler = false }: AppOptions = {}) {
  const app = Fastify({ logger: logger && { level: process.env.LOG_LEVEL ?? 'info' } });
  const { db, sqlite } = openDb(dbPath);
  const linked = backfillPageBlocks(db);
  if (linked) app.log.info({ pages: linked }, 'Added page blocks for sub-pages');
  const backfilled = backfillSearch(db);
  if (backfilled) app.log.info({ rows: backfilled }, 'Indexed blocks and property values for search');

  const stopScheduler = scheduler ? startScheduler(db, app.log) : null;
  app.addHook('onClose', async () => {
    stopScheduler?.();
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
  databaseRoutes(app, db);
  searchRoutes(app, db);
  actionRoutes(app, db);
  automationRoutes(app, db);

  return app;
}
