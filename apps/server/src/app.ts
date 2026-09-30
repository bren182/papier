import Fastify from 'fastify';
import { ZodError } from 'zod';
import { BLOCK_TYPES } from '@papier/core';
import { openDb } from './db/index.ts';
import { blockRoutes } from './routes/blocks.ts';
import { pageRoutes } from './routes/pages.ts';

type AppOptions = {
  /** SQLite file path; ':memory:' for tests. */
  dbPath?: string;
  logger?: boolean;
};

export function buildApp({ dbPath = ':memory:', logger = true }: AppOptions = {}) {
  const app = Fastify({ logger: logger && { level: process.env.LOG_LEVEL ?? 'info' } });
  const { db, sqlite } = openDb(dbPath);

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

  return app;
}
