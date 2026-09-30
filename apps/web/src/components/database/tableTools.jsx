import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { COMPUTED_TYPES } from '@papier/core/props';
import { api } from '../../api/client.js';
import { useDuplicatePage } from '../../api/templates.js';
import { showToast } from '../../toast.js';
import { ValueCell } from './cells.jsx';
import { useDb } from './context.js';
import { Icon, ICONS, TypeIcon } from './meta.jsx';
import { menuItem, menuLabel, Popover } from './Popover.jsx';
import { TransferDialog } from './TransferDialog.jsx';

/**
 * Spreadsheet-ish tools for the table view: selecting rows (click, Shift for a
 * range, Ctrl/Cmd to add), the bulk bar, filling a value down like Excel,
 * and the row menu (also on right-click) with Copy to… / Move to….
 *
 * @typedef {import('../../api/databases.js').Row} Row
 * @typedef {import('./context.js').Property} Property
 * @typedef {{ propId: string, value: unknown, from: number, to: number }} Fill
 * @typedef {{
 *   selected: Set<string>,
 *   toggle: (id: string, e: { shiftKey: boolean, metaKey: boolean, ctrlKey: boolean }) => void,
 *   fill: Fill | null,
 *   startFill: (e: import('react').PointerEvent, index: number, prop: Property, value: unknown) => void,
 *   openMenu: (row: Row, at: HTMLElement | { x: number, y: number }) => void,
 * }} TableTools
 */

export const TableCtx = createContext(/** @type {TableTools | null} */ (null));

export function useTableTools() {
  const ctx = useContext(TableCtx);
  if (!ctx) throw new Error('useTableTools outside a table');
  return ctx;
}

/** Properties a fill or "Set property" can write (not computed, not buttons or formulas). @param {Property} p */
export const writable = (p) => !COMPUTED_TYPES.has(p.type) && p.type !== 'formula';

/**
 * Row selection in view order. Cleared when the rows' order or filter changes.
 * @param {Row[]} rows @param {unknown} resetKey
 */
