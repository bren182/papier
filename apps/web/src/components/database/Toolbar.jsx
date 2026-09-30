import { useRef, useState } from 'react';
import { DYNAMIC_TODAY, filterOps, rollupResultType, VALUELESS_OPS } from '@papier/core/props';
import { useAutomations } from '../../api/automations.js';
import { AutomationsPanel } from './AutomationsPanel.jsx';
import { RefChip, RelationPicker } from './cells.jsx';
import { GROUPABLE } from './TableView.jsx';
import { defaultTemplate, orderedProperties, TITLE, useDb } from './context.js';
import { Icon, ICONS, OP_LABELS, TypeIcon } from './meta.jsx';
import { field, menuItem, menuLabel, Popover } from './Popover.jsx';

const toolButton = 'flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted hover:bg-hover hover:text-fg';
const activeTool = 'text-accent-text hover:text-accent-text';

/**
 * Automations, Filter, Sort, Properties and New ▾ — the strip above a view.
 * @param {{ onNew: (templateId?: string | null) => void }} props  undefined = the view's default
 */
export function Toolbar({ onNew }) {
  const { view, dbId } = useDb();
  const [open, setOpen] = useState(/** @type {'sort' | 'filter' | 'props' | 'new' | 'auto' | 'group' | null} */ (null));
  const refs = { sort: useRef(null), filter: useRef(null), props: useRef(null), new: useRef(null), auto: useRef(null), group: useRef(null) };
  const grouped = view.type === 'table' && Boolean(view.config.groupBy);
  const close = () => setOpen(null);
  const { sorts, filters } = view.config;
  const running = (useAutomations(dbId).data ?? []).filter((a) => a.enabled).length;

  return (
    <div className="flex items-center gap-0.5">
      <button
        ref={refs.auto}
        type="button"
        aria-label="Automations"
        title="Automations"
        className={`${toolButton} ${running ? activeTool : ''}`}
        onClick={() => setOpen('auto')}
      >
        <Icon path={ICONS.bolt} />
        {running ? running : null}
      </button>
      {view.type === 'table' && (
        <button ref={refs.group} type="button" className={`${toolButton} ${grouped ? activeTool : ''}`} onClick={() => setOpen('group')}>
          <Icon path={ICONS.group} />
          Group
        </button>
      )}
      <button ref={refs.filter} type="button" className={`${toolButton} ${filters.length ? activeTool : ''}`} onClick={() => setOpen('filter')}>
        <Icon path={ICONS.filter} />
        Filter{filters.length ? ` · ${filters.length}` : ''}
      </button>
      <button ref={refs.sort} type="button" className={`${toolButton} ${sorts.length ? activeTool : ''}`} onClick={() => setOpen('sort')}>
        <Icon path={ICONS.sort} />
        Sort{sorts.length ? ` · ${sorts.length}` : ''}
      </button>
      <button ref={refs.props} type="button" className={toolButton} onClick={() => setOpen('props')} aria-label="Properties">
        <Icon path={ICONS.eye} />
        Properties
      </button>
      <span ref={refs.new} className="ml-1 flex h-7 items-stretch overflow-hidden rounded-md bg-accent text-[13px] font-medium text-[#141414]">
        <button type="button" onClick={() => onNew()} className="px-2.5 hover:bg-accent-text">
          New
        </button>
        <button type="button" aria-label="New from template" onClick={() => setOpen('new')} className="border-l border-black/15 px-1.5 hover:bg-accent-text">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </span>

      {open === 'sort' && <SortMenu anchor={refs.sort.current} onClose={close} />}
      {open === 'filter' && <FilterMenu anchor={refs.filter.current} onClose={close} />}
      {open === 'props' && <PropertiesMenu anchor={refs.props.current} onClose={close} />}
      {open === 'new' && <NewMenu anchor={refs.new.current} onClose={close} onNew={onNew} />}
      {open === 'auto' && <AutomationsPanel anchor={refs.auto.current} onClose={close} />}
      {open === 'group' && <GroupMenu anchor={refs.group.current} onClose={close} />}
    </div>
  );
}

