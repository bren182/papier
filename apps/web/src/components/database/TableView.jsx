import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { PROPERTY_TYPES } from '@papier/core/props';
import { useRows } from '../../api/databases.js';
import { TitleText } from '../TitleText.jsx';
import { ValueCell } from './cells.jsx';
import { DB_DRAG_TYPE, TITLE, useDb, visibleColumns } from './context.js';
import { Icon, ICONS, TYPE_LABELS, TypeIcon } from './meta.jsx';
import { menuItem, menuLabel, Popover } from './Popover.jsx';
import { PropertyMenu } from './PropertyMenu.jsx';
import { BulkBar, FillHandle, RowMenu, TableCtx, useFill, useSelection, useTableTools, useTransfer } from './tableTools.jsx';

/** @typedef {import('../../api/databases.js').Row} Row */
/** @typedef {import('./context.js').Property} Property */

const ROW_H = 34;
const TITLE_W = 280;
const COL_W = 180;
const END_W = 40;
/** The leading column of select boxes. */
const SELECT_W = 30;

/** Types a table can be grouped by. */
export const GROUPABLE = new Set(['select', 'multi_select', 'checkbox', 'relation']);
/** Drag data: the table group a row is dragged out of (its value, JSON). */
const GROUP_DRAG = 'application/x-papier-group';

/**
 * Rows as a spreadsheet-like table. A full-page table is virtualized and loads
 * more as you scroll; an inline one loads a page at a time behind "Load more".
 * Grouped (`groupBy`), it shows one collapsible section per value instead,
 * each with its own paged query.
 * @param {{ newRowId: string | null, onNewRow: (values?: Record<string, unknown>) => void, onNewRowDone: () => void }} props
 */
