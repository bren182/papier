import { describe, expect, it, vi } from 'vitest';
import { createBlockSaver, diffBlocks } from './blockSaver.js';

/** @typedef {import('@papier/core').Block} Block */

const row = (/** @type {string} */ id, /** @type {string} */ t = '') =>
  /** @type {Block} */ ({ id, type: 'paragraph', parentId: null, order: 'a0', props: {}, content: [{ type: 'text', text: t }] });

describe('diffBlocks', () => {
  it('sends changed and removed blocks only', () => {
    const confirmed = new Map([row('a'), row('b')].map((r) => [r.id, JSON.stringify(r)]));
    const { batch } = diffBlocks(confirmed, [row('a'), row('c', 'new')]);
    expect(batch.upserts.map((r) => r.id)).toEqual(['c']);
    expect(batch.deletes).toEqual(['b']);
  });
});

describe('createBlockSaver', () => {
  it('keeps one request in flight and sends later edits after it', async () => {
    let current = [row('a', '1')];
    /** @type {Array<() => void>} */
    const resolvers = [];
    const send = vi.fn(() => new Promise((resolve) => resolvers.push(() => resolve(null))));
    const saver = createBlockSaver({ initial: [row('a')], read: () => current, send });

    const first = saver.flush();
    current = [row('a', '12')];
    saver.flush(); // queued behind the first
    expect(send).toHaveBeenCalledTimes(1);

    resolvers[0]?.();
    await first;
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]).toEqual([{ upserts: [row('a', '12')], deletes: [] }, {}]);
    resolvers[1]?.();
  });

  it('resends after a failure', async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(null);
    const saver = createBlockSaver({ initial: [], read: () => [row('a')], send, onError: () => {} });

    await saver.flush();
    await vi.runOnlyPendingTimersAsync();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0]).toEqual({ upserts: [row('a')], deletes: [] });

    await saver.flush();
    expect(send).toHaveBeenCalledTimes(2); // nothing left to save
    vi.useRealTimers();
  });
});