/**
 * Group a table by a select, multi-select, checkbox or relation; optionally hide empty groups.
 * @param {{ anchor: HTMLElement | null, onClose: () => void }} props
 */
function GroupMenu({ anchor, onClose }) {
  const { properties, view, setConfig } = useDb();
  const options = properties.filter((p) => GROUPABLE.has(p.type));
  const current = view.config.groupBy;
  return (
    <Popover anchor={anchor} onClose={onClose} width={240}>
      <div className={menuLabel}>Group by</div>
      <button type="button" className={menuItem} onClick={() => setConfig({ groupBy: null })}>
        <span className="flex-1">None</span>
        {!current && <span className="text-accent">✓</span>}
      </button>
      {options.map((p) => (
        <button key={p.id} type="button" className={menuItem} onClick={() => setConfig({ groupBy: p.id })}>
          <TypeIcon type={p.type} />
          <span className="flex-1">{p.name}</span>
          {current === p.id && <span className="text-accent">✓</span>}
        </button>
      ))}
      {!options.length && <div className="px-2 py-1 text-[12px] text-muted">Add a select, checkbox or relation to group by.</div>}
      {current && (
        <>
          <div className="my-1 h-px bg-line" />
          <button type="button" className={menuItem} onClick={() => setConfig({ hideEmptyGroups: !view.config.hideEmptyGroups })}>
            <span className="flex-1">Hide empty groups</span>
            {view.config.hideEmptyGroups && <span className="text-accent">✓</span>}
          </button>
        </>
      )}
    </Popover>
  );
}

/**
 * New ▾: start from a template or blank, set the view's default, add or edit templates.
 * @param {{ anchor: HTMLElement | null, onClose: () => void, onNew: (templateId?: string | null) => void }} props
 */
function NewMenu({ anchor, onClose, onNew }) {
  const { templates, view, setConfig, m, openRow } = useDb();
  const current = defaultTemplate(view, templates);
  const small = 'rounded px-1.5 text-[11px] text-muted hover:bg-white/[0.08] hover:text-fg';
  return (
    <Popover anchor={anchor} onClose={onClose} width={300} align="end">
      <div className={menuLabel}>Templates</div>
      {templates.length === 0 && (
        <div className="px-2 pb-1.5 text-[13px] text-muted">None yet. A template fills in a new row’s values and content.</div>
      )}
      {templates.map((t) => (
        <div key={t.id} className="group/t flex items-center rounded-md hover:bg-hover">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left text-[13px] text-fg"
            onClick={() => {
              onClose();
              onNew(t.id);
            }}
          >
            <span className="truncate">{t.title || 'Untitled template'}</span>
            {current === t.id && <span className="shrink-0 text-[11px] text-accent-text">Default</span>}
          </button>
          <span className="flex shrink-0 gap-0.5 pr-1 opacity-0 group-hover/t:opacity-100 focus-within:opacity-100">
            <button type="button" className={small} onClick={() => setConfig({ template: current === t.id ? null : t.id })}>
              {current === t.id ? 'Unset default' : 'Set default'}
            </button>
            <button
              type="button"
              className={small}
              onClick={() => {
                onClose();
                openRow(t.id);
              }}
            >
              Edit
            </button>
            <button type="button" className={small} aria-label={`Delete template ${t.title || 'Untitled'}`} onClick={() => m.deleteTemplate(t.id)}>
              <Icon path={ICONS.trash} size={11} />
            </button>
          </span>
        </div>
      ))}
      <div className="my-1 h-px bg-line" />
      <button
        type="button"
        className={menuItem}
        onClick={() => {
          onClose();
          onNew(null);
        }}
      >
        Empty page
      </button>
      <button
        type="button"
        className={menuItem}
        onClick={async () => {
          onClose();
          const t = await m.addTemplate();
          openRow(t.id);
        }}
      >
        <Icon path={ICONS.plus} /> New template
      </button>
    </Popover>
  );
}

