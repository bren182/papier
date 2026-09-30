// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { docToRows } from './convert.js';
import { applyDrop, planDrop } from './dropPlan.js';
import { bodyExtensions } from './extensions.js';
import { slashItems } from './menuItems.js';

/** @type {Editor | null} */
let editor = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

/**
 * An editor on a flat doc. Each spec is `type:indent:text` (type defaults to
 * paragraph, indent to 0); the cursor starts at the end of the last block.
 * @param {string[]} specs
 */
function setup(specs = ['']) {
  const content = specs.map((spec, i) => {
    const [type = 'paragraph', indent = '0', ...rest] = spec.includes(':') ? spec.split(':') : ['paragraph', '0', spec];
    const text = rest.join(':');
    return { type, attrs: { id: `b${i}`, indent: Number(indent) }, ...(text ? { content: [{ type: 'text', text }] } : {}) };
  });
  const e = new Editor({ element: document.createElement('div'), extensions: bodyExtensions(), content: { type: 'doc', content } });
  e.commands.focus('end');
  editor = e;
  return e;
}

/** Type characters the way a user does, so input rules fire. @param {Editor} e @param {string} text */
function type(e, text) {
  for (const ch of text) {
    const view = e.view;
    const { from, to } = view.state.selection;
    const handled = view.someProp('handleTextInput', (f) => f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)));
    if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to));
  }
}

/** @param {Editor} e @param {string} key @param {KeyboardEventInit} [init] */
function press(e, key, init = {}) {
  e.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}

/** Put the cursor at `offset` inside block `index`. @param {Editor} e @param {number} index @param {number} offset */
function cursorAt(e, index, offset) {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += e.state.doc.child(i).nodeSize;
  e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, pos + 1 + offset)));
}

/** @param {Editor} e */
const blocks = (e) => {
  /** @type {string[]} */
  const out = [];
  e.state.doc.forEach((n) => out.push(`${n.type.name}:${n.attrs.indent}:${n.textContent}`));
  return out;
};

describe('input rules', () => {
  it('turns "# " into a heading, keeping the block id', () => {
    const e = setup(['']);
    type(e, '# Title');
    expect(blocks(e)).toEqual(['heading:0:Title']);
    expect(e.state.doc.child(0).attrs).toMatchObject({ id: 'b0', level: 1 });
  });

  it('makes lists, to-dos, quotes and code', () => {
    const cases = /** @type {const} */ ([
      ['- x', 'bulletItem'],
      ['1. x', 'numberedItem'],
      ['[] x', 'todo'],
      ['> x', 'quote'],
    ]);
    for (const [input, name] of cases) {
      const e = setup(['']);
      type(e, input);
      expect(blocks(e)).toEqual([`${name}:0:x`]);
      e.destroy();
    }
    const e = setup(['']);
    type(e, '```');
    expect(e.state.doc.child(0).type.name).toBe('codeBlock');
  });

  it('turns "---" into a divider with a fresh line below', () => {
    const e = setup(['']);
    type(e, '---');
    expect(blocks(e)).toEqual(['divider:0:', 'paragraph:0:']);
  });

  it('only fires at the start of a text block', () => {
    const e = setup(['hello']);
    type(e, ' # ');
    expect(blocks(e)).toEqual(['paragraph:0:hello # ']);
  });
});

describe('Enter', () => {
  it('continues a list, then leaves it on an empty item', () => {
    const e = setup(['bulletItem:0:one']);
    press(e, 'Enter');
    type(e, 'two');
    press(e, 'Enter');
    press(e, 'Enter');
    expect(blocks(e)).toEqual(['bulletItem:0:one', 'bulletItem:0:two', 'paragraph:0:']);
  });

  it('gives the new half of a split its own id', () => {
    const e = setup(['hello world']);
    cursorAt(e, 0, 5);
    press(e, 'Enter');
    expect(blocks(e)).toEqual(['paragraph:0:hello', 'paragraph:0: world']);
    const [a, b] = [e.state.doc.child(0).attrs.id, e.state.doc.child(1).attrs.id];
    expect(a).toBe('b0');
    expect(b).toBeTruthy();
    expect(b).not.toBe(a);
  });

  it('at the start of a block opens a line above and the text keeps its id', () => {
    const e = setup(['todo:0:task']);
    cursorAt(e, 0, 0);
    press(e, 'Enter');
    expect(blocks(e)).toEqual(['todo:0:', 'todo:0:task']);
    expect(e.state.doc.child(1).attrs.id).toBe('b0');
  });

  it('outdents an empty indented paragraph', () => {
    const e = setup(['parent', 'paragraph:1:']);
    press(e, 'Enter');
    expect(blocks(e)).toEqual(['paragraph:0:parent', 'paragraph:0:']);
  });

  it('adds lines in code, and leaves on an empty last line', () => {
    const e = setup(['codeBlock:0:x()']);
    press(e, 'Enter');
    type(e, 'y()');
    press(e, 'Enter');
    press(e, 'Enter');
    expect(blocks(e)).toEqual(['codeBlock:0:x()\ny()', 'paragraph:0:']);
  });
});

