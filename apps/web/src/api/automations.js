import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

/**
 * A database's automations (see apps/server/src/db/automations.ts).
 * @typedef {import('@papier/core').Trigger} Trigger
 * @typedef {{ id: string, name: string, enabled: boolean, trigger: Trigger, actions: import('@papier/core/actions').Action[], tz: string,
 *   order: string, nextRunAt: number | null, lastRunAt: number | null, lastError: string | null }} Automation
 */

export const automationKeys = { list: (/** @type {string} */ dbId) => ['db', dbId, 'automations'] };

/** The viewer's time zone: automations run on its days and hours. */
export const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** @param {string} dbId */
export function useAutomations(dbId) {
  return useQuery({
    queryKey: automationKeys.list(dbId),
    queryFn: () => /** @type {Promise<Automation[]>} */ (api(`/databases/${dbId}/automations`)),
  });
}

/** @param {string} dbId */
export function useAutomationMutations(dbId) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: automationKeys.list(dbId) });
  /** @param {(list: Automation[]) => Automation[]} fn */
  const patchList = (fn) => qc.setQueryData(automationKeys.list(dbId), (/** @type {Automation[] | undefined} */ l) => l && fn(l));

  return {
    /** @param {{ name?: string, trigger: Trigger, actions?: Automation['actions'] }} body */
    create: async (body) => {
      const a = /** @type {Automation} */ (await api(`/databases/${dbId}/automations`, { method: 'POST', body: { tz: localTimeZone(), ...body } }));
      patchList((l) => [...l, a]);
      return a;
    },
    /** Optimistic. @param {string} id @param {Partial<Pick<Automation, 'name' | 'enabled' | 'trigger' | 'actions'>>} patch */
    update: async (id, patch) => {
      patchList((l) => l.map((a) => (a.id === id ? { ...a, ...patch } : a)));
      try {
        const a = /** @type {Automation} */ (await api(`/databases/${dbId}/automations/${id}`, { method: 'PATCH', body: { ...patch, tz: localTimeZone() } }));
        patchList((l) => l.map((x) => (x.id === id ? a : x)));
      } catch (err) {
        refresh();
        throw err;
      }
    },
    /** @param {string} id */
    remove: async (id) => {
      patchList((l) => l.filter((a) => a.id !== id));
      await api(`/databases/${dbId}/automations/${id}`, { method: 'DELETE' });
    },
    /** Run a schedule now. @param {string} id */
    runNow: async (id) => {
      const res = /** @type {{ runs: number, failed: number, automation: Automation }} */ (await api(`/databases/${dbId}/automations/${id}/run`, { method: 'POST' }));
      patchList((l) => l.map((a) => (a.id === id ? res.automation : a)));
      // It changed rows (maybe in other databases too).
      qc.invalidateQueries({ queryKey: ['db'] });
      return res;
    },
  };
}
