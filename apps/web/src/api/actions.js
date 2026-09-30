import { useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';
import { pageKeys } from './pages.js';
import { today } from './templates.js';
import { formatDateLong } from '../editor/dates.js';
import { showToast } from '../toast.js';

/**
 * Running buttons (a button property on a row, or a button block in a page),
 * with a toast that says what changed and offers Undo.
 *
 * @typedef {{ rowId: string, propId: string, name: string, type: string, value: unknown, text: string }} Change
 * @typedef {{ changes: Change[], created: { id: string, databaseId: string }[],
 *   undo: { rows: { id: string, props: Record<string, unknown> }[], created: string[] } }} RunResult
 */

/** Everything a run can touch: rows of any database, row pages, children lists. */
function refreshAfterRun(/** @type {import('@tanstack/react-query').QueryClient} */ qc) {
  qc.invalidateQueries({ queryKey: ['db'] });
  qc.invalidateQueries({ queryKey: pageKeys.all });
}

/** Run buttons and report the result in a toast (with Undo when something changed). */
export function useRunButton() {
  const qc = useQueryClient();

  /** @param {string} path */
  const run = async (path) => {
    try {
      const result = /** @type {RunResult} */ (
        await api(path, { method: 'POST', body: { today: today(), tzOffset: new Date().getTimezoneOffset() } })
      );
      refreshAfterRun(qc);
      const touched = result.undo.rows.length + result.undo.created.length > 0;
      showToast({
        text: describeRun(result),
        action: touched
          ? {
              label: 'Undo',
              run: async () => {
                await api('/actions/undo', { method: 'POST', body: result.undo });
                refreshAfterRun(qc);
              },
            }
          : undefined,
      });
      return result;
    } catch (err) {
      showToast({ text: err instanceof Error ? err.message : 'That didn’t work', tone: 'error' });
      return null;
    }
  };

  return {
    /** @param {string} rowId @param {string} propId */
    runProperty: (rowId, propId) => run(`/pages/${rowId}/buttons/${propId}`),
    /** @param {string} blockId */
    runBlock: (blockId) => run(`/blocks/${blockId}/run`),
  };
}

/**
 * Toast text for a run: "Reminder → Dec 11, 2027 · Added a row".
 * @param {RunResult} result
 */
export function describeRun(result) {
  // The last change per property wins (a button can touch one twice).
  const last = new Map(result.changes.map((c) => [c.propId, c]));
  const parts = [...last.values()].map((c) => {
    const text =
      c.type === 'date' && typeof c.value === 'string' ? formatDateLong(c.value)
      : c.type === 'checkbox' ? (c.value ? 'checked' : 'unchecked')
      : c.type === 'relation' ? `${Array.isArray(c.value) ? c.value.length : 0} linked`
      : c.text || 'empty';
    return `${c.name} → ${text}`;
  });
  if (result.created.length) parts.push(result.created.length === 1 ? 'Added a row' : `Added ${result.created.length} rows`);
  return parts.join(' · ') || 'Nothing to change';
}
