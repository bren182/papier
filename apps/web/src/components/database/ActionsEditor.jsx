import { ACTIONS_FOR, MAX_ACTIONS, THIS_ROW } from '@papier/core/actions';
import { DYNAMIC_TODAY } from '@papier/core/props';
import { useDatabase, useDatabaseList } from '../../api/databases.js';
import { ValueCell } from './cells.jsx';
import { Icon, ICONS } from './meta.jsx';
import { field, menuLabel } from './Popover.jsx';

/**
 * Edit a list of actions (see @papier/core actions.js): what a button or an
 * automation does. Row actions pick a property of `properties` (the database
 * the button/automation lives on); a row-less list can only add rows.
 *
 * @typedef {import('../../api/databases.js').Property} Property
 * @typedef {import('@papier/core/actions').Action} Action
 */

export const ACTION_LABELS = /** @type {Record<string, string>} */ ({
  set: 'Set a property',
  set_today: 'Set a date to today',
  shift_date: 'Move a date',
  check: 'Check or uncheck',
  add_number: 'Add to a number',
  link: 'Link or unlink rows',
  add_row: 'Add a row to a database',
});

const UNITS = [
  ['day', 'days'],
  ['week', 'weeks'],
  ['month', 'months'],
  ['year', 'years'],
];

/** A cell stub for editing a value outside a row. */
const NO_ROW = { createdAt: 0, updatedAt: 0 };
const noOptions = async () => undefined;

/**
 * @param {{ actions: Action[], onChange: (actions: Action[]) => void, properties: Property[], rowless?: boolean }} props
 */