/** Sortable/filterable properties, title first. */
function useAllProps() {
  const { properties } = useDb();
  return [TITLE, ...properties];
}

/** @param {{ anchor: HTMLElement | null, onClose: () => void }} props */
function SortMenu({ anchor, onClose }) {
  const { view, setConfig } = useDb();
  const all = useAllProps();
  const sorts = view.config.sorts;
  const unused = all.filter((p) => !sorts.some((s) => s.propId === p.id));

  return (
    <Popover anchor={anchor} onClose={onClose} width={320}>
      {sorts.length === 0 && <div className="px-2 py-1.5 text-[13px] text-muted">No sorts — rows are in manual order.</div>}
      {sorts.map((s, i) => {
        const isDate = all.find((p) => p.id === s.propId)?.type === 'date';
        /** @param {string} propId */
        const setProp = (propId) => {
          // "Upcoming" only means something for dates.
          const date = all.find((p) => p.id === propId)?.type === 'date';
          return { ...s, propId, dir: s.dir === 'upcoming' && !date ? /** @type {const} */ ('asc') : s.dir };
        };
        return (
          <div key={s.propId} className="flex items-center gap-1 px-1 py-0.5">
            <PropSelect value={s.propId} options={all.filter((p) => p.id === s.propId || !sorts.some((x) => x.propId === p.id))}
              onChange={(propId) => setConfig({ sorts: sorts.map((x, j) => (j === i ? setProp(propId) : x)) })} />
            <select
              value={s.dir}
              aria-label="Direction"
              onChange={(e) => setConfig({ sorts: sorts.map((x, j) => (j === i ? { ...x, dir: /** @type {'asc' | 'desc' | 'upcoming'} */ (e.target.value) } : x)) })}
              className={`${field} w-[110px]`}
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
              {isDate && <option value="upcoming" title="Next anniversary first, like birthdays">Upcoming</option>}
            </select>
            <RemoveButton label="Remove sort" onClick={() => setConfig({ sorts: sorts.filter((_, j) => j !== i) })} />
          </div>
        );
      })}
      <div className="my-1 h-px bg-line" />
      <button
        type="button"
        className={menuItem}
        disabled={!unused[0]}
        onClick={() => unused[0] && setConfig({ sorts: [...sorts, { propId: unused[0].id, dir: 'asc' }] })}
      >
        <Icon path={ICONS.plus} /> Add sort
      </button>
    </Popover>
  );
}

/** @param {{ anchor: HTMLElement | null, onClose: () => void }} props */
function FilterMenu({ anchor, onClose }) {
  const { view, setConfig } = useDb();
  const all = useAllProps();
  const filters = view.config.filters;
  const byId = new Map(all.map((p) => [p.id, p]));

  /** @param {number} i @param {Partial<import('./context.js').ViewConfig['filters'][number]>} patch */
  const update = (i, patch) => setConfig({ filters: filters.map((f, j) => (j === i ? { ...f, ...patch } : f)) });

  return (
    <Popover anchor={anchor} onClose={onClose} width={440}>
      {filters.length === 0 && <div className="px-2 py-1.5 text-[13px] text-muted">No filters — every row shows.</div>}
      {filters.map((f, i) =>
        byId.has(f.propId) ? (
          <ConditionRow
            key={i}
            filter={f}
            properties={all}
            onChange={(patch) => update(i, patch)}
            onRemove={() => setConfig({ filters: filters.filter((_, j) => j !== i) })}
          />
        ) : null,
      )}
      <div className="my-1 h-px bg-line" />
      <button
        type="button"
        className={menuItem}
        onClick={() => setConfig({ filters: [...filters, { propId: 'title', op: 'contains', value: '' }] })}
      >
        <Icon path={ICONS.plus} /> Add filter
      </button>
    </Popover>
  );
}

