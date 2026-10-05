import { useRef, useState } from 'react';
import { useDatabase, useDatabaseMutations } from '../../api/databases.js';
import { DbCtx, defaultTemplate, useDb } from './context.js';
import { BoardView } from './BoardView.jsx';
import { CalendarView } from './CalendarView.jsx';
import { Icon, ICONS } from './meta.jsx';
import { field, menuItem, Popover } from './Popover.jsx';
import { TableView } from './TableView.jsx';
import { Toolbar } from './Toolbar.jsx';

/** @typedef {import('../../api/databases.js').View} View */

/** Every ViewConfig key, empty: what a linked view's partial config is read over. */
const EMPTY_CONFIG = /** @type {import('../../api/databases.js').ViewConfig} */ ({
  sorts: [],
  filters: [],
  hidden: [],
  widths: {},
  propOrder: [],
  groupBy: null,
  hideEmptyGroups: false,
  dateBy: null,
  template: null,
});

/**
 * @typedef {{ view: { type: string, config: Partial<import('../../api/databases.js').ViewConfig> } | null,
 *   onConfig: (view: { type: string, config: import('../../api/databases.js').ViewConfig }) => void }} LocalView
 *   A linked database block's own view: not one of the database's saved views (no tabs, never saved there).
 */

/**
 * One database through one of its saved views: tabs, toolbar, table or board.
 * Full-page databases keep the chosen view locally; an inline database block
 * stores it in the block (`viewId` / `onViewChange`). A linked database block
 * brings its own view instead (`local`).
 * @param {{ databaseId: string, inline?: boolean, viewId?: string | null, onViewChange?: (id: string) => void,
 *   local?: LocalView, onOpenRow: (id: string, ids: string[]) => void, header?: import('react').ReactNode }} props
 */
export function DatabaseView({ databaseId, inline = false, viewId, onViewChange, local, onOpenRow, header }) {
  const { data, isPending, isError } = useDatabase(databaseId);
  const m = useDatabaseMutations(databaseId);
  const [localViewId, setLocalViewId] = useState(/** @type {string | null} */ (null));
  const [newRowId, setNewRowId] = useState(/** @type {string | null} */ (null));
  const root = useRef(/** @type {HTMLDivElement | null} */ (null));
  /** Open a row, with the rows around it as the view shows them (the peek's ‹ ›). @param {string} id */
  const openRow = (id) => {
    const shown = [...(root.current?.querySelectorAll('[data-row-id]') ?? [])].map((el) => /** @type {HTMLElement} */ (el).dataset.rowId ?? '');
    onOpenRow(id, [...new Set(shown)]);
  };

  const views = data?.views ?? [];
  const chosen = viewId ?? localViewId;
  /** @type {View | undefined} */
  const view = local
    ? {
        id: `linked:${databaseId}`,
        name: 'Linked view',
        type: /** @type {View['type']} */ (local.view?.type ?? 'table'),
        config: { ...EMPTY_CONFIG, ...local.view?.config },
        order: '',
      }
    : (views.find((v) => v.id === chosen) ?? views[0]);
  /** @param {string} id */
  const choose = (id) => (onViewChange ? onViewChange(id) : setLocalViewId(id));

  const ctx =
    data && view
      ? {
          dbId: databaseId,
          properties: data.properties,
          templates: data.templates ?? [],
          view,
          m,
          inline,
          openRow,
          /** @param {Partial<import('../../api/databases.js').ViewConfig>} patch */
          setConfig: (patch) =>
            local ? local.onConfig({ type: view.type, config: { ...view.config, ...patch } }) : m.updateView(view, { config: { ...view.config, ...patch } }),
          /** @param {import('./context.js').Property} prop @param {string} name */
          addOption: async (prop, name) => {
            const updated = await m.updateProperty(prop.id, { config: { ...prop.config, options: [...(prop.config.options ?? []), { name }] } });
            return updated.config.options?.find((o) => o.name === name)?.id;
          },
        }
      : null;

  if (isPending) return <div className="h-24" />;
  if (isError || !ctx || !view) return <p className="text-[14px] text-muted">Couldn’t load this database.</p>;

  /**
   * A new row: from `templateId`, else the view's default template, else blank (null = blank).
   * `values` start it in a group (a table group's "New").
   * @param {string | null} [templateId] @param {Record<string, unknown>} [values]
   */
  const newRow = async (templateId, values = {}) => {
    const template = templateId === undefined ? defaultTemplate(view, data.templates ?? []) : templateId;
    const row = await m.addRow({ props: { ...prefill(view, data.properties), ...values }, templateId: template });
    // A templated row already has its title and content: open it rather than rename in place.
    if (template) openRow(row.id);
    else setNewRowId(row.id);
  };

  return (
    <DbCtx.Provider value={ctx}>
      <div ref={root} className="flex flex-col gap-2" data-database={databaseId}>
        {header}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-1">
          {local ? <span /> : <ViewTabs views={views} active={view} onChoose={choose} />}
          <Toolbar onNew={newRow} />
        </div>
        {view.type === 'board' ? (
          <BoardView />
        ) : view.type === 'calendar' ? (
          <CalendarView onNewRow={(values) => newRow(undefined, values)} />
        ) : (
          <TableView newRowId={newRowId} onNewRow={(values) => newRow(undefined, values)} onNewRowDone={() => setNewRowId(null)} />
        )}
      </div>
    </DbCtx.Provider>
  );
}

