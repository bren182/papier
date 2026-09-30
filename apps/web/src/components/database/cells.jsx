import { useRef, useState } from 'react';
import { DYNAMIC_TODAY, valueToText } from '@papier/core/props';
import { formatDateLong, formatDateMention, parseDateQuery, toISODate } from '../../editor/dates.js';
import { field, menuItem, Popover } from './Popover.jsx';

/**
 * Property values: how each type shows, and how it's edited — shared by the
 * table cells, board cards and a row page's properties panel.
 *
 * @typedef {import('../../api/databases.js').Property} Property
 * @typedef {import('../../api/databases.js').Row} Row
 * @typedef {{
 *   prop: Property,
 *   value: unknown,
 *   row: { createdAt: number, updatedAt: number },
 *   onChange: (value: unknown) => void,
 *   onAddOption: (prop: Property, name: string) => Promise<string | undefined>,
 *   className?: string,
 *   template?: boolean,
 * }} CellProps  template: a template row, whose dates may stay "today"
 */

/** A grey option chip (colour stays behind the glass). @param {{ name: string, onRemove?: () => void }} props */
export function Chip({ name, onRemove }) {
  return (
    <span className="inline-flex h-5 max-w-full shrink-0 items-center gap-1 rounded bg-white/[0.08] px-1.5 text-[12px] leading-5 text-fg">
      <span className="truncate">{name}</span>
      {onRemove && (
        <button type="button" aria-label={`Remove ${name}`} onClick={onRemove} className="text-muted hover:text-fg">
          ×
        </button>
      )}
    </span>
  );
}

/** @param {number} ms */
const formatTime = (ms) =>
  new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * Read-only rendering of a value.
 * @param {{ prop: Property, value: unknown, row: { createdAt: number, updatedAt: number }, wrap?: boolean }} props
 */
export function ValueDisplay({ prop, value, row, wrap = false }) {
  switch (prop.type) {
    case 'created_time':
      return <span className="text-muted">{formatTime(row.createdAt)}</span>;
    case 'edited_time':
      return <span className="text-muted">{formatTime(row.updatedAt)}</span>;
    case 'checkbox':
      return <Check checked={value === true} />;
    case 'select':
    case 'multi_select': {
      const ids = Array.isArray(value) ? value : value ? [value] : [];
      const options = prop.config.options ?? [];
      return (
        <span className={`flex min-w-0 gap-1 ${wrap ? 'flex-wrap' : 'overflow-hidden'}`}>
          {ids.map((id) => {
            const o = options.find((x) => x.id === id);
            return o ? <Chip key={id} name={o.name} /> : null;
          })}
        </span>
      );
    }
    case 'date':
      return typeof value === 'string' ? (
        <time dateTime={value} title={formatDateLong(value)}>
          {formatDateMention(value)}
        </time>
      ) : null;
    case 'url':
      return typeof value === 'string' ? (
        <a
          href={/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(e) => e.stopPropagation()}
          className="truncate text-accent-text underline decoration-white/20 underline-offset-2 hover:decoration-accent"
        >
          {value}
        </a>
      ) : null;
    case 'number':
      return typeof value === 'number' ? (
        <span className="tabular-nums">{prop.config.format === 'percent' ? `${round(value * 100)}%` : value.toLocaleString()}</span>
      ) : null;
    default:
      return value ? <span className={wrap ? 'break-words whitespace-pre-wrap' : 'truncate'}>{valueToText(prop, /** @type {any} */ (value))}</span> : null;
  }
}

/** @param {number} n */
const round = (n) => Math.round(n * 100) / 100;

/** @param {{ checked: boolean }} props */
function Check({ checked }) {
  return (
    <span
      className={`flex size-4 items-center justify-center rounded-[4px] border ${checked ? 'border-accent bg-accent text-[#141414]' : 'border-faint'}`}
    >
      {checked && (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      )}
    </span>
  );
}

/**
 * An editable value: click to edit in place (text, number, URL), toggle
 * (checkbox), or pick from a popover (select, multi-select, date).
 * @param {CellProps & { placeholder?: string, wrap?: boolean }} props
 */
