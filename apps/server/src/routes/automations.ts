import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { AutomationCreate, AutomationUpdate, InvalidValue, TITLE_PROP } from '@papier/core';
import { dueAt, isTimeZone, runSchedule } from '../db/automations.ts';
import type { Db } from '../db/index.ts';
import { liveLineage } from '../db/lineage.ts';
import { properties, type Tx } from '../db/props.ts';
import { placeKey } from '../db/rows.ts';
import { automations, pages } from '../db/schema.ts';

const fields = {
  id: automations.id,
  name: automations.name,
  enabled: automations.enabled,
  trigger: automations.trigger,
  actions: automations.actions,
  tz: automations.tz,
  order: automations.orderKey,
  nextRunAt: automations.nextRunAt,
  lastRunAt: automations.lastRunAt,
  lastError: automations.lastError,
};

/** A database's automations (see db/automations.ts): list, create, edit, delete, run a schedule now. */
export function automationRoutes(app: FastifyInstance, db: Db) {
  const liveDatabase = (id: string) => {
    const row = db.select({ kind: pages.kind }).from(pages).where(and(eq(pages.id, id), isNull(pages.archivedAt))).get();
    return row?.kind === 'database' && liveLineage(db, id) ? id : null;
  };
  const one = (id: string) => db.select(fields).from(automations).where(eq(automations.id, id)).get();

  /** A trigger may only watch (and filter on) this database's properties; the zone must exist. */
  const check = (databaseId: string, input: { trigger?: { type: string; propId?: string }; tz?: string }) => {
    if (input.tz !== undefined && !isTimeZone(input.tz)) throw new InvalidValue(`Unknown time zone ${input.tz}`);
    const t = input.trigger;
    if (t?.type === 'prop_changed' && t.propId !== TITLE_PROP && !properties(db, databaseId).some((p) => p.id === t.propId)) {
      throw new InvalidValue('That property isn’t in this database');
    }
  };

  const write = <T>(reply: import('fastify').FastifyReply, fn: (tx: Tx) => T) => {
    try {
      return db.transaction(fn);
    } catch (err) {
      if (err instanceof InvalidValue) {
        reply.code(400).send({ error: err.message });
        return undefined;
      }
      throw err;
    }
  };

  app.get<{ Params: { id: string } }>('/api/databases/:id/automations', async (req, reply) => {
    const id = liveDatabase(req.params.id);
    if (!id) return reply.code(404).send({ error: 'Database not found' });
    return db.select(fields).from(automations).where(eq(automations.databaseId, id)).orderBy(asc(automations.orderKey)).all();
  });

  app.post<{ Params: { id: string } }>('/api/databases/:id/automations', async (req, reply) => {
    const input = AutomationCreate.parse(req.body ?? {});
    const id = liveDatabase(req.params.id);
    if (!id) return reply.code(404).send({ error: 'Database not found' });
    const autoId = randomUUID();
    const done = write(reply, (tx) => {
      check(id, input);
      const now = Date.now();
      const orderKey = placeKey(tx, automations, eq(automations.databaseId, id), {});
      tx.insert(automations).values({ id: autoId, databaseId: id, ...input, orderKey, nextRunAt: dueAt(input, now), createdAt: now }).run();
      return true;
    });
    if (!done) return reply;
    return reply.code(201).send(one(autoId));
  });

  app.patch<{ Params: { id: string; autoId: string } }>('/api/databases/:id/automations/:autoId', async (req, reply) => {
    const input = AutomationUpdate.parse(req.body ?? {});
    const id = liveDatabase(req.params.id);
    const old = id && db.select().from(automations).where(and(eq(automations.id, req.params.autoId), eq(automations.databaseId, id))).get();
    if (!id || !old) return reply.code(404).send({ error: 'Automation not found' });
    const done = write(reply, (tx) => {
      check(id, input);
      const next = { ...old, ...input };
      // A changed schedule (or switching on/off) is due anew from now.
      tx.update(automations).set({ ...input, nextRunAt: dueAt(next, Date.now()) }).where(eq(automations.id, old.id)).run();
      return true;
    });
    if (!done) return reply;
    return one(old.id);
  });

  app.delete<{ Params: { id: string; autoId: string } }>('/api/databases/:id/automations/:autoId', async (req, reply) => {
    const id = liveDatabase(req.params.id);
    if (!id) return reply.code(404).send({ error: 'Database not found' });
    const row = db.delete(automations).where(and(eq(automations.id, req.params.autoId), eq(automations.databaseId, id))).returning({ id: automations.id }).get();
    if (!row) return reply.code(404).send({ error: 'Automation not found' });
    return reply.code(204).send();
  });

  /** "Run now": a schedule runs as if it were due (its next time stays). */
  app.post<{ Params: { id: string; autoId: string } }>('/api/databases/:id/automations/:autoId/run', async (req, reply) => {
    const id = liveDatabase(req.params.id);
    const auto = id && db.select().from(automations).where(and(eq(automations.id, req.params.autoId), eq(automations.databaseId, id))).get();
    if (!id || !auto) return reply.code(404).send({ error: 'Automation not found' });
    const result = write(reply, (tx) => runSchedule(tx, auto, Date.now()));
    if (!result) return reply;
    return { ...result, automation: one(auto.id) };
  });
}
