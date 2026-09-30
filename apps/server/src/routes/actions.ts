import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { ActionRun, Actions, ActionUndo, InvalidValue } from '@papier/core';
import { rowDatabaseId, runActions, undoRun, type RunContext, type RunResult } from '../db/actions.ts';
import type { Db } from '../db/index.ts';
import { liveLineage } from '../db/lineage.ts';
import type { Tx } from '../db/props.ts';
import { blocks, dbProperties } from '../db/schema.ts';
import { rowById } from './databases.ts';

/**
 * Buttons: a button property runs its actions on its row, a button block runs
 * row-less (it can add rows). Each run returns what it changed and an undo
 * snapshot for the client's "Undo" toast.
 */
export function actionRoutes(app: FastifyInstance, db: Db) {
  /** Run in one transaction; an action that can't run is a 400 and nothing changes. */
  const run = (reply: FastifyReply, fn: (tx: Tx) => RunResult) => {
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

  /** What the client needs to show the result and undo it. */
  const response = (result: RunResult) => ({
    changes: result.changes,
    created: result.created,
    undo: { rows: [...result.before].map(([id, props]) => ({ id, props })), created: result.created.map((c) => c.id) },
  });

  app.post<{ Params: { id: string; propId: string } }>('/api/pages/:id/buttons/:propId', async (req, reply) => {
    const { today } = ActionRun.parse(req.body ?? {});
    const rowId = req.params.id;
    const databaseId = rowDatabaseId(db, rowId);
    if (!databaseId || !liveLineage(db, rowId)) return reply.code(404).send({ error: 'Row not found' });
    const prop = db
      .select({ type: dbProperties.type, config: dbProperties.config })
      .from(dbProperties)
      .where(and(eq(dbProperties.id, req.params.propId), eq(dbProperties.databaseId, databaseId)))
      .get();
    if (prop?.type !== 'button') return reply.code(404).send({ error: 'Button not found' });
    const actions = Actions.parse(prop.config.actions ?? []);
    const ctx: RunContext = { rowId, today, source: 'user' };
    const result = run(reply, (tx) => runActions(tx, ctx, actions));
    if (!result) return reply;
    return { row: rowById(db, rowId), ...response(result) };
  });

  app.post<{ Params: { id: string } }>('/api/blocks/:id/run', async (req, reply) => {
    const { today } = ActionRun.parse(req.body ?? {});
    const block = db.select({ pageId: blocks.pageId, type: blocks.type, props: blocks.props }).from(blocks).where(eq(blocks.id, req.params.id)).get();
    if (block?.type !== 'button' || !liveLineage(db, block.pageId)) return reply.code(404).send({ error: 'Button not found' });
    const actions = Actions.safeParse(block.props.actions ?? []);
    if (!actions.success) return reply.code(400).send({ error: 'This button’s actions are invalid' });
    const result = run(reply, (tx) => runActions(tx, { rowId: null, today, source: 'user' }, actions.data));
    if (!result) return reply;
    return response(result);
  });

  app.post('/api/actions/undo', async (req, reply) => {
    const input = ActionUndo.parse(req.body ?? {});
    try {
      db.transaction((tx) => undoRun(tx, input));
    } catch (err) {
      if (err instanceof InvalidValue) return reply.code(400).send({ error: err.message });
      throw err;
    }
    return reply.code(204).send();
  });
}