export function useSelection(rows, resetKey) {
  const [selected, setSelected] = useState(/** @type {Set<string>} */ (new Set()));
  const anchor = useRef(/** @type {string | null} */ (null));
  const key = JSON.stringify(resetKey);
  useEffect(() => {
    setSelected(new Set());
    anchor.current = null;
  }, [key]);
  // Esc clears (unless a menu or dialog is taking it).
  useEffect(() => {
    if (!selected.size) return;
    /** @param {KeyboardEvent} e */
    const onKey = (e) => {
      if (e.key === 'Escape' && !document.querySelector('[data-popover], [role=dialog]')) setSelected(new Set());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected.size]);

  /** @type {TableTools['toggle']} */
  const toggle = (id, e) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const ids = rows.map((r) => r.id);
      if (e.shiftKey && anchor.current && ids.includes(anchor.current)) {
        const [a, b] = [ids.indexOf(anchor.current), ids.indexOf(id)].sort((x, y) => x - y);
        for (const r of ids.slice(a, b + 1)) next.add(r);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (!e.shiftKey) anchor.current = id;
  };
  return {
    selected,
    toggle,
    /** @param {boolean} on */
    setAll: (on) => setSelected(on ? new Set(rows.map((r) => r.id)) : new Set()),
    clear: () => setSelected(new Set()),
  };
}

/**
 * Excel's fill handle: drag a cell's corner over rows to copy its value
 * into them. One request on release, with Undo.
 * @param {Row[]} rows
 */
export function useFill(rows) {
  const { m } = useDb();
  const [fill, setFill] = useState(/** @type {Fill | null} */ (null));

  /** @type {TableTools['startFill']} */
  const startFill = (e, index, prop, value) => {
    e.preventDefault();
    e.stopPropagation();
    let current = { propId: prop.id, value, from: index, to: index };
    setFill(current);
    /** @param {PointerEvent} ev */
    const move = (ev) => {
      const el = /** @type {HTMLElement | null} */ (document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-row-index]') ?? null);
      const to = el ? Number(el.dataset.rowIndex) : current.to;
      if (to !== current.to) setFill((current = { ...current, to }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setFill(null);
      const [a, b] = [current.from, current.to].sort((x, y) => x - y);
      const targets = rows.slice(a, b + 1).filter((_, i) => a + i !== current.from);
      if (!targets.length) return;
      const before = new Map(targets.map((r) => [r.id, r.props[prop.id] ?? null]));
      m.setMany(
        targets.map((r) => r.id),
        { [prop.id]: current.value ?? null },
      ).then(() =>
        showToast({
          text: `Filled ${prop.name} into ${targets.length} ${targets.length === 1 ? 'row' : 'rows'}`,
          action: { label: 'Undo', run: () => restoreValues(m, prop.id, before).then(() => {}) },
        }),
      );
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return { fill, startFill };
}

/** Put back one property's values on rows, one request per distinct value. */
function restoreValues(/** @type {ReturnType<typeof useDb>['m']} */ m, /** @type {string} */ propId, /** @type {Map<string, unknown>} */ before) {
  const groups = new Map();
  for (const [id, v] of before) {
    const k = JSON.stringify(v);
    groups.set(k, [...(groups.get(k) ?? []), id]);
  }
  return Promise.all([...groups].map(([k, ids]) => m.setMany(ids, { [propId]: JSON.parse(k) })));
}

/** The fill handle in a cell's corner. @param {{ index: number, prop: Property, value: unknown }} props */
export function FillHandle({ index, prop, value }) {
  const { startFill, fill } = useTableTools();
  if (!writable(prop) || fill) return null;
  return (
    <span
      role="presentation"
      title="Drag to fill"
      onPointerDown={(e) => startFill(e, index, prop, value)}
      className="absolute right-0 bottom-0 z-10 size-2 translate-x-1/2 translate-y-1/2 cursor-crosshair rounded-[2px] border border-root bg-accent opacity-0 group-hover/cell:opacity-100"
    />
  );
}

/** Trash rows with an Undo toast. */
function useDeleteRows() {
  const { m } = useDb();
  /** @param {string[]} ids */
  return async (ids) => {
    const gone = await m.deleteRows(ids);
    showToast({
      text: `Deleted ${gone.length} ${gone.length === 1 ? 'row' : 'rows'}`,
      action: {
        label: 'Undo',
        run: async () => {
          for (const id of gone) await api(`/pages/${id}/restore`, { method: 'POST' });
          m.refresh();
        },
      },
    });
  };
}

/** Duplicate rows next to themselves. */
function useDuplicateRows() {
  const { m } = useDb();
  const duplicate = useDuplicatePage();
  /** @param {string[]} ids */
  return async (ids) => {
    for (const id of ids) await duplicate.mutateAsync({ id });
    m.refresh();
  };
}

/**
 * The row menu: from the ⋯ handle or a right-click. With several rows
 * selected (and the clicked one among them) it acts on all of them.
 * @param {{ ids: string[], anchor: HTMLElement | { x: number, y: number }, onClose: () => void, onOpen: (id: string) => void,
 *   onTransfer: (mode: 'move' | 'copy', ids: string[]) => void, onDone?: () => void }} props
 */
export function RowMenu({ ids, anchor, onClose, onOpen, onTransfer, onDone }) {
  const del = useDeleteRows();
  const dup = useDuplicateRows();
  const many = ids.length > 1;
  /** @param {() => void} fn */
  const pick = (fn) => () => {
    onClose();
    fn();
  };
  return (
    <AnchoredPopover anchor={anchor} onClose={onClose} width={200}>
      {many && <div className={menuLabel}>{ids.length} rows</div>}
      {!many && (
        <button type="button" className={menuItem} onClick={pick(() => onOpen(ids[0] ?? ''))}>
          <Icon path={ICONS.open} /> Open
        </button>
      )}
      <button type="button" className={menuItem} onClick={pick(() => dup(ids))}>
        <Icon path={ICONS.plus} /> Duplicate
      </button>
      <button type="button" className={menuItem} onClick={pick(() => onTransfer('copy', ids))}>
        <Icon path={ICONS.copy} /> Copy to…
      </button>
      <button type="button" className={menuItem} onClick={pick(() => onTransfer('move', ids))}>
        <Icon path={ICONS.move} /> Move to…
      </button>
      <div className="my-1 h-px bg-line" />
      <button type="button" className={menuItem} onClick={pick(() => del(ids).then(() => onDone?.()))}>
        <Icon path={ICONS.trash} /> Delete
      </button>
    </AnchoredPopover>
  );
}

/**
 * A Popover at an element, or at a point (a right-click): the point gets a
 * zero-size fixed anchor.
 * @param {{ anchor: HTMLElement | { x: number, y: number }, onClose: () => void, width: number, children: import('react').ReactNode }} props
 */
function AnchoredPopover({ anchor, onClose, width, children }) {
  const [el, setEl] = useState(/** @type {HTMLElement | null} */ (anchor instanceof HTMLElement ? anchor : null));
  const point = anchor instanceof HTMLElement ? null : anchor;
  return (
    <>
      {point && <span ref={setEl} aria-hidden="true" style={{ position: 'fixed', left: point.x, top: point.y, width: 0, height: 0 }} />}
      {el && (
        <Popover anchor={el} onClose={onClose} width={width} align={point ? 'start' : 'end'}>
          {children}
        </Popover>
      )}
    </>
  );
}

/**
 * Shown while rows are selected: act on all of them.
 * @param {{ ids: string[], onClear: () => void, onTransfer: (mode: 'move' | 'copy', ids: string[]) => void }} props
 */
export function BulkBar({ ids, onClear, onTransfer }) {
  const { properties, m, addOption } = useDb();
  const del = useDeleteRows();
  const dup = useDuplicateRows();
  const [setting, setSetting] = useState(/** @type {HTMLElement | null} */ (null));
  const [prop, setProp] = useState(/** @type {Property | null} */ (null));
  const action = 'flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-fg hover:bg-hover';

  return (
    <div className="papier-popover sticky top-2 z-20 mb-2 flex w-fit flex-wrap items-center gap-0.5 px-1.5 py-1" role="toolbar" aria-label="Selected rows">
      <span className="px-2 text-[13px] text-muted">{ids.length} selected</span>
      <button type="button" className={action} onClick={(e) => setSetting(e.currentTarget)}>
        Set property…
      </button>
      <button type="button" className={action} onClick={() => onTransfer('move', ids)}>
        Move to…
      </button>
      <button type="button" className={action} onClick={() => onTransfer('copy', ids)}>
        Copy to…
      </button>
      <button type="button" className={action} onClick={() => dup(ids).then(onClear)}>
        Duplicate
      </button>
      <button type="button" className={action} onClick={() => del(ids).then(onClear)}>
        Delete
      </button>
      <button type="button" aria-label="Clear selection" className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg" onClick={onClear}>
        <Icon path={ICONS.x} size={12} />
      </button>
      {setting && (
        <Popover
          anchor={setting}
          onClose={() => {
            setSetting(null);
            setProp(null);
          }}
          width={260}
        >
          {!prop ? (
            <>
              <div className={menuLabel}>Set for {ids.length} rows</div>
              {properties.filter(writable).map((p) => (
                <button key={p.id} type="button" className={menuItem} onClick={() => setProp(p)}>
                  <TypeIcon type={p.type} /> {p.name}
                </button>
              ))}
            </>
          ) : (
            <div className="flex flex-col gap-1 p-1">
              <div className={`${menuLabel} -mx-1`}>{prop.name}</div>
              <ValueCell
                prop={prop}
                value={undefined}
                row={{ createdAt: 0, updatedAt: 0 }}
                placeholder="Pick a value…"
                wrap
                onChange={(v) => {
                  m.setMany(ids, { [prop.id]: v });
                  showToast({ text: `Set ${prop.name} on ${ids.length} rows` });
                  setSetting(null);
                  setProp(null);
                }}
                onAddOption={addOption}
                className="min-h-8 rounded-md border border-line px-2 py-1 text-[13px]"
              />
            </div>
          )}
        </Popover>
      )}
    </div>
  );
}

/** Move/copy dialog state, shared by the row menu and the bulk bar. */
export function useTransfer() {
  const [transfer, setTransfer] = useState(/** @type {{ mode: 'move' | 'copy', ids: string[] } | null} */ (null));
  return {
    open: (/** @type {'move' | 'copy'} */ mode, /** @type {string[]} */ ids) => setTransfer({ mode, ids }),
    /** @param {{ sourceId: string, onDone?: () => void }} props */
    dialog: ({ sourceId, onDone }) =>
      transfer && <TransferDialog sourceId={sourceId} rowIds={transfer.ids} mode={transfer.mode} onClose={() => setTransfer(null)} onDone={onDone} />,
  };
}