/**
 * One condition: property, operator, value. Used by view filters and by
 * automations ("when … is …", "for rows where …").
 * @param {{ filter: import('./context.js').ViewConfig['filters'][number], properties: import('./context.js').Property[],
 *   onChange: (patch: Partial<import('./context.js').ViewConfig['filters'][number]>) => void, onRemove?: () => void }} props
 */
export function ConditionRow({ filter: f, properties, onChange, onRemove }) {
  const prop = properties.find((p) => p.id === f.propId);
  if (!prop) return null;
  const ops = filterOps(prop);
  return (
    <div className="flex items-center gap-1 px-1 py-0.5">
      <PropSelect
        value={f.propId}
        options={properties}
        onChange={(propId) => {
          const next = properties.find((p) => p.id === propId);
          onChange({ propId, op: filterOps(next ?? { type: 'text' })[0] ?? 'is', value: next?.type === 'checkbox' ? true : undefined });
        }}
      />
      <select value={f.op} aria-label="Condition" onChange={(e) => onChange({ op: e.target.value })} className={`${field} w-[130px] max-w-[130px] shrink-0`}>
        {ops.map((op) => (
          <option key={op} value={op}>
            {OP_LABELS[op]}
          </option>
        ))}
      </select>
      {/* Keyed by property: a new property starts a fresh value box. */}
      {!VALUELESS_OPS.has(f.op) && <FilterValue key={f.propId} prop={prop} value={f.value} onChange={(value) => onChange({ value })} />}
      {onRemove && <RemoveButton label="Remove filter" onClick={onRemove} />}
    </div>
  );
}

/**
 * The value box of a filter, typed like its property.
 * @param {{ prop: import('./context.js').Property, value: unknown, onChange: (v: string | number | boolean | null) => void }} props
 */
