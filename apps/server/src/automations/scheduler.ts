import type { FastifyBaseLogger } from 'fastify';
import { tick } from '../db/automations.ts';
import { purgeExpired } from '../db/trash.ts';
import { purgeExpiredSessions } from '../auth/sessions.ts';
import type { Db } from '../db/index.ts';

/** How often the scheduler looks for due schedules. Schedules are minute-precise at best. */
export const TICK_MS = 30_000;
/** How often the trash is emptied of pages past their retention. */
export const PURGE_MS = 3_600_000;

/**
 * Runs due scheduled automations every TICK_MS (and once right away, which also
 * catches up after downtime), and empties expired trash (and drops expired sessions) hourly. Only the real server starts it — see
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
  const purge = () => {
    try {
      const purged = purgeExpired(db);
      if (purged) log.info({ pages: purged }, 'Emptied expired pages from the trash');
      purgeExpiredSessions(db);
    } catch (err) {
      log.error({ err }, 'Trash purge failed');
    }
  };
  run();
  purge();
  const timers = [setInterval(run, TICK_MS), setInterval(purge, PURGE_MS)];
  for (const t of timers) t.unref();
  return () => timers.forEach(clearInterval);
}