export function TableView({ newRowId, onNewRow, onNewRowDone }) {
  const { dbId, properties, view, inline, openRow } = useDb();
  const { sorts, filters } = view.config;
  const groupProp = properties.find((p) => p.id === view.config.groupBy && GROUPABLE.has(p.type)) ?? null;
  const groups = useGroups(groupProp);
  const q = useRows(dbId, { sorts, filters, limit: inline ? 25 : 100 }, { enabled: !groupProp });
  const flat = useMemo(() => q.data?.pages.flatMap((p) => p.rows) ?? [], [q.data]);
  // Grouped: each section reports its loaded rows; selection and fill see them in display order.
  const [groupRows, setGroupRows] = useState(/** @type {Record<string, Row[]>} */ ({}));
  const rows = groupProp ? groups.flatMap((g) => groupRows[g.key] ?? []) : flat;
  const total = q.data?.pages[0]?.total ?? 0;
  /** @param {number} i */
  const offsetOf = (i) => groups.slice(0, i).reduce((n, g) => n + (groupRows[g.key]?.length ?? 0), 0);

  const columns = visibleColumns(properties, view.config);
  const [liveWidths, setLiveWidths] = useState(/** @type {Record<string, number>} */ ({}));
  /** @param {string} id */
  const widthOf = (id) => liveWidths[id] ?? view.config.widths[id] ?? (id === 'title' ? TITLE_W : COL_W);
  const tableWidth = SELECT_W + widthOf('title') + columns.reduce((w, c) => w + widthOf(c.id), 0) + END_W;

  const rowDnd = useRowDnd(rows);
  const selection = useSelection(rows, [view.id, sorts, filters]);
  const { fill, startFill } = useFill(rows);
  const transfer = useTransfer();
  const [menu, setMenu] = useState(/** @type {{ row: Row, at: HTMLElement | { x: number, y: number } } | null} */ (null));
  const tools = {
    selected: selection.selected,
    toggle: selection.toggle,
    fill,
    startFill,
    openMenu: (/** @type {Row} */ row, /** @type {HTMLElement | { x: number, y: number }} */ at) => setMenu({ row, at }),
  };
  const selectedIds = [...selection.selected];
  // The menu acts on the selection when the clicked row is part of it.
  const menuIds = menu ? (selection.selected.has(menu.row.id) && selection.selected.size > 1 ? selectedIds : [menu.row.id]) : [];

  return (
    <TableCtx.Provider value={tools}>
      <div className="-mx-1 overflow-x-auto px-1 pb-2">
        {selectedIds.length > 0 && <BulkBar ids={selectedIds} onClear={selection.clear} onTransfer={transfer.open} />}
        <div style={{ width: tableWidth, minWidth: '100%' }} className="text-[14px]">
          <Header
            columns={columns}
            widthOf={widthOf}
            onResize={setLiveWidths}
            allSelected={rows.length > 0 && selection.selected.size === rows.length}
            onSelectAll={selection.setAll}
          />
          {groupProp ? (
            groups.map((g, i) => (
              <GroupSection
                key={g.key}
                group={g}
                prop={groupProp}
                offset={offsetOf(i)}
                columns={columns}
                widthOf={widthOf}
                newRowId={newRowId}
                onNewRowDone={onNewRowDone}
                allRows={rows}
                onRows={(key, list) => setGroupRows((prev) => (prev[key] === list ? prev : { ...prev, [key]: list }))}
                onNewRow={onNewRow}
              />
            ))
          ) : (
            <>
              <Body rows={rows} columns={columns} widthOf={widthOf} newRowId={newRowId} onNewRowDone={onNewRowDone} dnd={rowDnd} query={q} virtual={!inline} />
              <button
                type="button"
                onClick={() => onNewRow()}
                className="flex h-[34px] w-full items-center gap-1.5 border-b border-line px-2 text-left text-[14px] text-faint hover:bg-white/[0.03] hover:text-muted"
              >
                <Icon path={ICONS.plus} /> New
              </button>
              <div className="flex h-8 items-center gap-3 px-2 text-[12px] text-faint">
                <span>
                  {total} {total === 1 ? 'row' : 'rows'}
                </span>
                {inline && q.hasNextPage && (
                  <button type="button" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage} className="text-muted hover:text-fg">
                    Load {Math.min(25, total - rows.length)} more
                  </button>
                )}
              </div>
            </>
          )}
        </div>
        {menu && <RowMenu ids={menuIds} anchor={menu.at} onClose={() => setMenu(null)} onOpen={openRow} onTransfer={transfer.open} onDone={selection.clear} />}
        {transfer.dialog({ sourceId: dbId, onDone: selection.clear })}
      </div>
    </TableCtx.Provider>
  );
}

/**
 * @param {{ columns: Property[], widthOf: (id: string) => number,
 *   onResize: import('react').Dispatch<import('react').SetStateAction<Record<string, number>>>,
 *   allSelected: boolean, onSelectAll: (on: boolean) => void }} props
 */
