import { orderBetween } from '@papier/core';
import { api } from '../api/client.js';

/**
 * "Set up Home": a new page made of ordinary blocks — a greeting, Favourites,
 * Recent, upcoming birthdays (a linked view of a birthdays database, if there
 * is one with a date) and a quick-capture button — set as the workspace's Home.
 * Loaded lazily (it pulls in @papier/core, with zod).
 *
 * @typedef {import('../api/databases.js').DatabaseSummary} DatabaseSummary
 * @typedef {import('../api/databases.js').DatabaseSchema} DatabaseSchema
 */

/** A database whose title matches, and its schema. @param {RegExp} pattern @param {string} q */
async function findDatabase(pattern, q) {
  const list = /** @type {DatabaseSummary[]} */ (await api(`/databases?q=${encodeURIComponent(q)}&limit=20`));
  const hit = list.find((d) => pattern.test(d.title));
  return hit ? { db: hit, schema: /** @type {DatabaseSchema} */ (await api(`/databases/${hit.id}`)) } : null;
}

/** @param {string} text @param {1 | 2 | 3} level */
const heading = (text, level = 2) => ({ type: 'heading', props: { level }, content: [{ type: 'text', text }] });

/**
 * The starter's blocks (without ids and order keys).
 * @returns {Promise<{ type: string, props?: Record<string, unknown>, content?: unknown[] }[]>}
 */
async function starterBlocks() {
  const birthdays = await findDatabase(/birthday/i, 'birthday').catch(() => null);
  const born = birthdays?.schema.properties.find((p) => p.type === 'date');
  const capture =
    (await findDatabase(/inbox|note/i, 'note').catch(() => null)) ??
    (await findDatabase(/inbox/i, 'inbox').catch(() => null)) ??
    (await findDatabase(/task|to.?do/i, 'task').catch(() => null));

  return [
    { type: 'widget', props: { kind: 'greeting' } },
    heading('Favourites'),
    { type: 'widget', props: { kind: 'favorites' } },
    heading('Recent'),
    { type: 'widget', props: { kind: 'recent' } },
    heading('Upcoming birthdays'),
    birthdays && born
      ? {
          type: 'linked_database',
          props: {
            databaseId: birthdays.db.id,
            view: {
              type: 'table',
              config: {
                sorts: [{ propId: born.id, dir: 'upcoming' }],
                filters: [{ propId: born.id, op: 'anniversary_within', value: 30 }],
              },
            },
          },
        }
      : { type: 'linked_database', props: {} },
    heading('Quick capture'),
    capture
      ? {
          type: 'button',
          props: {
            label: `New in ${capture.db.title || 'Untitled'}`,
            actions: [{ type: 'add_row', databaseId: capture.db.id, values: {} }],
            open: true,
          },
        }
      : { type: 'button', props: { label: '' } },
  ];
}

/**
 * Makes the Home page and sets it as the workspace's Home. Returns its id.
 * @param {string} workspaceId
 */
export async function setUpHome(workspaceId) {
  const page = /** @type {{ id: string }} */ (await api('/pages', { method: 'POST', body: { title: 'Home', parentId: null } }));
  await api(`/pages/${page.id}`, { method: 'PATCH', body: { icon: '🏠' } });
  /** @type {string | null} */
  let last = null;
  const upserts = (await starterBlocks()).map((b) => {
    last = orderBetween(last, null);
    return { id: crypto.randomUUID(), parentId: null, order: last, props: {}, content: [], ...b };
  });
  await api(`/pages/${page.id}/blocks/batch`, { method: 'POST', body: { upserts, deletes: [] } });
  await api(`/workspaces/${workspaceId}`, { method: 'PATCH', body: { homePageId: page.id } });
  return page.id;
}
