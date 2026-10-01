import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { ZodError } from 'zod';
import { BLOCK_TYPES } from '@papier/core';
import { authPlugin } from './auth/plugin.ts';
import { userCount } from './auth/sessions.ts';
import { openDb, type Db } from './db/index.ts';
import { backfillPageBlocks } from './db/pageTree.ts';
import { backfillSearch } from './db/search.ts';
import { startScheduler } from './automations/scheduler.ts';
import { actionRoutes } from './routes/actions.ts';
import { authRoutes } from './routes/auth.ts';
import { automationRoutes } from './routes/automations.ts';
import { blockRoutes } from './routes/blocks.ts';
import { databaseRoutes } from './routes/databases.ts';
import { pageRoutes } from './routes/pages.ts';
import { searchRoutes } from './routes/search.ts';
import { workspaceRoutes } from './routes/workspaces.ts';
import { fileRoutes } from './routes/files.ts';
import { aiRoutes } from './routes/ai.ts';

declare module 'fastify' {
  interface FastifyInstance {
    /** The app's database, for scripts and tests that work beside the API (CLI tools, test fixtures). */
    db: Db;
  }
}

type AppOptions = {
  /** SQLite file path; ':memory:' for tests. */
  dbPath?: string;
  logger?: boolean;
  /** Run scheduled automations (the real server only: not tests or scripts). */
  scheduler?: boolean;
  /** The public URL (`PAPIER_ORIGIN`); https makes the session cookie `Secure`. */
  origin?: string;
  /** Token that creating the first account needs (`PAPIER_SETUP_TOKEN`); random and logged when unset. */
  setupToken?: string;
  /** Behind a reverse proxy (Caddy): trust X-Forwarded-For for the client IP (`TRUST_PROXY=1`). */
  trustProxy?: boolean;
};

export function buildApp({
  dbPath = ':memory:',
  logger = true,
  scheduler = false,
  origin = process.env.PAPIER_ORIGIN,
  setupToken = process.env.PAPIER_SETUP_TOKEN,
  trustProxy = process.env.TRUST_PROXY === '1',
}: AppOptions = {}) {
  const app = Fastify({ logger: logger && { level: process.env.LOG_LEVEL ?? 'info' }, trustProxy });
  const { db, sqlite } = openDb(dbPath);
  app.decorate('db', db);
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

  // Until the first account exists, setup needs this token: a stranger can't claim a fresh server.
  const token = setupToken || randomBytes(9).toString('base64url');
  if (userCount(db) === 0) app.log.info(`No accounts yet. Open Papier and create the owner with setup token: ${token}`);
  const cookie = { secure: origin?.startsWith('https://') ?? false };

  // File uploads (20 MB cap); /files/* is served without auth
  const uploadsDir = dbPath === ':memory:' ? ':memory:' : join(dirname(dbPath), 'uploads');
  if (uploadsDir !== ':memory:') mkdirSync(uploadsDir, { recursive: true });
  app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });

  authPlugin(app, db);
  app.get('/api/health', async () => ({ ok: true, blockTypes: BLOCK_TYPES.length }));
  authRoutes(app, db, { ...cookie, setupToken: () => (userCount(db) === 0 ? token : null) });
  pageRoutes(app, db);
  blockRoutes(app, db);
  databaseRoutes(app, db);
  searchRoutes(app, db);
  actionRoutes(app, db);
  automationRoutes(app, db);
  workspaceRoutes(app, db);
  if (uploadsDir !== ':memory:') fileRoutes(app, uploadsDir);
  aiRoutes(app, db);

  return app;
}
