import { describe, expect, it } from 'vitest';
import { docToRows, inlineFromPM, inlineToPM, rowsToDoc } from './convert.js';

/** @typedef {import('@papier/core').Block} Block */

const text = (/** @type {string} */ t, styles = {}) => [{ type: 'text', text: t, styles }];

/** @type {Block[]} */
const rows = [
  { id: 'b', type: 'todo', parentId: null, order: 'a1', props: { checked: true }, content: text('second') },
  { id: 'a', type: 'heading', parentId: null, order: 'a0', props: { level: 2 }, content: text('first', { bold: true }) },
  { id: 'c', type: 'code', parentId: 'a', order: 'a0', props: { language: 'js' }, content: text('x()\ny()') },
  { id: 'e', type: 'paragraph', parentId: 'c', order: 'a0', props: {}, content: text('deep') },
  { id: 'd', type: 'divider', parentId: null, order: 'a2', props: {}, content: [] },
];
const byId = (/** @type {Block[]} */ list) => new Map(list.map((r) => [r.id, r]));

describe('rowsToDoc', () => {
  it('flattens the tree depth-first with indents', () => {
    const doc = rowsToDoc(rows);
    expect(doc.content?.map((n) => [n.attrs?.id, n.type, n.attrs?.indent])).toEqual([
      ['a', 'heading', 0],
      ['c', 'codeBlock', 1],
      ['e', 'paragraph', 2],
      ['b', 'todo', 0],
      ['d', 'divider', 0],
    ]);
    expect(doc.content?.[1]?.content).toEqual([{ type: 'text', text: 'x()\ny()' }]);
  });

  it('starts an empty page with one paragraph', () => {
    expect(rowsToDoc([]).content).toEqual([{ type: 'paragraph', attrs: { id: null, indent: 0 } }]);
  });
});

describe('docToRows', () => {
  it('round-trips stored rows unchanged', () => {
    expect(byId(docToRows(rowsToDoc(rows), byId(rows)))).toEqual(byId(rows));
  });

  it('rebuilds parents from indentation', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { id: 'p', indent: 0 } },
        { type: 'bulletItem', attrs: { id: 'x', indent: 1 } },
        { type: 'bulletItem', attrs: { id: 'y', indent: 2 } },
        { type: 'bulletItem', attrs: { id: 'z', indent: 1 } },
        { type: 'paragraph', attrs: { id: 'q', indent: 5 } }, // clamped: child of z
      ],
    };
    const flat = byId(docToRows(doc, new Map()));
    expect(['p', 'x', 'y', 'z', 'q'].map((id) => flat.get(id)?.parentId)).toEqual([null, 'p', 'x', 'p', 'z']);
    const [x, z] = [flat.get('x')?.order, flat.get('z')?.order];
    expect(/** @type {string} */ (x) < /** @type {string} */ (z)).toBe(true);
  });

  it('re-keys only the moved block', () => {
    const doc = rowsToDoc(rows);
    const [a, c, e, b, d] = /** @type {any[]} */ (doc.content);
    const moved = byId(docToRows({ type: 'doc', content: [d, a, c, e, b] }, byId(rows)));
    expect(moved.get('a')?.order).toBe('a0');
    expect(moved.get('b')?.order).toBe('a1');
    expect(/** @type {string} */ (moved.get('d')?.order) < 'a0').toBe(true);
  });

  it('skips blocks the editor has not stamped with an id yet', () => {
    expect(docToRows({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: null, indent: 0 } }] }, new Map())).toEqual([]);
  });
});

describe('inline content', () => {
  it('maps styles to marks and back', () => {
    const stored = [
      { type: 'text', text: 'plain ', styles: {} },
      { type: 'text', text: 'both', styles: { bold: true, italic: true } },
    ];
    const pm = inlineToPM(stored);
    expect(pm[1]).toEqual({ type: 'text', text: 'both', marks: [{ type: 'bold' }, { type: 'italic' }] });
    expect(inlineFromPM(pm)).toEqual(stored);
  });

  it('turns links into link marks and regroups them', () => {
    const stored = [
      { type: 'text', text: 'see ', styles: {} },
      {
        type: 'link',
        href: 'https://x.dev',
        content: [
          { type: 'text', text: 'the ', styles: {} },
          { type: 'text', text: 'docs', styles: { bold: true } },
        ],
      },
    ];
    expect(inlineFromPM(inlineToPM(stored))).toEqual(stored);
  });

  it('keeps date mentions and hard breaks', () => {
    const stored = [
      { type: 'text', text: 'due\nby ', styles: {} },
      { type: 'date', props: { date: '2026-10-05' } },
    ];
    const pm = inlineToPM(stored);
    expect(pm.map((n) => n.type)).toEqual(['text', 'hardBreak', 'text', 'date']);
    expect(inlineFromPM(pm)).toEqual(stored);
  });

  it('keeps inline page links (not in code)', () => {
    const stored = [
      { type: 'text', text: 'see ', styles: {} },
      { type: 'page', props: { pageId: 'p1' } },
    ];
    const pm = inlineToPM(stored);
    expect(pm[1]).toEqual({ type: 'pageMention', attrs: { pageId: 'p1' } });
    expect(inlineFromPM(pm)).toEqual(stored);
    expect(inlineToPM(stored, { code: true }).map((n) => n.type)).toEqual(['text']);
  });

  it('merges adjacent runs with equal styles', () => {
    const pm = [
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
    ];
    expect(inlineFromPM(pm)).toEqual([{ type: 'text', text: 'ab', styles: {} }]);
  });
});

describe('page blocks', () => {
  it('round-trip with their page id and no content', () => {
    /** @type {Block[]} */
    const pageRows = [
      { id: 'p', type: 'paragraph', parentId: null, order: 'a0', props: {}, content: text('intro') },
      { id: 'sub', type: 'page', parentId: null, order: 'a1', props: { pageId: 'child-page' }, content: [] },
    ];
    const doc = rowsToDoc(pageRows);
    expect(doc.content?.[1]).toEqual({ type: 'pageBlock', attrs: { id: 'sub', indent: 0, pageId: 'child-page' } });
    expect(byId(docToRows(doc, byId(pageRows)))).toEqual(byId(pageRows));
  });
});

describe('database blocks', () => {
  it('round-trip with their database and view', () => {
    /** @type {Block[]} */
    const dbRows = [{ id: 'db', type: 'database', parentId: null, order: 'a0', props: { pageId: 'tasks', viewId: 'v1' }, content: [] }];
    const doc = rowsToDoc(dbRows);
    expect(doc.content?.[0]).toEqual({ type: 'databaseBlock', attrs: { id: 'db', indent: 0, pageId: 'tasks', viewId: 'v1' } });
    expect(byId(docToRows(doc, byId(dbRows)))).toEqual(byId(dbRows));
  });
});

describe('button blocks', () => {
  it('round-trip with their label and actions', () => {
    const actions = [{ type: 'add_row', databaseId: 'log', values: { when: '@today' } }];
    /** @type {Block[]} */
    const buttonRows = [{ id: 'btn', type: 'button', parentId: null, order: 'a0', props: { label: 'Log it', actions }, content: [] }];
    const doc = rowsToDoc(buttonRows);
    expect(doc.content?.[0]).toEqual({ type: 'buttonBlock', attrs: { id: 'btn', indent: 0, label: 'Log it', actions } });
    expect(byId(docToRows(doc, byId(buttonRows)))).toEqual(byId(buttonRows));
  });
});
