import { useEffect, useRef, useState } from 'react';
import { TextSelection } from '@tiptap/pm/state';
import { blockAt, deleteBlock, duplicateBlock, posOfIndex, setBlockType, withDescendants } from './blockOps.js';
import { applyDrop, planDrop } from './dropPlan.js';
import { BLOCK_TYPES } from './menuItems.js';
import { INDENT_REM } from './schema.js';

/** @typedef {import('@tiptap/core').Editor} Editor */
/** @typedef {import('@tiptap/pm/view').EditorView} EditorView */
/** @typedef {{ index: number, top: number, left: number }} Hover */
/** @typedef {{ index: number, end: number }} Drag */
/** @typedef {import('./dropPlan.js').DropPlan & { top: number, left: number, width: number }} Drop */

/** What a dragged block turns into, for the drop line's label. */
const TYPE_LABEL = /** @type {Record<string, string>} */ ({ bulletItem: '• List item', numberedItem: '1. List item', todo: '☐ To-do' });

const HANDLE_W = 48; // + and ⋮⋮, 24px each

/**
 * The `+` / drag handle beside the hovered block, drawn inside the editor's own
 * left gutter (so nothing can clip it), plus the block menu the handle opens.
 * Dragging moves the block together with its children: the pointer's height
 * picks the gap, its horizontal position picks the nesting level, and a drop
 * line shows both (plus a label when the block will join a list's type).
 * @param {{ editor: Editor, container: HTMLElement | null }} props
 */
export function SideMenu({ editor, container }) {
  const [hover, setHover] = useState(/** @type {Hover | null} */ (null));
  const [menu, setMenu] = useState(/** @type {Hover | null} */ (null));
  const [drop, setDrop] = useState(/** @type {Drop | null} */ (null));
  const [dragging, setDragging] = useState(false);
  const drag = useRef(/** @type {Drag | null} */ (null));

  /** End of a block drag, however it ended (drop, cancel, Esc). */
  function finishDrag() {
    drag.current = null;
    setDrop(null);
    setDragging(false);
    setHover(null);
    container?.classList.remove('papier-block-drag');
  }

  // Track the block under the pointer.
  useEffect(() => {
    if (!container) return;
    const view = editor.view;

    /** @param {MouseEvent} e */
    const onMove = (e) => {
      // No buttons down but a drag still recorded: it was cancelled somewhere
      // we didn't hear about (e.g. Esc outside the window). Recover.
      if (drag.current && e.buttons === 0) finishDrag();
      if (menu || drag.current) return;
      const found = locate(view, container, e.clientX, e.clientY);
      setHover((h) => (found && h && found.index === h.index && found.top === h.top ? h : found));
    };
    const onLeave = () => !menu && !drag.current && setHover(null);
    const onKey = () => !menu && setHover(null); // typing hides the handle, like Notion

    container.addEventListener('mousemove', onMove);
    container.addEventListener('mouseleave', onLeave);
    view.dom.addEventListener('keydown', onKey);
    return () => {
      container.removeEventListener('mousemove', onMove);
      container.removeEventListener('mouseleave', onLeave);
      view.dom.removeEventListener('keydown', onKey);
    };
  }, [editor, container, menu]);

  // Our block drags, handled on the container (gutter included) before
  // ProseMirror sees them: track the target while dragging, apply it on drop.
  useEffect(() => {
    if (!container) return;
    const view = editor.view;

    /** @param {DragEvent} e */
    const onOver = (e) => {
      const d = drag.current;
      if (!d) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      const next = locateDrop(view, container, d, e.clientX, e.clientY);
      setDrop((cur) =>
        next && cur && next.gap === cur.gap && next.level === cur.level && next.convertTo === cur.convertTo ? cur : next,
      );
    };
    /** @param {DragEvent} e */
    const onLeave = (e) => {
      if (drag.current && !container.contains(/** @type {Node | null} */ (e.relatedTarget))) setDrop(null);
    };
    /** @param {DragEvent} e */
    const onDrop = (e) => {
      const d = drag.current;
      if (!d) return; // not ours (text, files): ProseMirror handles it
      e.preventDefault();
      e.stopPropagation();
      const plan = locateDrop(view, container, d, e.clientX, e.clientY);
      const tr = plan && applyDrop(view.state, d, plan);
      if (tr) view.dispatch(tr.scrollIntoView());
      view.focus();
      finishDrag();
    };

    container.addEventListener('dragover', onOver);
    container.addEventListener('dragleave', onLeave);
    container.addEventListener('drop', onDrop, true); // capture: before ProseMirror's own drop handler
    return () => {
      container.removeEventListener('dragover', onOver);
      container.removeEventListener('dragleave', onLeave);
      container.removeEventListener('drop', onDrop, true);
    };
  }, [editor, container]);

  if (!hover && !menu && !drop) return null;
  const at = menu ?? hover;

  /** New empty block under this one (after its children), with the `/` menu open. */
  const add = () => {
    if (!at) return;
    const { state, view } = editor;
    const end = withDescendants(state.doc, at.index, at.index);
    const node = state.doc.child(at.index);
    const pos = posOfIndex(state.doc, end + 1);
    const tr = state.tr.insert(pos, state.schema.nodes.paragraph.create({ indent: node.attrs.indent }));
    tr.setSelection(TextSelection.create(tr.doc, pos + 1)).insertText('/');
    view.dispatch(tr.scrollIntoView());
    view.focus();
    setHover(null);
  };

  /** @param {import('react').DragEvent} e */
  const onDragStart = (e) => {
    if (!at) return;
    const { state, view } = editor;
    const end = withDescendants(state.doc, at.index, at.index);
    drag.current = { index: at.index, end };
    container?.classList.add('papier-block-drag'); // hides ProseMirror's drop cursor
    e.dataTransfer.effectAllowed = 'move';
    const from = posOfIndex(state.doc, at.index);
    e.dataTransfer.setData('text/plain', state.doc.textBetween(from, posOfIndex(state.doc, end + 1), '\n'));
    const dom = view.nodeDOM(from);
    if (dom instanceof HTMLElement) e.dataTransfer.setDragImage(dom, 0, 0);
    // Hide the handle, but keep it mounted: it's the drag source, and removing
    // it from the page cancels the drag (and its dragend never fires).
    setDragging(true);
  };

  return (
    <>
      {drop && <DropLine drop={drop} />}
      {at && (
      <div
        className={`absolute z-20 flex items-center text-faint ${dragging ? 'opacity-0' : ''}`}
        style={{ top: at.top, left: at.left, width: HANDLE_W }}
      >
        <button
          type="button"
          aria-label="Add a block below"
          title="Add a block below"
          onMouseDown={(e) => e.preventDefault()} // keep editor focus
          onClick={add}
          className="flex h-6 w-6 items-center justify-center rounded hover:bg-hover hover:text-fg"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        {/* A div, not a button: Firefox won't start a drag from a <button>, and
            mousedown must not be prevented here or no drag starts at all. */}
        <div
          role="button"
          tabIndex={0}
          draggable
          aria-label="Drag to move, click for options"
          title="Drag to move · click for options"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setMenu(menu ? null : at);
            }
          }}
          onDragStart={onDragStart}
          onDragEnd={finishDrag}
          onClick={() => setMenu(menu ? null : at)}
          className="flex h-6 w-6 cursor-grab items-center justify-center rounded hover:bg-hover hover:text-fg active:cursor-grabbing"
        >
          <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true" fill="currentColor">
            {[2, 7, 12].map((y) => (
              <g key={y}>
                <circle cx="2.5" cy={y} r="1.3" />
                <circle cx="7.5" cy={y} r="1.3" />
              </g>
            ))}
          </svg>
        </div>
      </div>
      )}
      {menu && <BlockMenu editor={editor} at={menu} onClose={() => (setMenu(null), setHover(null))} />}
    </>
  );
}