function FilterValue({ prop, value, onChange }) {
  const [text, setText] = useState(value === undefined || value === null ? '' : String(value));
  const cls = `${field} min-w-0 flex-1`;
  // A rollup is filtered as its result: a number (percentages as shown, 0–100) or a date.
  const type = prop.type === 'rollup' ? (rollupResultType(prop.config.fn ?? undefined) === 'date' ? 'date' : 'number') : prop.type;
  switch (type) {
    case 'relation':
      return <RelationFilterValue prop={prop} value={typeof value === 'string' ? value : null} onChange={onChange} />;
    case 'select':
    case 'multi_select':
      return (
        <select value={String(value ?? '')} aria-label="Value" onChange={(e) => onChange(e.target.value || null)} className={cls}>
          <option value="">Choose…</option>
          {(prop.config.options ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      );
    case 'checkbox':
      return (
        <select value={value === false ? 'false' : 'true'} aria-label="Value" onChange={(e) => onChange(e.target.value === 'true')} className={cls}>
          <option value="true">Checked</option>
          <option value="false">Unchecked</option>
        </select>
      );
    case 'date':
    case 'created_time':
    case 'edited_time':
      // "Today" is resolved when the query runs, so a view (or a schedule) keeps meaning today.
      return (
        <span className="flex min-w-[140px] flex-1 gap-1">
          <select
            value={value === DYNAMIC_TODAY ? 'today' : 'date'}
            aria-label="Date"
            onChange={(e) => onChange(e.target.value === 'today' ? DYNAMIC_TODAY : null)}
            className={`${field} w-[84px] shrink-0`}
          >
            <option value="date">Date</option>
            <option value="today">Today</option>
          </select>
          {value !== DYNAMIC_TODAY && (
            <input type="date" aria-label="Value" value={String(value ?? '')} onChange={(e) => onChange(e.target.value || null)} className={`${cls} [color-scheme:dark]`} />
          )}
        </span>
      );
    default: {
      // Typing re-queries; commit on a short pause rather than every key.
      const commit = (/** @type {string} */ t) => onChange(type === 'number' ? (t.trim() === '' ? null : Number(t)) : t);
      return (
        <input
          aria-label="Value"
          value={text}
          placeholder="Value"
          inputMode={type === 'number' ? 'decimal' : undefined}
          onChange={(e) => {
            setText(e.target.value);
            debounce(() => commit(e.target.value));
          }}
          onBlur={() => commit(text)}
          onKeyDown={(e) => e.stopPropagation()}
          className={cls}
        />
      );
    }
  }
}

/**
 * One row of the relation's target database, picked like a relation cell.
 * @param {{ prop: import('./context.js').Property, value: string | null, onChange: (v: string | null) => void }} props
 */
function RelationFilterValue({ prop, value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(/** @type {HTMLButtonElement | null} */ (null));
  if (!prop.config.databaseId) return <span className="flex-1 px-2 text-[13px] text-muted">Not linked yet</span>;
  return (
    <>
      <button ref={ref} type="button" aria-label="Value" onClick={() => setOpen(true)} className={`${field} flex min-w-0 flex-1 items-center text-left`}>
        {value ? <RefChip id={value} /> : <span className="text-muted">Choose…</span>}
      </button>
      {open && (
        <Popover anchor={ref.current} onClose={() => setOpen(false)} width={280}>
          <RelationPicker
            single
            prop={prop}
            value={value ? [value] : null}
            onChange={(ids) => {
              onChange(ids?.[0] ?? null);
              setOpen(false);
            }}
          />
        </Popover>
      )}
    </>
  );
}

let timer = 0;
/** @param {() => void} fn */
function debounce(fn) {
  clearTimeout(timer);
  timer = window.setTimeout(fn, 300);
}

/** Show/hide properties in this view. @param {{ anchor: HTMLElement | null, onClose: () => void }} props */
function PropertiesMenu({ anchor, onClose }) {
  const { properties, view, setConfig, m } = useDb();
  const ordered = orderedProperties(properties, view.config);
  const hidden = view.config.hidden;
  const [adding, setAdding] = useState('');

  return (
    <Popover anchor={anchor} onClose={onClose} width={260} align="end">
      <div className={menuLabel}>Properties in this view</div>
      {ordered.length === 0 && <div className="px-2 py-1 text-[13px] text-muted">No properties yet.</div>}
      {ordered.map((p) => {
        const shown = !hidden.includes(p.id);
        return (
          <button
            key={p.id}
            type="button"
            className={menuItem}
            onClick={() => setConfig({ hidden: shown ? [...hidden, p.id] : hidden.filter((id) => id !== p.id) })}
          >
            <TypeIcon type={p.type} />
            <span className={`flex-1 truncate ${shown ? '' : 'text-faint'}`}>{p.name}</span>
            <Icon path={shown ? ICONS.eye : ICONS.eyeOff} />
          </button>
        );
      })}
      <div className="my-1 h-px bg-line" />
      <div className="p-1">
        <input
          value={adding}
          placeholder="New text property…"
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && adding.trim()) {
              m.addProperty({ name: adding.trim(), type: 'text' });
              setAdding('');
            }
          }}
          className={field}
        />
      </div>
    </Popover>
  );
}

/**
 * @param {{ value: string, options: import('./context.js').Property[], onChange: (id: string) => void }} props
 */
function PropSelect({ value, options, onChange }) {
  return (
    <select value={value} aria-label="Property" onChange={(e) => onChange(e.target.value)} className={`${field} w-[130px] max-w-[130px] shrink-0`}>
      {options.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

/** @param {{ label: string, onClick: () => void }} props */
function RemoveButton({ label, onClick }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="flex size-7 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-fg">
      <Icon path={ICONS.x} size={12} />
    </button>
  );
}
