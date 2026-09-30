import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { PROPERTY_TYPES } from '@papier/core/props';
import { useRows } from '../../api/databases.js';
import { TitleText } from '../TitleText.jsx';
import { ValueCell } from './cells.jsx';
import { DB_DRAG_TYPE, TITLE, useDb, visibleColumns } from './context.js';
import { Icon, ICONS, TYPE_LABELS, TypeIcon } from './meta.jsx';
import { menuItem, menuLabel, Popover } from './Popover.jsx';
import { PropertyMenu } from './PropertyMenu.jsx';

/** @typedef {import('../../api/databases.js').Row} Row */
/** @typedef {import('./context.js').Property} Property */

const ROW_H = 34;
const TITLE_W = 280;
const COL_W = 180;
const END_W = 40;

/**
 * Rows as a spreadsheet-like table. A full-page table is virtualized and loads
 * more as you scroll; an inline one loads a page at a time behind "Load more".
 * @param {{ newRowId: string | null, onNewRow: () => void }} props
 */
export function TableView({ newRowId, onNewRow }) {
  const { dbId, properties, view, inline } = useDb();
  const { sorts, filters } = view.config;
  const q = useRows(dbId, { sorts, filters, limit: inline ? 25 : 100 });
  const rows = q.data?.pages.flatMap((p) => p.rows) ?? [];
  const total = q.data?.pages[0]?.total ?? 0;

  const columns = visibleColumns(properties, view.config);
  const [liveWidths, setLiveWidths] = useState(/** @type {Record<string, number>} */ ({}));
  /** @param {string} id */
  const widthOf = (id) => liveWidths[id] ?? view.config.widths[id] ?? (id === 'title' ? TITLE_W : COL_W);
  const tableWidth = widthOf('title') + columns.reduce((w, c) => w + widthOf(c.id), 0) + END_W;

  const rowDnd = useRowDnd(rows);

  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-2">
      <div style={{ width: tableWidth, minWidth: '100%' }} className="text-[14px]">
        <Header columns={columns} widthOf={widthOf} onResize={setLiveWidths} />
        <Body rows={rows} columns={columns} widthOf={widthOf} newRowId={newRowId} dnd={rowDnd} query={q} virtual={!inline} />
        <button
          type="button"
          onClick={onNewRow}
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
      </div>
    </div>
  );
}

/**
 * @param {{ columns: Property[], widthOf: (id: string) => number,
 *   onResize: import('react').Dispatch<import('react').SetStateAction<Record<string, number>>> }} props
 */
function Header({ columns, widthOf, onResize }) {
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
    <div role="row" className="flex border-y border-line">
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
 *   dnd: ReturnType<typeof useRowDnd>, query: ReturnType<typeof useRows>, virtual: boolean }} props
 */
function Body({ rows, columns, widthOf, newRowId, dnd, query, virtual }) {
  const ref = useRef(/** @type {HTMLDivElement | null} */ (null));
  const [scroller, setScroller] = useState(/** @type {HTMLElement | null} */ (null));
  const [margin, setMargin] = useState(0);

  useLayoutEffect(() => {
    if (!virtual || !ref.current) return;
    const el = scrollParent(ref.current);
    setScroller(el);
    if (el) setMargin(ref.current.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop);
  }, [virtual]);

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

  /** @param {Row} row @param {import('react').CSSProperties} [style] */
  const renderRow = (row, style) => (
    <TableRow key={row.id} row={row} columns={columns} widthOf={widthOf} editTitle={row.id === newRowId} dnd={dnd} style={style} />
  );

  if (!virtual) return <div ref={ref}>{rows.map((r) => renderRow(r))}</div>;

  return (
    <div ref={ref} style={{ height: v.getTotalSize(), position: 'relative' }}>
      {items.map((it) => {
        const row = rows[it.index];
        return row ? renderRow(row, { position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${it.start - margin}px)` }) : null;
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
 * @param {{ row: Row, columns: Property[], widthOf: (id: string) => number, editTitle: boolean,
 *   dnd: ReturnType<typeof useRowDnd>, style?: import('react').CSSProperties }} props
 */
function TableRow({ row, columns, widthOf, editTitle, dnd, style }) {
  const { m, addOption } = useDb();
  const drop = dnd.drop?.id === row.id ? dnd.drop.where : null;
  return (
    <div
      role="row"
      data-row-id={row.id}
      style={style}
      onDragOver={(e) => dnd.over(e, row)}
      onDrop={(e) => dnd.commit(e)}
      className={`group/row relative flex h-[34px] border-b border-line hover:bg-white/[0.02] ${dnd.dragging === row.id ? 'opacity-50' : ''}`}
    >
      {drop && <span className={`pointer-events-none absolute right-0 left-0 z-10 h-[2px] bg-accent ${drop === 'before' ? '-top-px' : '-bottom-px'}`} />}
      <TitleCell row={row} width={widthOf('title')} startEditing={editTitle} />
      {columns.map((p) => (
        <div key={p.id} role="cell" data-col={p.id} style={{ width: widthOf(p.id) }} className="flex shrink-0 border-r border-line last:border-r-0">
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

/** @param {{ row: Row, width: number, startEditing: boolean }} props */
function TitleCell({ row, width, startEditing }) {
  const { m, openRow } = useDb();
  const [editing, setEditing] = useState(startEditing);
  const [text, setText] = useState('');
  useEffect(() => {
    if (startEditing) setEditing(true);
  }, [startEditing]);

  const commit = () => {
    setEditing(false);
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
          <TitleText title={row.title} titleContent={row.titleContent} />
        </button>
      )}
      {!editing && (
        <button
          type="button"
          onClick={() => openRow(row.id)}
          className="absolute right-1.5 flex h-6 items-center gap-1 rounded border border-line bg-s-sidebar px-1.5 text-[11px] font-medium tracking-wide text-muted uppercase opacity-0 group-hover/row:opacity-100 hover:text-fg focus-visible:opacity-100"
        >
          <Icon path={ICONS.open} size={12} /> Open
        </button>
      )}
    </div>
  );
}

/** Trailing cell: drag to reorder (manual order only), click for Open / Delete. @param {{ row: Row, dnd: ReturnType<typeof useRowDnd> }} props */
function RowEnd({ row, dnd }) {
  const { m, openRow } = useDb();
  const [menu, setMenu] = useState(/** @type {HTMLElement | null} */ (null));
  return (
    <div style={{ width: END_W }} className="flex shrink-0 items-center justify-center">
      <button
        type="button"
        aria-label="Row actions"
        // Stays mounted and never preventDefaults mousedown, or the drag dies (CLAUDE.md).
        draggable={dnd.enabled}
        onDragStart={(e) => dnd.start(e, row)}
        onDragEnd={dnd.end}
        onClick={(e) => setMenu(e.currentTarget)}
        className={`flex size-6 items-center justify-center rounded text-faint opacity-0 group-hover/row:opacity-100 hover:bg-hover hover:text-fg focus-visible:opacity-100 ${dnd.enabled ? 'cursor-grab' : ''}`}
      >
        <Icon path={dnd.enabled ? ICONS.grip : ICONS.dots} />
      </button>
      {menu && (
        <Popover anchor={menu} onClose={() => setMenu(null)} width={180} align="end">
          <button type="button" className={menuItem} onClick={() => openRow(row.id)}>
            <Icon path={ICONS.open} /> Open
          </button>
          <button
            type="button"
            className={menuItem}
            onClick={() => {
              setMenu(null);
              m.deleteRow(row.id);
            }}
          >
            <Icon path={ICONS.trash} /> Delete
          </button>
        </Popover>
      )}
    </div>
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