/**
 * Block under a pointer, and where its handle goes (container coordinates).
 * @param {EditorView} view @param {HTMLElement} container @param {number} x @param {number} y
 * @returns {Hover | null}
 */
function locate(view, container, x, y) {
  const rect = view.dom.getBoundingClientRect();
  if (y < rect.top || y > rect.bottom) return null;
  const hit = view.posAtCoords({ left: Math.min(Math.max(x, rect.left + 1), rect.right - 1), top: y });
  if (!hit) return null;
  const block = blockAt(view.state.doc, hit.inside >= 0 ? hit.inside : hit.pos);
  if (!block) return null;
  const dom = view.nodeDOM(block.pos);
  if (!(dom instanceof HTMLElement)) return null;

  const box = dom.getBoundingClientRect();
  const outer = container.getBoundingClientRect();
  // Centre the 24px handle on the block's first line.
  const inner = /** @type {HTMLElement} */ (dom.querySelector('.pb-c') ?? dom);
  const lineHeight = parseFloat(getComputedStyle(inner).lineHeight) || 24;
  const firstLine = block.node.type.name === 'divider' ? box.height : Math.min(lineHeight, box.height);
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return {
    index: block.index,
    top: Math.round(box.top - outer.top + (inner.offsetTop || 0) + (firstLine - 24) / 2),
    left: Math.round(box.left - outer.left + block.node.attrs.indent * INDENT_REM * rem - HANDLE_W - 4),
  };
}

/**
 * Drop target under the pointer: the gap from its height (above/below the
 * middle of the block it's over), the level from its x relative to the text
 * column, plus where to draw the line (container coordinates).
 * @param {EditorView} view @param {HTMLElement} container @param {Drag} d @param {number} x @param {number} y
 * @returns {Drop | null}
 */
