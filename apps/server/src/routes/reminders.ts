import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.ts';
import { listReminders } from '../db/reminders.ts';

export function reminderRoutes(app: FastifyInstance, db: Db) {
  /** @remind nodes due on or before the given date. */
  app.get('/api/reminders', async (req) => {
    const { date } = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.query);
    return listReminders(db, date);
  });
}
