import { useRef, useState } from 'react';
import { FILTER_OPS, VALUELESS_OPS } from '@papier/core/props';
import { defaultTemplate, orderedProperties, TITLE, useDb } from './context.js';
import { Icon, ICONS, OP_LABELS, TypeIcon } from './meta.jsx';
import { field, menuItem, menuLabel, Popover } from './Popover.jsx';

const toolButton = 'flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted hover:bg-hover hover:text-fg';
const activeTool = 'text-accent-text hover:text-accent-text';

/**
 * Sort, Filter, Properties and New ▾ — the strip above a view.
 * @param {{ onNew: (templateId?: string | null) => void }} props  undefined = the view's default
 */
export function Toolbar({ onNew }) {
  const { view } = useDb();
  const [open, setOpen] = useState(/** @type {'sort' | 'filter' | 'props' | 'new' | null} */ (null));
  const refs = { sort: useRef(null), filter: useRef(null), props: useRef(null), new: useRef(null) };
  const close = () => setOpen(null);
  const { sorts, filters } = view.config;

  return (
    <div className="flex items-center gap-0.5">
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
    </div>
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
      {sorts.map((s, i) => (
        <div key={s.propId} className="flex items-center gap-1 px-1 py-0.5">
          <PropSelect value={s.propId} options={all.filter((p) => p.id === s.propId || !sorts.some((x) => x.propId === p.id))}
            onChange={(propId) => setConfig({ sorts: sorts.map((x, j) => (j === i ? { ...x, propId } : x)) })} />
          <select
            value={s.dir}
            aria-label="Direction"
            onChange={(e) => setConfig({ sorts: sorts.map((x, j) => (j === i ? { ...x, dir: /** @type {'asc' | 'desc'} */ (e.target.value) } : x)) })}
            className={`${field} w-[110px]`}
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
          <RemoveButton label="Remove sort" onClick={() => setConfig({ sorts: sorts.filter((_, j) => j !== i) })} />
        </div>
      ))}
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
      {filters.map((f, i) => {
        const prop = byId.get(f.propId);
        if (!prop) return null;
        const ops = FILTER_OPS[prop.type] ?? [];
        return (
          <div key={i} className="flex items-center gap-1 px-1 py-0.5">
            <PropSelect
              value={f.propId}
              options={all}
              onChange={(propId) => {
                const next = byId.get(propId);
                update(i, { propId, op: FILTER_OPS[next?.type ?? 'text']?.[0] ?? 'is', value: next?.type === 'checkbox' ? true : undefined });
              }}
            />
            <select value={f.op} aria-label="Condition" onChange={(e) => update(i, { op: e.target.value })} className={`${field} w-[130px]`}>
              {ops.map((op) => (
                <option key={op} value={op}>
                  {OP_LABELS[op]}
                </option>
              ))}
            </select>
            {!VALUELESS_OPS.has(f.op) && <FilterValue prop={prop} value={f.value} onChange={(value) => update(i, { value })} />}
            <RemoveButton label="Remove filter" onClick={() => setConfig({ filters: filters.filter((_, j) => j !== i) })} />
          </div>
        );
      })}
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
 * The value box of a filter, typed like its property.
 * @param {{ prop: import('./context.js').Property, value: unknown, onChange: (v: string | number | boolean | null) => void }} props
 */
function FilterValue({ prop, value, onChange }) {
  const [text, setText] = useState(value === undefined || value === null ? '' : String(value));
  const cls = `${field} min-w-0 flex-1`;
  switch (prop.type) {
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
      return <input type="date" aria-label="Value" value={String(value ?? '')} onChange={(e) => onChange(e.target.value || null)} className={`${cls} [color-scheme:dark]`} />;
    default: {
      // Typing re-queries; commit on a short pause rather than every key.
      const commit = (/** @type {string} */ t) => onChange(prop.type === 'number' ? (t.trim() === '' ? null : Number(t)) : t);
      return (
        <input
          aria-label="Value"
          value={text}
          placeholder="Value"
          inputMode={prop.type === 'number' ? 'decimal' : undefined}
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
    <select value={value} aria-label="Property" onChange={(e) => onChange(e.target.value)} className={`${field} w-[130px]`}>
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