function locateDrop(view, container, d, x, y) {
  const doc = view.state.doc;
  const rect = view.dom.getBoundingClientRect();
  const hit = view.posAtCoords({
    left: Math.min(Math.max(x, rect.left + 1), rect.right - 1),
    top: Math.min(Math.max(y, rect.top + 1), rect.bottom - 1),
  });
  if (!hit) return null;
  const target = blockAt(doc, hit.inside >= 0 ? hit.inside : hit.pos);
  if (!target) return null;
  const dom = view.nodeDOM(target.pos);
  const box = dom instanceof HTMLElement ? dom.getBoundingClientRect() : null;
  const gap = box && y > box.top + box.height / 2 ? target.index + 1 : target.index;

  const step = INDENT_REM * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
  // A third of a step into a level selects it; the gutter means "as shallow as allowed".
  const plan = planDrop(doc, d, gap, Math.floor((x - rect.left) / step + 0.35));

  // Line at the top of the block that will follow, or under the last block.
  const followIndex = plan.inPlace ? d.index : plan.gap;
  const outer = container.getBoundingClientRect();
  let top = rect.bottom;
  if (followIndex < doc.childCount) {
    const el = view.nodeDOM(posOfIndex(doc, followIndex));
    if (el instanceof HTMLElement) top = el.getBoundingClientRect().top;
  }
  const left = rect.left - outer.left + plan.level * step;
  return { ...plan, top: Math.round(top - outer.top - 1), left: Math.round(left), width: Math.round(rect.right - outer.left - left) };
}

/** @param {{ drop: Drop }} props */
function DropLine({ drop }) {
  return (
    <div className="pointer-events-none absolute z-20" style={{ top: drop.top, left: drop.left, width: drop.width }} aria-hidden="true">
      <div className="h-[3px] -translate-y-1/2 rounded-full bg-accent/80" />
      <div className="absolute top-0 -left-1 size-2 -translate-y-1/2 rounded-full bg-accent" />
      {drop.convertTo && (
        <span className="papier-popover absolute top-1.5 left-0 px-1.5 py-0.5 text-[11px] text-muted">
          {TYPE_LABEL[drop.convertTo] ?? drop.convertTo}
        </span>
      )}
    </div>
  );
}

/**
 * Handle menu: turn into, duplicate, delete.
 * @param {{ editor: Editor, at: Hover, onClose: () => void }} props
 */
function BlockMenu({ editor, at, onClose }) {
  const ref = useRef(/** @type {HTMLDivElement | null} */ (null));

  useEffect(() => {
    /** @param {MouseEvent} e */
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(/** @type {Node} */ (e.target))) onClose();
    };
    /** @param {KeyboardEvent} e */
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const node = editor.state.doc.maybeChild(at.index);
  if (!node) return null;

  /** @param {import('@tiptap/pm/state').Transaction} tr */
  const apply = (tr) => {
    editor.view.dispatch(tr.scrollIntoView());
    editor.view.focus();
    onClose();
  };

  return (
    <div
      ref={ref}
      role="menu"
      className="papier-popover absolute z-30 w-[220px] p-1"
      style={{ top: at.top + 28, left: at.left + 24 }}
    >
      {/* A page block stays one: turning it into text would trash its sub-page. */}
      {node.type.name !== 'pageBlock' && (
        <div className="px-2 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-faint uppercase">Turn into</div>
      )}
      {node.type.name !== 'pageBlock' && BLOCK_TYPES.map((t) => {
        const current = node.type.name === t.type && (t.type !== 'heading' || node.attrs.level === t.attrs?.level);
        return (
          <button
            key={t.title}
            type="button"
            role="menuitem"
            onClick={() => {
              const tr = editor.state.tr;
              setBlockType(tr, posOfIndex(editor.state.doc, at.index), /** @type {any} */ (editor.schema.nodes[t.type]), t.attrs);
              apply(tr);
            }}
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-1 text-left text-[13px] text-fg hover:bg-hover"
          >
            <span className="w-5 text-center text-[12px] text-muted">{t.icon}</span>
            <span className="flex-1">{t.title}</span>
            {current && <span className="text-accent">✓</span>}
          </button>
        );
      })}
      {node.type.name !== 'pageBlock' && <div className="my-1 h-px bg-line" />}
      <button
        type="button"
        role="menuitem"
        onClick={() => apply(duplicateBlock(editor.state, at.index))}
        className="flex w-full rounded-md px-2 py-1 text-left text-[13px] text-fg hover:bg-hover"
      >
        Duplicate
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => apply(deleteBlock(editor.state, at.index))}
        className="flex w-full rounded-md px-2 py-1 text-left text-[13px] text-fg hover:bg-hover"
      >
        Delete
      </button>
    </div>
  );
}
