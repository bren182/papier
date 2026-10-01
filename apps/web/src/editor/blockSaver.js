/**
 * Autosave for one page's blocks. Every flush diffs the editor's current rows
 * against what the server has confirmed and sends only changed + removed
 * blocks. One request is in flight at a time; a failed save leaves the
 * confirmed state untouched, so the next flush simply resends. Saves are
 * idempotent upserts, which makes resending (and the keepalive on exit) safe.
 */

/** @typedef {import('@papier/core').Block} Block */
/** @typedef {import('@papier/core').BlockBatch} BlockBatch */

const RETRY_MS = 3000;

/**
 * @param {Map<string, string>} confirmed  id → serialized row
 * @param {Block[]} rows
 * @returns {{ batch: BlockBatch, next: Map<string, string> }}
 */
export function diffBlocks(confirmed, rows) {
  /** @type {Map<string, string>} */
  const next = new Map();
  /** @type {Block[]} */
  const upserts = [];
  for (const row of rows) {
    const json = JSON.stringify(row);
    next.set(row.id, json);
    if (confirmed.get(row.id) !== json) upserts.push(row);
  }
  const deletes = [...confirmed.keys()].filter((id) => !next.has(id));
  return { batch: { upserts, deletes }, next };
}

/**
 * @param {{
 *   initial: Block[],
 *   read: () => Block[],
 *   send: (batch: BlockBatch, opts: { keepalive?: boolean }) => Promise<unknown>,
 *   delay?: number,
 *   onError?: (err: unknown) => void,
 *   retry?: (err: unknown) => boolean,
 *   onPending?: () => void,
 *   onSettled?: () => void,
 * }} opts
 */
export function createBlockSaver({ initial, read, send, delay = 400, onError, retry = () => true, onPending, onSettled }) {
  let confirmed = new Map(initial.map((row) => [row.id, JSON.stringify(row)]));
  /** @type {Promise<void> | null} */
  let inflight = null;
  let dirty = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;

  /** @returns {Promise<void>} */
  const flush = () => {
    clearTimeout(timer);
    if (inflight) {
      dirty = true; // picked up when the current request settles
      return inflight;
    }
    dirty = false;
    const { batch, next } = diffBlocks(confirmed, read());
    if (!batch.upserts.length && !batch.deletes.length) return Promise.resolve();

    onPending?.();
    inflight = send(batch, {})
      .then(
        () => {
          confirmed = next;
        },
        (err) => {
          onError?.(err);
          dirty = false;
          if (retry(err)) timer = setTimeout(flush, RETRY_MS);
        },
      )
      .finally(() => {
        inflight = null;
        onSettled?.();
        if (dirty) flush();
      });
    return inflight;
  };

  return {
    /** Debounced save after an edit. */
    schedule() {
      clearTimeout(timer);
      timer = setTimeout(flush, delay);
    },
    flush,
    /** Best-effort save while the tab is closing: can't wait, so send everything unconfirmed. */
    flushOnExit() {
      clearTimeout(timer);
      const { batch } = diffBlocks(confirmed, read());
      if (batch.upserts.length || batch.deletes.length) send(batch, { keepalive: true }).catch(() => {});
    },
    /** Stop retry timers (after a final flush). */
    dispose() {
      clearTimeout(timer);
    },
  };
}