export function ActionsEditor({ actions, onChange, properties, rowless = false }) {
  /** @param {number} i @param {Action | null} next  null removes it */
  const update = (i, next) => onChange(next ? actions.map((a, j) => (j === i ? next : a)) : actions.filter((_, j) => j !== i));
  /** @param {number} i @param {-1 | 1} by */
  const move = (i, by) => {
    const next = [...actions];
    const [a] = next.splice(i, 1);
    next.splice(i + by, 0, /** @type {Action} */ (a));
    onChange(next);
  };
  const types = rowless ? ['add_row'] : Object.keys(ACTION_LABELS);

  return (
    <div className="flex flex-col gap-1.5" aria-label="Actions">
      {actions.map((a, i) => (
        <div key={i} className="rounded-md border border-line p-1.5" data-action={a.type}>
          <div className="flex items-center gap-1">
            <span className="flex-1 truncate px-1 text-[12px] font-medium text-muted">
              {i + 1}. {ACTION_LABELS[a.type]}
            </span>
            <MiniButton label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
              ↑
            </MiniButton>
            <MiniButton label="Move down" disabled={i === actions.length - 1} onClick={() => move(i, 1)}>
              ↓
            </MiniButton>
            <MiniButton label="Remove action" onClick={() => update(i, null)}>
              <Icon path={ICONS.x} size={12} />
            </MiniButton>
          </div>
          <div className="mt-1 flex flex-col gap-1">
            {a.type === 'add_row' ? (
              <AddRowFields action={a} rowless={rowless} onChange={(next) => update(i, next)} />
            ) : (
              <RowActionFields action={a} properties={properties} onChange={(next) => update(i, next)} />
            )}
          </div>
        </div>
      ))}
      {actions.length < MAX_ACTIONS && (
        <label className="flex items-center gap-2">
          <select
            value=""
            aria-label="Add an action"
            onChange={(e) => e.target.value && onChange([...actions, newAction(e.target.value, properties)])}
            className={field}
          >
            <option value="">+ Add an action…</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {ACTION_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
      )}
      {rowless && <div className="px-1 text-[12px] text-muted">This button isn’t on a database row, so it can only add rows.</div>}
    </div>
  );
}

/** @param {{ label: string, onClick: () => void, disabled?: boolean, children: import('react').ReactNode }} props */
function MiniButton({ label, onClick, disabled, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-6 shrink-0 items-center justify-center rounded text-[12px] text-muted hover:bg-hover hover:text-fg disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/** A fresh action of a type, pointed at the first property it fits. @param {string} type @param {Property[]} properties @returns {Action} */
function newAction(type, properties) {
  if (type === 'add_row') return { type: 'add_row', databaseId: '', values: {} };
  const propId = properties.find((p) => ACTIONS_FOR[p.type]?.includes(type))?.id ?? '';
  switch (type) {
    case 'set_today':
      return { type, propId };
    case 'shift_date':
      return { type, propId, amount: 1, unit: 'day', from: 'value' };
    case 'check':
      return { type, propId, to: 'toggle' };
    case 'add_number':
      return { type, propId, amount: 1 };
    case 'link':
      return { type, propId, rowIds: [], mode: 'add' };
    default:
      return { type: 'set', propId, value: null };
  }
}

/**
 * The property and the value/amount of a row action.
 * @param {{ action: Exclude<Action, { type: 'add_row' }>, properties: Property[], onChange: (a: Action) => void }} props
 */
function RowActionFields({ action, properties, onChange }) {
  const fits = properties.filter((p) => ACTIONS_FOR[p.type]?.includes(action.type));
  const prop = fits.find((p) => p.id === action.propId);
  /** @param {object} patch */
  const set = (patch) => onChange(/** @type {Action} */ ({ ...action, ...patch }));

  return (
    <>
      <select
        value={prop?.id ?? ''}
        aria-label="Property"
        onChange={(e) => set({ propId: e.target.value, ...(action.type === 'set' ? { value: null } : {}), ...(action.type === 'link' ? { rowIds: [] } : {}) })}
        className={field}
      >
        <option value="">{fits.length ? 'Choose a property…' : 'No property fits'}</option>
        {fits.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {prop && action.type === 'set' && (
        <Value prop={prop} value={action.value} onChange={(value) => set({ value })} />
      )}
      {prop && action.type === 'shift_date' && (
        <div className="flex items-center gap-1">
          <input
            type="number"
            aria-label="Amount"
            value={action.amount}
            onChange={(e) => set({ amount: Math.trunc(Number(e.target.value)) || 0 })}
            onKeyDown={(e) => e.stopPropagation()}
            className={`${field} w-16`}
          />
          <select value={action.unit} aria-label="Unit" onChange={(e) => set({ unit: e.target.value })} className={field}>
            {UNITS.map(([u, label]) => (
              <option key={u} value={u}>
                {label}
              </option>
            ))}
          </select>
          <select value={action.from} aria-label="From" onChange={(e) => set({ from: e.target.value })} className={field}>
            <option value="value">from its date</option>
            <option value="today">from today</option>
          </select>
        </div>
      )}
      {prop && action.type === 'check' && (
        <select value={String(action.to)} aria-label="To" onChange={(e) => set({ to: e.target.value === 'toggle' ? 'toggle' : e.target.value === 'true' })} className={field}>
          <option value="toggle">Toggle</option>
          <option value="true">Check</option>
          <option value="false">Uncheck</option>
        </select>
      )}
      {prop && action.type === 'add_number' && (
        <input
          type="number"
          aria-label="Amount"
          value={action.amount}
          onChange={(e) => set({ amount: Number(e.target.value) || 0 })}
          onKeyDown={(e) => e.stopPropagation()}
          className={field}
        />
      )}
      {prop && action.type === 'link' && (
        <div className="flex items-center gap-1">
          <select value={action.mode} aria-label="Mode" onChange={(e) => set({ mode: e.target.value })} className={`${field} w-24`}>
            <option value="add">Link</option>
            <option value="remove">Unlink</option>
          </select>
          <Value prop={prop} value={action.rowIds} onChange={(ids) => set({ rowIds: Array.isArray(ids) ? ids : [] })} />
        </div>
      )}
    </>
  );
}

/** A value editor for a property, outside any row ("Today ↻" allowed for dates). @param {{ prop: Property, value: unknown, onChange: (v: unknown) => void }} props */
function Value({ prop, value, onChange }) {
  return (
    <ValueCell
      prop={prop}
      value={value ?? undefined}
      row={NO_ROW}
      template
      wrap
      placeholder="Empty"
      onChange={onChange}
      onAddOption={noOptions}
      className={`${field} h-auto min-h-7 py-1`}
    />
  );
}

/**
 * Which database, which template, and values for the new row.
 * @param {{ action: Extract<Action, { type: 'add_row' }>, rowless: boolean, onChange: (a: Action) => void }} props
 */
function AddRowFields({ action, rowless, onChange }) {
  const { data: databases = [] } = useDatabaseList('');
  /** @param {object} patch */
  const set = (patch) => onChange(/** @type {Action} */ ({ ...action, ...patch }));
  return (
    <>
      <select
        value={action.databaseId}
        aria-label="Database"
        onChange={(e) => set({ databaseId: e.target.value, templateId: null, values: {} })}
        className={field}
      >
        <option value="">Choose a database…</option>
        {databases.map((d) => (
          <option key={d.id} value={d.id}>
            {d.title || 'Untitled'}
          </option>
        ))}
      </select>
      {action.databaseId && <AddRowTarget action={action} rowless={rowless} set={set} />}
    </>
  );
}

/** @param {{ action: Extract<Action, { type: 'add_row' }>, rowless: boolean, set: (patch: object) => void }} props */
function AddRowTarget({ action, rowless, set }) {
  const { data } = useDatabase(action.databaseId);
  const props = (data?.properties ?? []).filter((p) => ACTIONS_FOR[p.type]?.includes('set'));
  const values = action.values ?? {};
  const unset = props.filter((p) => !(p.id in values));
  /** @param {string} propId @param {unknown} value  undefined removes it */
  const setValue = (propId, value) => {
    const next = { ...values };
    if (value === undefined) delete next[propId];
    else next[propId] = value;
    set({ values: next });
  };

  return (
    <>
      <input
        value={action.title ?? ''}
        placeholder="Title (optional)"
        aria-label="Title"
        onChange={(e) => set({ title: e.target.value })}
        onKeyDown={(e) => e.stopPropagation()}
        className={field}
      />
      {(data?.templates.length ?? 0) > 0 && (
        <select value={action.templateId ?? ''} aria-label="Template" onChange={(e) => set({ templateId: e.target.value || null })} className={field}>
          <option value="">No template</option>
          {data?.templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title || 'Untitled template'}
            </option>
          ))}
        </select>
      )}
      {Object.keys(values).length > 0 && <div className={`${menuLabel} px-0`}>Values</div>}
      {props
        .filter((p) => p.id in values)
        .map((p) => {
          const raw = values[p.id];
          const linksThis = Array.isArray(raw) && raw.includes(THIS_ROW);
          const shown = Array.isArray(raw) ? raw.filter((id) => id !== THIS_ROW) : raw;
          return (
            <div key={p.id} className="flex items-start gap-1">
              <span className="w-24 shrink-0 truncate pt-1.5 text-[12px] text-muted">{p.name}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Value
                  prop={p}
                  value={shown}
                  onChange={(v) => setValue(p.id, p.type === 'relation' && linksThis ? [THIS_ROW, ...(Array.isArray(v) ? v : [])] : v)}
                />
                {p.type === 'relation' && !rowless && (
                  <label className="flex items-center gap-1.5 text-[12px] text-muted">
                    <input
                      type="checkbox"
                      checked={linksThis}
                      onChange={() => {
                        const ids = Array.isArray(shown) ? shown : [];
                        setValue(p.id, linksThis ? ids : [THIS_ROW, ...ids]);
                      }}
                    />
                    Link to this row
                  </label>
                )}
              </div>
              <MiniButton label={`Don’t set ${p.name}`} onClick={() => setValue(p.id, undefined)}>
                <Icon path={ICONS.x} size={12} />
              </MiniButton>
            </div>
          );
        })}
      {unset.length > 0 && (
        <select
          value=""
          aria-label="Set a property"
          onChange={(e) => e.target.value && setValue(e.target.value, props.find((p) => p.id === e.target.value)?.type === 'date' ? DYNAMIC_TODAY : null)}
          className={field}
        >
          <option value="">+ Set a property…</option>
          {unset.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
    </>
  );
}