export function ValueCell({ prop, value, row, onChange, onAddOption, className = '', placeholder = '', wrap = false, template = false }) {
  const [editing, setEditing] = useState(false);
  const ref = useRef(/** @type {HTMLDivElement | null} */ (null));
  const readOnly = prop.type === 'created_time' || prop.type === 'edited_time';
  const empty = value === undefined || value === null;

  const open = () => {
    if (readOnly) return;
    if (prop.type === 'checkbox') onChange(value !== true);
    else setEditing(true);
  };

  const inline = prop.type === 'text' || prop.type === 'number' || prop.type === 'url';

  return (
    <div
      ref={ref}
      role={readOnly ? undefined : 'button'}
      tabIndex={readOnly ? undefined : 0}
      data-prop={prop.name}
      onClick={editing && inline ? undefined : open}
      onKeyDown={(e) => {
        if (!editing && (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault();
          open();
        }
      }}
      className={`relative flex min-w-0 items-center ${readOnly ? '' : 'cursor-pointer'} ${className}`}
    >
      {editing && inline ? (
        <InlineInput
          prop={prop}
          value={value}
          onDone={(next) => {
            setEditing(false);
            if (next !== undefined) onChange(next);
            ref.current?.focus();
          }}
        />
      ) : empty && placeholder ? (
        <span className="text-faint">{placeholder}</span>
      ) : (
        <ValueDisplay prop={prop} value={value} row={row} wrap={wrap} />
      )}

      {editing && (prop.type === 'select' || prop.type === 'multi_select') && (
        <Popover anchor={ref.current} onClose={() => setEditing(false)} width={260}>
          <OptionPicker
            prop={prop}
            value={value}
            onChange={(v) => {
              onChange(v);
              if (prop.type === 'select') setEditing(false);
            }}
            onAddOption={onAddOption}
          />
        </Popover>
      )}
      {editing && prop.type === 'date' && (
        <Popover anchor={ref.current} onClose={() => setEditing(false)} width={260}>
          <DatePicker
            template={template}
            value={typeof value === 'string' ? value : null}
            onChange={(v) => {
              onChange(v);
              setEditing(false);
            }}
          />
        </Popover>
      )}
    </div>
  );
}

/**
 * Text/number/URL editing in place. `onDone(undefined)` = cancelled.
 * @param {{ prop: Property, value: unknown, onDone: (v: unknown) => void }} props
 */
function InlineInput({ prop, value, onDone }) {
  const [text, setText] = useState(value === undefined || value === null ? '' : String(value));
  const done = useRef(false);
  /** @param {boolean} save */
  const finish = (save) => {
    if (done.current) return;
    done.current = true;
    if (!save) return onDone(undefined);
    if (prop.type === 'number') {
      const t = text.trim();
      const n = Number(t.replace(/[,\s]/g, ''));
      return onDone(t === '' ? null : Number.isFinite(n) ? n : undefined);
    }
    onDone(text.trim() === '' ? null : text);
  };
  return (
    <input
      autoFocus
      value={text}
      inputMode={prop.type === 'number' ? 'decimal' : undefined}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      }}
      onClick={(e) => e.stopPropagation()}
      className="w-full min-w-0 bg-transparent text-fg outline-none"
    />
  );
}

/**
 * Choose options; typing a new name offers to create it.
 * @param {{ prop: Property, value: unknown, onChange: (v: unknown) => void, onAddOption: CellProps['onAddOption'] }} props
 */
export function OptionPicker({ prop, value, onChange, onAddOption }) {
  const [q, setQ] = useState('');
  const multi = prop.type === 'multi_select';
  const selected = Array.isArray(value) ? /** @type {string[]} */ (value) : value ? [/** @type {string} */ (value)] : [];
  const options = prop.config.options ?? [];
  const query = q.trim().toLowerCase();
  const shown = options.filter((o) => o.name.toLowerCase().includes(query));
  const exact = options.some((o) => o.name.toLowerCase() === query);

  /** @param {string} id */
  const toggle = (id) => {
    if (!multi) return onChange(selected[0] === id ? null : id);
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    onChange(next.length ? next : null);
  };

  const create = async () => {
    const id = await onAddOption(prop, q.trim());
    setQ('');
    if (id) onChange(multi ? [...selected, id] : id);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1 px-1 pt-1">
        {selected.map((id) => {
          const o = options.find((x) => x.id === id);
          return o ? <Chip key={id} name={o.name} onRemove={() => toggle(id)} /> : null;
        })}
      </div>
      <input
        autoFocus
        value={q}
        placeholder={options.length ? 'Search or create…' : 'Create an option…'}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            if (shown.length === 1 || (exact && shown[0])) toggle(/** @type {{ id: string }} */ (shown.find((o) => o.name.toLowerCase() === query) ?? shown[0]).id);
            else if (query && !exact) create();
          }
        }}
        className={field}
      />
      <div className="max-h-[260px] overflow-y-auto">
        {shown.map((o) => (
          <button key={o.id} type="button" className={menuItem} onClick={() => toggle(o.id)}>
            <span className="min-w-0 flex-1">
              <Chip name={o.name} />
            </span>
            {selected.includes(o.id) && <span className="text-accent">✓</span>}
          </button>
        ))}
        {query && !exact && (
          <button type="button" className={menuItem} onClick={create}>
            <span className="text-muted">Create</span>
            <Chip name={q.trim()} />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Type a date the same way as `@` mentions ("tomorrow", "oct 5", "next fri"),
 * or pick one.
 * @param {{ value: string | null, onChange: (v: string | null) => void, template?: boolean }} props
 */
export function DatePicker({ value, onChange, template = false }) {
  const [q, setQ] = useState('');
  const parsed = q.trim() ? parseDateQuery(q) : null;
  const iso = parsed ? toISODate(parsed) : null;
  return (
    <div className="flex flex-col gap-1.5 p-1">
      <input
        autoFocus
        value={q}
        placeholder={value ? formatDateLong(value) : 'Today, next fri, oct 5…'}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && iso) onChange(iso);
        }}
        className={field}
      />
      {q.trim() && (
        <div className="px-1 text-[12px] text-muted">{iso ? formatDateLong(iso) : 'Not a date I know'}</div>
      )}
      <input
        type="date"
        value={value ?? ''}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        className={`${field} [color-scheme:dark]`}
      />
      <div className="flex gap-1">
        <button type="button" className={menuItem} onClick={() => onChange(toISODate(new Date()))}>
          Today
        </button>
        {template && (
          <button type="button" className={menuItem} title={formatDateLong(DYNAMIC_TODAY)} onClick={() => onChange(DYNAMIC_TODAY)}>
            Today ↻
          </button>
        )}
        {value && (
          <button type="button" className={menuItem} onClick={() => onChange(null)}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
