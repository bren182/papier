import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.ts';
import { getVapidPublicKey, saveSubscription, removeSubscription } from '../db/push.ts';

export function pushRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/push/vapid-key', async () => ({
    publicKey: getVapidPublicKey(db),
  }));

  app.post('/api/push/subscribe', async (req, reply) => {
    const body = z
      .object({
        endpoint: z.string().url(),
        keys: z.object({ p256dh: z.string(), auth: z.string() }),
      })
      .parse(req.body);
    saveSubscription(db, req.user!.id, body);
    return reply.code(204).send();
  });

  app.delete('/api/push/subscribe', async (req, reply) => {
    const { endpoint } = z.object({ endpoint: z.string() }).parse(req.body);
    removeSubscription(db, endpoint);
    return reply.code(204).send();
  });
}
