import { describe, expect, it } from 'vitest';
import { fromEditorDoc, toEditorDoc } from './convert.js';

/** @typedef {import('@papier/core').Block} Block */
/** @typedef {import('./convert.js').EditorBlock} EditorBlock */

const text = (/** @type {string} */ t) => [{ type: 'text', text: t, styles: {} }];

/** @type {Block[]} */
const rows = [
  { id: 'b', type: 'todo', parentId: null, order: 'a1', props: { checked: true }, content: text('second') },
  { id: 'a', type: 'heading', parentId: null, order: 'a0', props: { level: 2 }, content: text('first') },
  { id: 'c', type: 'code', parentId: 'a', order: 'a0', props: { language: 'js' }, content: text('x()') },
  { id: 'd', type: 'divider', parentId: null, order: 'a2', props: {}, content: [] },
];
const byId = (/** @type {Block[]} */ list) => new Map(list.map((r) => [r.id, r]));

/** Top-level blocks a, b, d and a's child c. */
function parts() {
  const [a, b, d] = /** @type {[EditorBlock, EditorBlock, EditorBlock]} */ (toEditorDoc(rows));
  const c = /** @type {EditorBlock} */ (a.children?.[0]);
  return { a, b, c, d };
}

describe('toEditorDoc', () => {
  it('nests and orders blocks with BlockNote type names', () => {
    const doc = toEditorDoc(rows);
    expect(doc.map((b) => [b.id, b.type])).toEqual([
      ['a', 'heading'],
      ['b', 'checkListItem'],
      ['d', 'divider'],
    ]);
    expect(doc[0]?.children?.[0]).toMatchObject({ id: 'c', type: 'codeBlock', props: { language: 'js' } });
    expect(doc[2]).not.toHaveProperty('content');
  });
});

describe('fromEditorDoc', () => {
  it('round-trips stored rows unchanged', () => {
    const back = fromEditorDoc(toEditorDoc(rows), byId(rows));
    expect(byId(back)).toEqual(byId(rows));
  });

  it('drops editor-only props like colours', () => {
    const [row] = fromEditorDoc(
      [{ id: 'x', type: 'heading', props: { level: 3, textColor: 'red', textAlignment: 'left' }, content: [], children: [] }],
      new Map(),
    );
    expect(row?.props).toEqual({ level: 3 });
  });

  it('re-keys only the moved block', () => {
    const { a, b, d } = parts();
    const moved = byId(fromEditorDoc([d, a, b], byId(rows)));
    expect(moved.get('a')?.order).toBe('a0');
    expect(moved.get('b')?.order).toBe('a1');
    expect(/** @type {string} */ (moved.get('d')?.order) < 'a0').toBe(true);
  });

  it('gives an un-nested block a fresh key under its new parent', () => {
    const { a, b, c, d } = parts();
    const flat = byId(fromEditorDoc([{ ...a, children: [] }, c, b, d], byId(rows)));
    expect(flat.get('c')).toMatchObject({ parentId: null });
    const keys = ['a', 'c', 'b', 'd'].map((id) => /** @type {string} */ (flat.get(id)?.order));
    expect([...keys].sort()).toEqual(keys);
  });
});