function Header({ columns, widthOf, onResize, allSelected, onSelectAll }) {
  const { view, setConfig, properties, m } = useDb();
  const [menu, setMenu] = useState(/** @type {{ prop: Property, el: HTMLElement } | null} */ (null));
  const [adding, setAdding] = useState(/** @type {HTMLElement | null} */ (null));
  const [dragId, setDragId] = useState(/** @type {string | null} */ (null));
  const [dropBefore, setDropBefore] = useState(/** @type {string | null} */ (null));

  /** Drag a column edge; the width saves to the view on release. @param {import('react').MouseEvent} e @param {string} id */
  const startResize = (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const w0 = widthOf(id);
    let w = w0;
    /** @param {MouseEvent} ev */
    const move = (ev) => {
      w = Math.max(80, Math.min(1000, Math.round(w0 + ev.clientX - x0)));
      onResize((all) => ({ ...all, [id]: w }));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      if (w !== w0) setConfig({ widths: { ...view.config.widths, [id]: w } });
      onResize((all) => {
        const { [id]: _, ...rest } = all;
        return rest;
      });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  /** Reorder columns: `id` goes before `beforeId` (null = last). @param {string} id @param {string | null} beforeId */
  const reorder = (id, beforeId) => {
    const ids = visibleColumns(properties, { ...view.config, hidden: [] }).map((p) => p.id).filter((x) => x !== id);
    const at = beforeId ? ids.indexOf(beforeId) : ids.length;
    ids.splice(at < 0 ? ids.length : at, 0, id);
    setConfig({ propOrder: ids });
  };

  /** @param {Property} p */
  const cell = (p) => {
    const isTitle = p.id === 'title';
    return (
      <div
        key={p.id}
        role="columnheader"
        data-col={p.id}
        draggable={!isTitle}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', p.name);
          e.dataTransfer.setData(DB_DRAG_TYPE, p.id);
          setDragId(p.id);
        }}
        onDragOver={(e) => {
          if (!dragId || isTitle || dragId === p.id) return;
          e.preventDefault();
          setDropBefore(p.id);
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (dragId) reorder(dragId, p.id);
          setDropBefore(null);
        }}
        onDragEnd={() => {
          setDragId(null);
          setDropBefore(null);
        }}
        style={{ width: widthOf(p.id) }}
        className={`group/h relative flex h-[34px] shrink-0 items-center border-r border-line last:border-r-0 ${dragId === p.id ? 'opacity-50' : ''}`}
      >
        {dropBefore === p.id && <span className="absolute -left-px top-1 bottom-1 w-[2px] rounded bg-accent" />}
        <button
          type="button"
          onClick={(e) => setMenu({ prop: p, el: e.currentTarget })}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2 text-left text-[13px] text-muted hover:bg-white/[0.04]"
        >
          <TypeIcon type={p.type} />
          <span className="truncate">{p.name}</span>
        </button>
        <span
          role="separator"
          aria-label={`Resize ${p.name}`}
          onMouseDown={(e) => startResize(e, p.id)}
          className="absolute top-0 -right-[3px] z-10 h-full w-[6px] cursor-col-resize hover:bg-accent/40"
        />
      </div>
    );
  };

  return (
    <div role="row" className="group/head flex border-y border-line">
      <div role="columnheader" style={{ width: SELECT_W }} className="flex shrink-0 items-center justify-center">
        <input
          type="checkbox"
          aria-label="Select all rows"
          checked={allSelected}
          onChange={(e) => onSelectAll(e.target.checked)}
          className={`accent-[var(--p-accent)] ${allSelected ? '' : 'opacity-0 group-hover/head:opacity-100 focus-visible:opacity-100'}`}
        />
      </div>
      {cell(TITLE)}
      {columns.map(cell)}
      <button
        type="button"
        aria-label="Add a property"
        onClick={(e) => setAdding(e.currentTarget)}
        onDragOver={(e) => {
          if (!dragId) return;
          e.preventDefault();
          setDropBefore('end');
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (dragId) reorder(dragId, null);
          setDropBefore(null);
        }}
        style={{ width: END_W }}
        className="relative flex shrink-0 items-center justify-center border-l border-line text-faint hover:bg-white/[0.04] hover:text-fg"
      >
        {dropBefore === 'end' && <span className="absolute -left-px top-1 bottom-1 w-[2px] rounded bg-accent" />}
        <Icon path={ICONS.plus} />
      </button>

      {menu && (
        // The live property, so the menu follows its own edits (type, target, options).
        <PropertyMenu key={menu.prop.id} prop={properties.find((p) => p.id === menu.prop.id) ?? menu.prop} anchor={menu.el} onClose={() => setMenu(null)} />
      )}
      {adding && (
        <Popover anchor={adding} onClose={() => setAdding(null)} width={220} align="end">
          <div className={menuLabel}>New property</div>
          {PROPERTY_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              className={menuItem}
              onClick={async () => {
                setAdding(null);
                const prop = await m.addProperty({ name: TYPE_LABELS[t] ?? t, type: t });
                // Opening its menu straight away lets you name it.
                requestAnimationFrame(() => {
                  const el = /** @type {HTMLElement | null} */ (document.querySelector(`[data-col="${prop.id}"] button`));
                  if (el) setMenu({ prop, el });
                });
              }}
            >
              <TypeIcon type={t} />
              {TYPE_LABELS[t]}
            </button>
          ))}
        </Popover>
      )}
    </div>
  );
}

