import { useState } from 'react';
import { useTapGuard } from '../../useTapGuard.js';
import { useRows } from '../../api/databases.js';
import { TitleText } from '../TitleText.jsx';
import { ValueCell, ValueDisplay } from './cells.jsx';
import { DB_DRAG_TYPE, defaultTemplate, useDb, visibleColumns } from './context.js';
import { Icon, ICONS } from './meta.jsx';
import { field } from './Popover.jsx';
import { RowMenu, useTransfer } from './tableTools.jsx';

/** @typedef {import('../../api/databases.js').Row} Row */
/** @typedef {import('./context.js').Property} Property */
/** @typedef {{ row: Row, from: string | null }} Dragging */
/** @typedef {{ value: string | null, beforeId?: string, afterId?: string }} BoardDrop */

/**
 * Cards in columns, one per option of a select property (plus "No value").
 * Dragging a card to another column sets its value; within a column it
 * reorders (manual order, when the view has no sorts).
 */
export function BoardView() {
  const { dbId, properties, view, setConfig, m, templates, openRow } = useDb();
  const groupable = properties.filter((p) => p.type === 'select' || p.type === 'multi_select');
  const group = groupable.find((p) => p.id === view.config.groupBy) ?? groupable[0];
  const [dragging, setDragging] = useState(/** @type {Dragging | null} */ (null));
  const [drop, setDrop] = useState(/** @type {BoardDrop | null} */ (null));
  const [newRowId, setNewRowId] = useState(/** @type {string | null} */ (null));
  const [menu, setMenu] = useState(/** @type {{ row: Row, at: HTMLElement | { x: number, y: number } } | null} */ (null));
  const transfer = useTransfer();
  const [colDragging, setColDragging] = useState(/** @type {string | null} */ (null));
  const [colTarget, setColTarget] = useState(/** @type {string | null} */ (null));

  const commitColReorder = () => {
    const src = colDragging;
    const tgt = colTarget;
    setColDragging(null);
    setColTarget(null);
    if (!src || !tgt || src === tgt) return;
    const opts = group.config.options ?? [];
    const from = opts.findIndex((o) => o.id === src);
    const to = opts.findIndex((o) => o.id === tgt);
    if (from < 0 || to < 0) return;
    const next = [...opts];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    m.updateProperty(group.id, { config: { ...group.config, options: next } });
  };

  if (!group) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-line px-5 py-6 text-[14px] text-muted">
        A board groups cards by a select property.
        <button
          type="button"
          onClick={async () => {
            const prop = await m.addProperty({
              name: 'Status',
              type: 'select',
              config: {
                options: [{ name: 'Todo' }, { name: 'Doing' }, { name: 'Done' }],
              },
            });
            setConfig({ groupBy: prop.id });
          }}
          className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-[#141414] hover:bg-accent-text"
        >
          Add a Status property
        </button>
      </div>
    );
  }

  const allColumns = [{ id: null, name: `No ${group.name}` }, ...(group.config.options ?? []).map((o) => ({ id: o.id, name: o.name }))];
  const hidden = view.config.hiddenGroups ?? [];
  const columns = allColumns.filter((c) => !hidden.includes(c.id === null ? '__none__' : c.id));

  /** Move the dragged card into `target`. */
  const commit = async () => {
    const d = dragging;
    const t = drop;
    setDragging(null);
    setDrop(null);
    if (!d || !t) return;
    if (t.value !== d.from) {
      /** @type {unknown} */
      let value = t.value;
      if (group.type === 'multi_select') {
        const cur = /** @type {string[]} */ (d.row.props[group.id] ?? []);
        const rest = cur.filter((id) => id !== d.from);
        value = t.value === null ? (rest.length ? rest : null) : [...new Set([...rest, t.value])];
      }
      await m.setProps(d.row.id, { [group.id]: value });
    }
    if (view.config.sorts.length === 0 && (t.beforeId || t.afterId) && t.beforeId !== d.row.id && t.afterId !== d.row.id) {
      m.moveRow(d.row.id, t.beforeId ? { beforeId: t.beforeId } : { afterId: /** @type {string} */ (t.afterId) });
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {groupable.length > 1 && (
          <label className="flex items-center gap-2 text-[12px] text-muted">
            Group by
            <select value={group.id} onChange={(e) => setConfig({ groupBy: e.target.value })} className={`${field} h-6 w-auto`}>
              {groupable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {hidden.length > 0 && (
          <button
            type="button"
            onClick={() => setConfig({ hiddenGroups: [] })}
            className="flex items-center gap-1 rounded-md border border-dashed border-line px-2 py-0.5 text-[12px] text-muted hover:border-accent/60 hover:text-fg"
          >
            <Icon path={ICONS.eyeOff} size={12} />
            {hidden.length} hidden · Show all
          </button>
        )}
      </div>
      <div className="-mx-1 flex items-start gap-3 overflow-x-auto px-1 pb-3">
        {columns.map((c) => (
          <Column
            key={c.id ?? 'none'}
            group={group}
            value={c.id}
            name={c.name}
            dragging={dragging}
            drop={drop?.value === c.id ? drop : null}
            onDragStart={(row) => setDragging({ row, from: c.id })}
            onDragOver={setDrop}
            onDrop={commit}
            onDragEnd={() => {
              setDragging(null);
              setDrop(null);
            }}
            newRowId={newRowId}
            onMenu={(row, at) => setMenu({ row, at })}
            onNew={async () => {
              const templateId = defaultTemplate(view, templates);
              const row = await m.addRow({
                props: {
                  [group.id]: c.id === null ? null : group.type === 'multi_select' ? [c.id] : c.id,
                },
                templateId,
              });
              if (templateId) openRow(row.id);
              else setNewRowId(row.id);
            }}
            onHide={() => {
              const key = c.id === null ? '__none__' : c.id;
              setConfig({ hiddenGroups: [...(view.config.hiddenGroups ?? []), key] });
            }}
            colDragging={colDragging}
            colTarget={colTarget}
            onColDragStart={(id) => setColDragging(id)}
            onColDragOver={(id) => setColTarget(id)}
            onColDrop={commitColReorder}
            onColDragEnd={() => { setColDragging(null); setColTarget(null); }}
          />
        ))}
      </div>
      {menu && <RowMenu ids={[menu.row.id]} anchor={menu.at} onClose={() => setMenu(null)} onOpen={openRow} onTransfer={transfer.open} />}
      {transfer.dialog({ sourceId: dbId })}
    </div>
  );
}

/**
 * @param {{ group: Property, value: string | null, name: string, dragging: Dragging | null, drop: BoardDrop | null,
 *   onDragStart: (row: Row) => void, onDragOver: (d: BoardDrop) => void, onDrop: () => void, onDragEnd: () => void,
 *   newRowId: string | null, onNew: () => void, onMenu: (row: Row, at: HTMLElement | { x: number, y: number }) => void,
 *   onHide: () => void,
 *   colDragging: string | null, colTarget: string | null,
 *   onColDragStart: (id: string) => void, onColDragOver: (id: string) => void,
 *   onColDrop: () => void, onColDragEnd: () => void }} props
 */
function Column({ group, value, name, dragging, drop, onDragStart, onDragOver, onDrop, onDragEnd, newRowId, onNew, onMenu, onHide,
  colDragging, colTarget, onColDragStart, onColDragOver, onColDrop, onColDragEnd }) {
  const { dbId, view, properties } = useDb();
  const { sorts, filters } = view.config;
  const q = useRows(dbId, {
    sorts,
    filters,
    group: { propId: group.id, value },
    limit: 25,
  });
  const rows = q.data?.pages.flatMap((p) => p.rows) ?? [];
  const total = q.data?.pages[0]?.total ?? 0;
  const shown = visibleColumns(properties, view.config).filter((p) => p.id !== group.id);

  const lastId = rows[rows.length - 1]?.id;
  /** Where a drop lands: the gap line is drawn before `beforeId` or after `afterId`. */
  const lineBefore = drop?.beforeId;
  const lineAfter = drop?.afterId;

  const isColTarget = colTarget === value && value !== null;
  const isColDragging = colDragging === value;

  return (
    <section
      aria-label={name}
      data-column={value ?? ''}
      onDragOver={(e) => {
        if (!dragging && !colDragging) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (colDragging) {
          if (value !== null && colDragging !== value) onColDragOver(value);
          return;
        }
        // Card drag: over the column but not over a card → end of list.
        if (e.target === e.currentTarget || !(e.target instanceof Element && e.target.closest('[data-card]'))) {
          onDragOver({ value, afterId: lastId });
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (colDragging) onColDrop();
        else onDrop();
      }}
      className={`group/col flex w-[260px] shrink-0 flex-col gap-1.5 rounded-lg p-1.5 transition-colors ${
        drop ? 'bg-accent-soft/40' : isColTarget ? 'ring-2 ring-inset ring-accent/60 bg-accent-soft/20' : 'bg-white/[0.02]'
      } ${isColDragging ? 'opacity-50' : ''}`}
    >
      <header className="flex h-7 items-center gap-2 px-1 text-[13px]">
        {value !== null && (
          <span
            draggable
            aria-label="Drag to reorder column"
            title="Drag to reorder"
            onDragStart={(e) => {
              e.stopPropagation();
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', 'col');
              onColDragStart(value);
            }}
            onDragEnd={onColDragEnd}
            className="cursor-grab active:cursor-grabbing text-faint opacity-0 group-hover/col:opacity-100 hover:text-muted"
          >
            <Icon path={ICONS.grip} size={14} />
          </span>
        )}
        <span className="truncate font-medium text-fg">{name}</span>
        <span className="text-faint">{total}</span>
        <button
          type="button"
          onClick={onHide}
          aria-label={`Hide ${name}`}
          title="Hide column"
          className="ml-auto flex size-6 items-center justify-center rounded text-faint opacity-0 group-hover/col:opacity-100 hover:bg-hover hover:text-fg"
        >
          <Icon path={ICONS.eyeOff} />
        </button>
        <button
          type="button"
          onClick={onNew}
          aria-label={`New in ${name}`}
          className="flex size-6 items-center justify-center rounded text-faint hover:bg-hover hover:text-fg"
        >
          <Icon path={ICONS.plus} />
        </button>
      </header>

      {rows.map((row) => (
        <div
          key={row.id}
          data-card=""
          onDragOver={(e) => {
            if (!dragging) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            const box = e.currentTarget.getBoundingClientRect();
            onDragOver(e.clientY < box.top + box.height / 2 ? { value, beforeId: row.id } : { value, afterId: row.id });
          }}
          className="relative"
        >
          {lineBefore === row.id && <span className="absolute -top-1 right-1 left-1 h-[2px] rounded bg-accent" />}
          <Card
            row={row}
            props={shown}
            editTitle={row.id === newRowId}
            dragging={dragging?.row.id === row.id}
            onDragStart={() => onDragStart(row)}
            onDragEnd={onDragEnd}
            onMenu={(at) => onMenu(row, at)}
          />
          {lineAfter === row.id && <span className="absolute -bottom-1 right-1 left-1 h-[2px] rounded bg-accent" />}
        </div>
      ))}

      {q.hasNextPage && (
        <button type="button" onClick={() => q.fetchNextPage()} className="h-7 rounded-md px-2 text-left text-[12px] text-muted hover:bg-hover hover:text-fg">
          Load {Math.min(25, total - rows.length)} more
        </button>
      )}
      <button
        type="button"
        onClick={onNew}
        className="flex h-8 items-center gap-1.5 rounded-md px-2 text-left text-[13px] text-faint hover:bg-hover hover:text-muted"
      >
        <Icon path={ICONS.plus} /> New
      </button>
    </section>
  );
}

/** A tick on a card: its name follows it. @param {Property} p */
const tick = (p) => p.type === 'checkbox' || (p.type === 'formula' && p.config.resultType === 'boolean');
/** Values that mean little without their name (a lone tick or number). @param {Property} p */
const labelled = (p) => p.type === 'checkbox' || p.type === 'number' || p.type === 'formula' || p.type === 'rollup';

/** @param {unknown} v  worth a line on a card: set, not empty, and a ticked box */
const hasValue = (v) => v !== undefined && v !== null && v !== false && v !== '' && !(Array.isArray(v) && v.length === 0);

/**
 * A card: the title, then each shown property that has a value (checkboxes
 * only when ticked, labelled), then the row's buttons.
 * @param {{ row: Row, props: Property[], editTitle: boolean, dragging: boolean, onDragStart: () => void, onDragEnd: () => void,
 *   onMenu: (at: HTMLElement | { x: number, y: number }) => void }} props
 */
function Card({ row, props, editTitle, dragging, onDragStart, onDragEnd, onMenu }) {
  const { openRow, m, addOption } = useDb();
  const tapProps = useTapGuard(() => openRow(row.id));
  const [editing, setEditing] = useState(editTitle);
  const values = props.filter((p) => p.type !== 'button' && (p.type === 'created_time' || p.type === 'edited_time' || hasValue(row.props[p.id])));
  const buttons = props.filter((p) => p.type === 'button');

  if (editing) {
    return (
      <div className="rounded-md border border-accent/60 bg-s-sidebar p-2.5">
        <input
          autoFocus
          defaultValue={row.title}
          placeholder="Untitled"
          aria-label="Card title"
          onBlur={(e) => {
            setEditing(false);
            if (e.target.value.trim() !== row.title) m.renameRow(row.id, e.target.value.trim());
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' || e.key === 'Escape')
              /** @type {HTMLInputElement} */ (e.target).blur();
          }}
          className="w-full bg-transparent text-[14px] font-medium text-fg-strong outline-none"
        />
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      // Never preventDefault this mousedown (CLAUDE.md: HTML5 drag).
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', row.title || 'Untitled');
        e.dataTransfer.setData(DB_DRAG_TYPE, row.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      {...tapProps}
      onKeyDown={(e) => e.target === e.currentTarget && e.key === 'Enter' && openRow(row.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu({ x: e.clientX, y: e.clientY });
      }}
      data-row-id={row.id}
      className={`group/card relative flex cursor-pointer flex-col gap-1.5 rounded-md border border-line bg-s-sidebar p-2.5 text-left shadow-sm hover:border-white/15 hover:bg-hover ${dragging ? 'opacity-40' : ''}`}
    >
      <span className={`pr-5 text-[14px] leading-5 font-medium ${row.title ? 'text-fg-strong' : 'text-faint'}`}>
        {row.icon && <span className="mr-1.5">{row.icon}</span>}
        <TitleText title={row.title} titleContent={row.titleContent} />
      </span>
      <button
        type="button"
        aria-label="Card menu"
        onClick={(e) => {
          e.stopPropagation();
          onMenu(e.currentTarget);
        }}
        className="absolute top-2 right-1.5 flex size-6 items-center justify-center rounded text-faint opacity-0 group-hover/card:opacity-100 hover:bg-white/10 hover:text-fg focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
      >
        <Icon path={ICONS.dots} />
      </button>
      {values.map((p) => (
        <span key={p.id} className="flex min-w-0 items-center gap-1.5 text-[12px] text-fg" title={p.name}>
          <ValueDisplay prop={p} value={row.props[p.id]} row={row} wrap />
          {labelled(p) && <span className={tick(p) ? 'text-muted' : 'order-first text-faint'}>{p.name}</span>}
        </span>
      ))}
      {buttons.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {buttons.map((p) => (
            <ValueCell key={p.id} prop={p} value={null} row={row} onChange={() => {}} onAddOption={addOption} />
          ))}
        </div>
      )}
    </div>
  );
}