describe('Tab / Shift-Tab', () => {
  it('nests under the block above, one level at most', () => {
    const e = setup(['a', 'b']);
    press(e, 'Tab');
    press(e, 'Tab'); // can't go two deeper than its parent
    expect(blocks(e)).toEqual(['paragraph:0:a', 'paragraph:1:b']);
  });

  it('does nothing on the first block', () => {
    const e = setup(['a']);
    press(e, 'Tab');
    expect(blocks(e)).toEqual(['paragraph:0:a']);
  });

  it('carries children along', () => {
    const e = setup(['a', 'b', 'paragraph:1:b-child', 'c']);
    cursorAt(e, 1, 0);
    press(e, 'Tab');
    expect(blocks(e)).toEqual(['paragraph:0:a', 'paragraph:1:b', 'paragraph:2:b-child', 'paragraph:0:c']);
    press(e, 'Tab', { shiftKey: true });
    expect(blocks(e)).toEqual(['paragraph:0:a', 'paragraph:0:b', 'paragraph:1:b-child', 'paragraph:0:c']);
  });

  it('saves nesting as parentIds', () => {
    const e = setup(['a', 'b', 'c']);
    cursorAt(e, 1, 0);
    press(e, 'Tab');
    cursorAt(e, 2, 0);
    press(e, 'Tab');
    press(e, 'Tab');
    const rows = docToRows(/** @type {any} */ (e.getJSON()), new Map());
    expect(rows.map((r) => [r.id, r.parentId])).toEqual([
      ['b0', null],
      ['b1', 'b0'],
      ['b2', 'b1'],
    ]);
  });
});

describe('Backspace at the start of a block', () => {
  it('turns a list item into text, then outdents, then merges up', () => {
    const e = setup(['a', 'bulletItem:1:b']);
    cursorAt(e, 1, 0);
    press(e, 'Backspace');
    expect(blocks(e)).toEqual(['paragraph:0:a', 'paragraph:1:b']);
    press(e, 'Backspace');
    expect(blocks(e)).toEqual(['paragraph:0:a', 'paragraph:0:b']);
  });
});

describe('drag and drop', () => {
  /** @param {Editor} e @param {{ index: number, end: number }} drag @param {number} gap @param {number} level */
  const dropAt = (e, drag, gap, level) => {
    const plan = planDrop(e.state.doc, drag, gap, level);
    const tr = applyDrop(e.state, drag, plan);
    if (tr) e.view.dispatch(tr);
    return plan;
  };

  it('picks the level from the pointer, within what the tree allows', () => {
    const e = setup(['a', 'b', 'x']);
    const drag = { index: 2, end: 2 };
    // Between a and b: b follows at level 0, a allows up to 1.
    expect(planDrop(e.state.doc, drag, 1, 0)).toMatchObject({ level: 0, min: 0, max: 1 });
    expect(planDrop(e.state.doc, drag, 1, 5)).toMatchObject({ level: 1 });
    expect(planDrop(e.state.doc, drag, 1, -3)).toMatchObject({ level: 0 });
  });

  it('never drops shallower than the block below (no stealing its siblings)', () => {
    const e = setup(['parent', 'paragraph:1:child', 'x']);
    // Between parent and its first child: only as a child.
    expect(planDrop(e.state.doc, { index: 2, end: 2 }, 1, 0)).toMatchObject({ level: 1, min: 1, max: 1 });
  });

  it('moves a block with its children to the chosen level', () => {
    const e = setup(['a', 'b', 'x', 'paragraph:1:x-child']);
    dropAt(e, { index: 2, end: 3 }, 1, 1);
    expect(blocks(e)).toEqual(['paragraph:0:a', 'paragraph:1:x', 'paragraph:2:x-child', 'paragraph:0:b']);
  });

  it('re-levels in place when dropped on its own spot', () => {
    const e = setup(['bulletItem:0:a', 'bulletItem:0:b']);
    dropAt(e, { index: 1, end: 1 }, 1, 1);
    expect(blocks(e)).toEqual(['bulletItem:0:a', 'bulletItem:1:b']);
  });

  it('turns text into the list it is dropped into', () => {
    const e = setup(['bulletItem:0:apples', 'bulletItem:0:bananas', 'note']);
    const plan = dropAt(e, { index: 2, end: 2 }, 1, 0);
    expect(plan.convertTo).toBe('bulletItem');
    expect(blocks(e)).toEqual(['bulletItem:0:apples', 'bulletItem:0:note', 'bulletItem:0:bananas']);
    expect(e.state.doc.child(1).attrs.id).toBe('b2'); // same block, new type
  });

  it('joins a nested list by its level, and keeps headings as they are', () => {
    const e = setup(['bulletItem:0:a', 'todo:1:sub', 'note', 'heading:0:Title']);
    expect(planDrop(e.state.doc, { index: 2, end: 2 }, 2, 1).convertTo).toBe('todo');
    expect(planDrop(e.state.doc, { index: 2, end: 2 }, 2, 0).convertTo).toBe('bulletItem');
    expect(planDrop(e.state.doc, { index: 3, end: 3 }, 1, 0).convertTo).toBeNull();
  });
});

