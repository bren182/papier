import Fastify from 'fastify';
import { BLOCK_TYPES } from '@papier/core';

export function buildApp() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

  app.get('/api/health', async () => ({ ok: true, blockTypes: BLOCK_TYPES.length }));

  return app;
}