/**
 * Values a new row starts with so it passes the view's simple filters
 * (select is X, tags contain X, checkbox is checked, links to X).
 * @param {View} view
 * @param {import('./context.js').Property[]} properties
 */
function prefill(view, properties) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const f of view.config.filters) {
    const p = properties.find((x) => x.id === f.propId);
    if (!p || f.value === undefined || f.value === null || f.value === '') continue;
    if (p.type === 'select' && f.op === 'is') out[p.id] = f.value;
    if (p.type === 'multi_select' && f.op === 'contains') out[p.id] = [f.value];
    if (p.type === 'checkbox' && f.op === 'is' && f.value === true) out[p.id] = true;
    if (p.type === 'relation' && f.op === 'contains') out[p.id] = [f.value];
  }
  return out;
}

/** @param {{ views: View[], active: View, onChoose: (id: string) => void }} props */
function ViewTabs({ views, active, onChoose }) {
  const [menu, setMenu] = useState(/** @type {{ view: View, el: HTMLElement } | null} */ (null));
  const [adding, setAdding] = useState(false);
  const addRef = useRef(/** @type {HTMLButtonElement | null} */ (null));

  return (
    <div role="tablist" className="flex min-w-0 flex-wrap items-center gap-0.5">
      {views.map((v) => (
        <button
          key={v.id}
          type="button"
          role="tab"
          aria-selected={v.id === active.id}
          onClick={(e) => (v.id === active.id ? setMenu({ view: v, el: e.currentTarget }) : onChoose(v.id))}
          className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] ${
            v.id === active.id ? 'bg-hover font-medium text-fg-strong' : 'text-muted hover:bg-hover hover:text-fg'
          }`}
        >
          <Icon path={LAYOUTS[v.type]?.icon ?? ICONS.table} />
          {v.name}
        </button>
      ))}
      <button ref={addRef} type="button" aria-label="Add a view" onClick={() => setAdding(true)} className="flex size-7 items-center justify-center rounded-md text-faint hover:bg-hover hover:text-fg">
        <Icon path={ICONS.plus} />
      </button>

      {adding && <AddViewMenu anchor={addRef.current} onClose={() => setAdding(false)} onAdded={onChoose} />}
      {menu && <ViewMenu key={menu.view.id} view={menu.view} anchor={menu.el} canDelete={views.length > 1} onClose={() => setMenu(null)} onDeleted={() => {
        const next = views.find((v) => v.id !== menu.view.id);
        if (next) onChoose(next.id);
      }} />}
    </div>
  );
}

/** The view layouts, with their names and icons. */
const LAYOUTS = /** @type {Record<'table' | 'board' | 'calendar', { name: string, icon: string }>} */ ({
  table: { name: 'Table', icon: ICONS.table },
  board: { name: 'Board', icon: ICONS.board },
  calendar: { name: 'Calendar', icon: ICONS.calendar },
});
const LAYOUT_TYPES = /** @type {const} */ (['table', 'board', 'calendar']);

/** @param {{ anchor: HTMLElement | null, onClose: () => void, onAdded: (id: string) => void }} props */
function AddViewMenu({ anchor, onClose, onAdded }) {
  const { m } = useDb();
  /** @param {'table' | 'board' | 'calendar'} type */
  const add = async (type) => {
    onClose();
    const view = await m.addView({ name: LAYOUTS[type].name, type });
    onAdded(view.id);
  };
  return (
    <Popover anchor={anchor} onClose={onClose} width={180}>
      {LAYOUT_TYPES.map((t) => (
        <button key={t} type="button" className={menuItem} onClick={() => add(t)}>
          <Icon path={LAYOUTS[t].icon} /> {LAYOUTS[t].name}
        </button>
      ))}
    </Popover>
  );
}

/**
 * Rename, switch layout, or delete a view.
 * @param {{ view: View, anchor: HTMLElement | null, canDelete: boolean, onClose: () => void, onDeleted: () => void }} props
 */
function ViewMenu({ view, anchor, canDelete, onClose, onDeleted }) {
  const { m } = useDb();
  const [name, setName] = useState(view.name);
  const rename = () => {
    const n = name.trim();
    if (n && n !== view.name) m.updateView(view, { name: n });
  };
  return (
    <Popover anchor={anchor} onClose={onClose} width={220}>
      <div className="p-1">
        <input
          autoFocus
          aria-label="View name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={rename}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              rename();
              onClose();
            }
          }}
          className={field}
        />
      </div>
      {LAYOUT_TYPES.map((t) => (
        <button key={t} type="button" className={menuItem} onClick={() => m.updateView(view, { type: t })}>
          <Icon path={LAYOUTS[t].icon} />
          <span className="flex-1">{LAYOUTS[t].name}</span>
          {view.type === t && <span className="text-accent">✓</span>}
        </button>
      ))}
      {canDelete && (
        <>
          <div className="my-1 h-px bg-line" />
          <button
            type="button"
            className={menuItem}
            onClick={async () => {
              onClose();
              await m.deleteView(view.id);
              onDeleted();
            }}
          >
            <Icon path={ICONS.trash} /> Delete view
          </button>
        </>
      )}
    </Popover>
  );
}
