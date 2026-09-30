import type { FastifyBaseLogger } from 'fastify';
import { tick } from '../db/automations.ts';
import type { Db } from '../db/index.ts';

/** How often the scheduler looks for due schedules. Schedules are minute-precise at best. */
export const TICK_MS = 30_000;

/**
 * Runs due scheduled automations every TICK_MS (and once right away, which also
 * catches up after downtime). Only the real server starts it — see
 * `buildApp({ scheduler: true })` — so tests and the importer never do.
 * Returns a stop function.
 */
export function startScheduler(db: Db, log: FastifyBaseLogger) {
  const run = () => {
    try {
      const ran = tick(db);
      if (ran) log.info({ automations: ran }, 'Ran scheduled automations');
    } catch (err) {
      log.error({ err }, 'Scheduler tick failed');
    }
  };
  run();
  const timer = setInterval(run, TICK_MS);
  timer.unref();
  return () => clearInterval(timer);
}