describe('tree invariants', () => {
  it('clamps indents that skip a level', () => {
    const e = setup(['a', 'paragraph:3:b']);
    type(e, '!'); // any change runs the normalizer
    expect(blocks(e)).toEqual(['paragraph:0:a', 'paragraph:1:b!']);
  });

  it('numbers consecutive numbered items per level', () => {
    const e = setup(['numberedItem:0:a', 'numberedItem:0:b', 'numberedItem:1:b1', 'numberedItem:0:c', 'x', 'numberedItem:0:d']);
    const numbers = [...e.view.dom.querySelectorAll('[data-type="numberedItem"]')].map((el) => el.getAttribute('data-number'));
    expect(numbers).toEqual(['1', '2', '1', '3', '1']);
  });
});

describe('page blocks', () => {
  /** @param {Partial<import('./PageBlock.js').PageBlockOptions>} pages */
  function pageEditor(pages) {
    const content = [
      { type: 'paragraph', attrs: { id: 'b0', indent: 0 }, content: [{ type: 'text', text: 'intro' }] },
      { type: 'pageBlock', attrs: { id: 'b1', indent: 0, pageId: 'child' } },
    ];
    const e = new Editor({ element: document.createElement('div'), extensions: bodyExtensions({ pages }), content: { type: 'doc', content } });
    editor = e;
    return e;
  }

  it('show the live title and open the page on click', () => {
    /** @type {((p: any) => void) | null} */ let push = null;
    /** @type {string[]} */ const opened = [];
    const e = pageEditor({
      watchPage: (_id, onChange) => ((push = onChange), onChange({ title: 'Child', titleContent: null }), () => {}),
      openPage: (id) => opened.push(id),
    });
    const label = () => e.view.dom.querySelector('.pb-page-title')?.textContent;
    expect(label()).toBe('Child');
    /** @type {any} */ (push)({ title: 'Renamed', titleContent: null });
    expect(label()).toBe('Renamed');
    /** @type {any} */ (push)(null);
    expect(label()).toBe('Deleted page');

    e.view.dom.querySelector('.pb-page')?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    expect(opened).toEqual(['child']);
  });

  it('`/page` creates a sub-page in place of the empty line and opens it', async () => {
    /** @type {string[]} */ const opened = [];
    const e = pageEditor({ createPage: async () => 'new-page', openPage: (id) => opened.push(id) });
    // A fresh line at the end holding "/page", as the slash menu sees it.
    const end = e.state.doc.content.size;
    e.view.dispatch(e.state.tr.insert(end, e.schema.nodes.paragraph.create({ indent: 0 }, e.schema.text('/page'))));
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, end + 6)));
    const item = slashItems('page').find((i) => i.title === 'Page');
    await item?.run(e, { from: end + 1, to: end + 6 });
    expect(blocks(e).map((b) => b.split(':')[0])).toEqual(['paragraph', 'pageBlock', 'pageBlock']);
    expect(e.state.doc.child(2).attrs.pageId).toBe('new-page');
    expect(opened).toEqual(['new-page']);
  });
});