/**
 * @param {{ rows: Row[], columns: Property[], widthOf: (id: string) => number, newRowId: string | null,
 *   onNewRowDone: () => void, dnd: ReturnType<typeof useRowDnd>, query: ReturnType<typeof useRows>, virtual: boolean }} props
 */
function Body({ rows, columns, widthOf, newRowId, onNewRowDone, dnd, query, virtual }) {
  const ref = useRef(/** @type {HTMLDivElement | null} */ (null));
  const [scroller, setScroller] = useState(/** @type {HTMLElement | null} */ (null));
  const [margin, setMargin] = useState(0);

  useLayoutEffect(() => {
    if (!virtual || !ref.current) return;
    const el = scrollParent(ref.current);
    setScroller(el);
    if (el) setMargin(ref.current.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop);
  }, [virtual]);

  // Scroll the new row into view once it appears in the list.
  useEffect(() => {
    if (!newRowId) return;
    const idx = rows.findIndex((r) => r.id === newRowId);
    if (idx === -1) return;
    requestAnimationFrame(() => {
      if (virtual && scroller) {
        scroller.scrollTop = scroller.scrollHeight;
      } else {
        ref.current?.querySelector(`[data-row-id="${newRowId}"]`)?.scrollIntoView({ block: 'nearest' });
      }
    });
  }, [rows, newRowId]); // eslint-disable-line react-hooks/exhaustive-deps

  const v = useVirtualizer({
    count: virtual ? rows.length : 0,
    getScrollElement: () => scroller,
    estimateSize: () => ROW_H,
    overscan: 12,
    scrollMargin: margin,
  });
  const items = v.getVirtualItems();
  const last = items[items.length - 1];

  // Full-page tables load the next page as you near the end.
  useEffect(() => {
    if (virtual && last && last.index >= rows.length - 20 && query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage();
  }, [virtual, last, rows.length, query]);

  /** @param {Row} row @param {number} index @param {import('react').CSSProperties} [style] */
  const renderRow = (row, index, style) => (
    <TableRow key={row.id} row={row} index={index} columns={columns} widthOf={widthOf} editTitle={row.id === newRowId} onEditDone={row.id === newRowId ? onNewRowDone : undefined} dnd={dnd} style={style} />
  );

  if (!virtual) return <div ref={ref}>{rows.map((r, i) => renderRow(r, i))}</div>;

  return (
    <div ref={ref} style={{ height: v.getTotalSize(), position: 'relative' }}>
      {items.map((it) => {
        const row = rows[it.index];
        return row ? renderRow(row, it.index, { position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${it.start - margin}px)` }) : null;
      })}
    </div>
  );
}

/** @param {HTMLElement} el */
function scrollParent(el) {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if (overflowY === 'auto' || overflowY === 'scroll') return p;
  }
  return null;
}

/**
 * @param {{ row: Row, index: number, columns: Property[], widthOf: (id: string) => number, editTitle: boolean,
 *   onEditDone?: () => void, dnd: ReturnType<typeof useRowDnd>, style?: import('react').CSSProperties }} props
 */
function TableRow({ row, index, columns, widthOf, editTitle, onEditDone, dnd, style }) {
  const { m, addOption } = useDb();
  const tools = useTableTools();
  const drop = dnd.drop?.id === row.id ? dnd.drop.where : null;
  const selected = tools.selected.has(row.id);
  const fill = tools.fill;
  const inFill = fill && index >= Math.min(fill.from, fill.to) && index <= Math.max(fill.from, fill.to);
  return (
    <div
      role="row"
      data-row-id={row.id}
      data-row-index={index}
      aria-selected={selected}
      style={style}
      onDragOver={(e) => dnd.over(e, row)}
      onDrop={(e) => dnd.commit(e)}
      onContextMenu={(e) => {
        e.preventDefault();
        tools.openMenu(row, { x: e.clientX, y: e.clientY });
      }}
      className={`group/row relative flex h-[34px] border-b border-line ${selected ? 'bg-accent-soft' : 'hover:bg-white/[0.02]'} ${dnd.dragging === row.id ? 'opacity-50' : ''}`}
    >
      {drop && <span className={`pointer-events-none absolute right-0 left-0 z-10 h-[2px] bg-accent ${drop === 'before' ? '-top-px' : '-bottom-px'}`} />}
      <div role="cell" style={{ width: SELECT_W }} className="flex shrink-0 items-center justify-center">
        <input
          type="checkbox"
          aria-label={`Select ${row.title || 'Untitled'}`}
          checked={selected}
          onChange={() => {}}
          onClick={(e) => tools.toggle(row.id, e)}
          className={`accent-[var(--p-accent)] ${selected || tools.selected.size ? '' : 'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100'}`}
        />
      </div>
      <TitleCell row={row} width={widthOf('title')} startEditing={editTitle} onEditDone={onEditDone} />
      {columns.map((p) => (
        <div
          key={p.id}
          role="cell"
          data-col={p.id}
          style={{ width: widthOf(p.id) }}
          className={`group/cell relative flex shrink-0 border-r border-line last:border-r-0 ${inFill && fill?.propId === p.id ? 'bg-accent-soft outline outline-1 -outline-offset-1 outline-accent' : ''}`}
        >
          <FillHandle index={index} prop={p} value={row.props[p.id]} />
          <ValueCell
            prop={p}
            value={row.props[p.id]}
            row={row}
            onChange={(v) => m.setProps(row.id, { [p.id]: v })}
            onAddOption={addOption}
            className="h-full w-full px-2 text-[14px] text-fg hover:bg-white/[0.03] focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          />
        </div>
      ))}
      <RowEnd row={row} dnd={dnd} />
    </div>
  );
}

/** @param {{ row: Row, width: number, startEditing: boolean, onEditDone?: () => void }} props */
function TitleCell({ row, width, startEditing, onEditDone }) {
  const { m, openRow } = useDb();
  const [editing, setEditing] = useState(startEditing);
  const [text, setText] = useState('');
  useEffect(() => {
    if (startEditing) setEditing(true);
  }, [startEditing]);

  const commit = () => {
    setEditing(false);
    onEditDone?.();
    if (text !== row.title) m.renameRow(row.id, text.trim());
  };

  return (
    <div role="cell" data-col="title" style={{ width }} className="group/t relative flex shrink-0 items-center border-r border-line">
      {editing ? (
        <input
          autoFocus
          value={text}
          onFocus={() => setText(row.title)}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditing(false);
          }}
          placeholder="Untitled"
          className="h-full w-full bg-transparent px-2 font-medium text-fg-strong outline-none"
        />
      ) : (
        <button
          type="button"
          data-title=""
          onClick={() => setEditing(true)}
          className={`h-full min-w-0 flex-1 truncate px-2 text-left font-medium ${row.title ? 'text-fg-strong' : 'text-faint'}`}
        >
          {row.icon && <span className="mr-1.5">{row.icon}</span>}
          <TitleText title={row.title} titleContent={row.titleContent} />
        </button>
      )}
      {!editing && (
        <button
          type="button"
          onClick={() => openRow(row.id)}
          className="absolute right-1.5 flex h-6 items-center gap-1 rounded border border-line bg-s-sidebar px-1.5 text-[11px] font-medium tracking-wide text-muted uppercase opacity-0 group-hover/row:opacity-100 hover:text-fg focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
        >
          <Icon path={ICONS.open} size={12} /> Open
        </button>
      )}
    </div>
  );
}

/** Trailing cell: drag to reorder (manual order only), click for the row menu. @param {{ row: Row, dnd: ReturnType<typeof useRowDnd> }} props */
function RowEnd({ row, dnd }) {
  const tools = useTableTools();
  return (
    <div style={{ width: END_W }} className="flex shrink-0 items-center justify-center">
      <button
        type="button"
        aria-label="Row actions"
        // Stays mounted and never preventDefaults mousedown, or the drag dies (CLAUDE.md).
        draggable={dnd.enabled}
        onDragStart={(e) => dnd.start(e, row)}
        onDragEnd={dnd.end}
        onClick={(e) => tools.openMenu(row, e.currentTarget)}
        className={`flex size-6 items-center justify-center rounded text-faint opacity-0 group-hover/row:opacity-100 hover:bg-hover hover:text-fg focus-visible:opacity-100 [@media(hover:none)]:opacity-100 ${dnd.enabled ? 'cursor-grab' : ''}`}
      >
        <Icon path={dnd.enabled ? ICONS.grip : ICONS.dots} />
      </button>
    </div>
  );
}

/**
 * @typedef {{ key: string, value: string | null, label: string, icon?: string | null }} Group
 */

/**
 * The groups of a grouped table, in order: "No X" first, then each option
 * (select), Checked/Unchecked (checkbox), or each row of the related database
 * (relation, the first 50).
 * @param {Property | null} prop
 * @returns {Group[]}
 */
function useGroups(prop) {
  const target = prop?.type === 'relation' ? (prop.config.databaseId ?? null) : null;
  const related = useRows(target ?? '', { limit: 50 }, { enabled: Boolean(target) });
  if (!prop) return [];
  const none = { key: 'none', value: null, label: `No ${prop.name}` };
  if (prop.type === 'checkbox') return [{ key: 'true', value: 'true', label: 'Checked' }, { key: 'none', value: null, label: 'Unchecked' }];
  if (prop.type === 'relation') {
    const rows = related.data?.pages.flatMap((p) => p.rows) ?? [];
    return [none, ...rows.map((r) => ({ key: r.id, value: r.id, label: r.title || 'Untitled', icon: r.icon }))];
  }
  return [none, ...(prop.config.options ?? []).map((o) => ({ key: o.id, value: o.id, label: o.name }))];
}

/** Values that put a new row in a group. @param {Property} prop @param {string | null} value */
function groupValues(prop, value) {
  if (value === null) return {};
  if (prop.type === 'checkbox') return { [prop.id]: true };
  if (prop.type === 'select') return { [prop.id]: value };
  return { [prop.id]: [value] };
}

/**
 * A row's value after dragging it from one group to another: the old group's
 * value swapped for the new one (other tags / links stay).
 * @param {Property} prop @param {unknown} current @param {string | null} from @param {string | null} to
 */
function regroup(prop, current, from, to) {
  if (prop.type === 'select') return to;
  if (prop.type === 'checkbox') return to === 'true' ? true : null;
  const ids = Array.isArray(current) ? current.filter((x) => x !== from) : [];
  const next = to === null ? ids : [...new Set([...ids, to])];
  return next.length ? next : null;
}

/**
 * One group of a grouped table: a header (collapse, name, count), its rows
 * (paged), "New" in the group. Drop a row from another group to move it here.
 * @param {{ group: Group, prop: Property, offset: number, columns: Property[], widthOf: (id: string) => number, newRowId: string | null,
 *   onNewRowDone: () => void, allRows: Row[], onRows: (key: string, rows: Row[]) => void, onNewRow: (values?: Record<string, unknown>) => void }} props
 */
function GroupSection({ group, prop, offset, columns, widthOf, newRowId, onNewRowDone, allRows, onRows, onNewRow }) {
  const { dbId, view, m } = useDb();
  const { sorts, filters } = view.config;
  const q = useRows(dbId, { sorts, filters, group: { propId: prop.id, value: group.value }, limit: 25 });
  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.rows) ?? [], [q.data]);
  const total = q.data?.pages[0]?.total ?? 0;
  const [open, setOpen] = useState(true);
  const [over, setOver] = useState(false);
  const dnd = useRowDnd(rows);
  useEffect(() => onRows(group.key, rows), [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  if (view.config.hideEmptyGroups && q.data && total === 0) return null;

  /** A row dragged in from another group (not one of ours). @param {import('react').DragEvent} e */
  const foreign = (e) => e.dataTransfer.types.includes(GROUP_DRAG) && !dnd.dragging;

  return (
    <section
      aria-label={group.label}
      onDragStartCapture={(e) => e.dataTransfer.setData(GROUP_DRAG, JSON.stringify(group.value))}
      onDragOver={(e) => {
        if (!foreign(e)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(/** @type {Node | null} */ (e.relatedTarget))) setOver(false);
      }}
      onDrop={(e) => {
        setOver(false);
        if (!foreign(e)) return;
        e.preventDefault();
        const rowId = e.dataTransfer.getData(DB_DRAG_TYPE);
        const from = /** @type {string | null} */ (JSON.parse(e.dataTransfer.getData(GROUP_DRAG) || 'null'));
        const row = allRows.find((r) => r.id === rowId);
        if (row && from !== group.value) m.setProps(row.id, { [prop.id]: regroup(prop, row.props[prop.id], from, group.value) });
      }}
      className={over ? 'rounded-md outline outline-1 outline-accent' : ''}
    >
      <div className="flex h-10 items-end gap-2 border-b border-line px-1 pb-1.5 text-[13px]">
        <button
          type="button"
          aria-label={`${open ? 'Collapse' : 'Expand'} ${group.label}`}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex size-5 items-center justify-center rounded text-muted hover:bg-hover"
        >
          <span className={`inline-block text-[10px] transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
        </button>
        <span className={`font-medium ${group.value === null ? 'text-muted' : 'text-fg-strong'}`}>
          {group.icon && <span className="mr-1">{group.icon}</span>}
          {group.label}
        </span>
        <span className="text-faint">{total}</span>
      </div>
      {open && (
        <>
          {rows.map((r, i) => (
            <TableRow key={r.id} row={r} index={offset + i} columns={columns} widthOf={widthOf} editTitle={r.id === newRowId} onEditDone={r.id === newRowId ? onNewRowDone : undefined} dnd={dnd} />
          ))}
          <div className="flex h-[30px] items-center gap-3 border-b border-line px-2 text-[13px] text-faint">
            <button type="button" onClick={() => onNewRow(groupValues(prop, group.value))} className="flex items-center gap-1.5 hover:text-muted">
              <Icon path={ICONS.plus} /> New
            </button>
            {q.hasNextPage && (
              <button type="button" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage} className="text-muted hover:text-fg">
                Load {Math.min(25, total - rows.length)} more
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Manual row reordering by dragging a row's end handle. Only when the view has
 * no sorts — with sorts the order is theirs, not yours.
 * @param {Row[]} rows
 */
function useRowDnd(rows) {
  const { view, m } = useDb();
  const enabled = view.config.sorts.length === 0;
  const [dragging, setDragging] = useState(/** @type {string | null} */ (null));
  const [drop, setDrop] = useState(/** @type {{ id: string, where: 'before' | 'after' } | null} */ (null));

  return {
    enabled,
    dragging,
    drop,
    /** @param {import('react').DragEvent} e @param {Row} row */
    start: (e, row) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', row.title || 'Untitled');
      e.dataTransfer.setData(DB_DRAG_TYPE, row.id);
      setDragging(row.id);
    },
    /** @param {import('react').DragEvent<HTMLElement>} e @param {Row} row */
    over: (e, row) => {
      if (!dragging) return;
      e.preventDefault();
      const box = e.currentTarget.getBoundingClientRect();
      const where = e.clientY < box.top + box.height / 2 ? 'before' : 'after';
      if (drop?.id !== row.id || drop.where !== where) setDrop({ id: row.id, where });
    },
    /** @param {import('react').DragEvent} e */
    commit: (e) => {
      e.preventDefault();
      if (dragging && drop && drop.id !== dragging) {
        const ref = rows.find((r) => r.id === drop.id);
        if (ref) m.moveRow(dragging, drop.where === 'before' ? { beforeId: ref.id } : { afterId: ref.id });
      }
      setDrop(null);
    },
    end: () => {
      setDragging(null);
      setDrop(null);
    },
  };
}
