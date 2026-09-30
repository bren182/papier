import { useEffect, useMemo, useState } from 'react';
import { rollupResultType } from '@papier/core/props';
import { useRows } from '../../api/databases.js';
import { toISODate } from '../../editor/dates.js';
import { TitleText } from '../TitleText.jsx';
import { DB_DRAG_TYPE, useDb } from './context.js';
import { Icon, ICONS } from './meta.jsx';
import { field, menuItem, menuLabel, Popover } from './Popover.jsx';

/**
 * Rows on a month grid by a date: a date property, created/edited time, or a
 * date rollup. Drag a card to another day to change its date (date
 * properties only), "+" on a day adds a row on it.
 *
 * @typedef {import('../../api/databases.js').Row} Row
 * @typedef {import('./context.js').Property} Property
 */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** Most rows one month loads. */
const MAX_ROWS = 1000;
/** Cards a day shows before "+N more". */
const PER_DAY = 3;

/** @param {Property} p */
const isDateLike = (p) =>
  p.type === 'date' || p.type === 'created_time' || p.type === 'edited_time' || (p.type === 'rollup' && rollupResultType(p.config.fn ?? undefined) === 'date');

/** The local calendar day of a row on `prop`, or null. @param {Row} row @param {Property} prop */
function dayOf(row, prop) {
  if (prop.type === 'created_time') return toISODate(new Date(row.createdAt));
  if (prop.type === 'edited_time') return toISODate(new Date(row.updatedAt));
  const v = row.props[prop.id];
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/** The weeks (Monday first) covering a month, as ISO dates. @param {number} y @param {number} m 0-based */
function monthGrid(y, m) {
  const first = new Date(y, m, 1);
  const start = new Date(y, m, 1 - ((first.getDay() + 6) % 7));
  const last = new Date(y, m + 1, 0);
  const days = [];
  for (let d = new Date(start); d <= last || days.length % 7 !== 0; d.setDate(d.getDate() + 1)) days.push(toISODate(d));
  return days;
}

/** @param {{ onNewRow: (values?: Record<string, unknown>) => void }} props */
export function CalendarView({ onNewRow }) {
  const { dbId, properties, view, setConfig, m, openRow } = useDb();
  const dateProps = properties.filter(isDateLike);
  const dateBy = dateProps.find((p) => p.id === view.config.dateBy) ?? dateProps[0] ?? null;
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const days = useMemo(() => monthGrid(month.y, month.m), [month]);
  const from = days[0] ?? '';
  const to = days[days.length - 1] ?? '';
  const today = toISODate(new Date());
  const writable = dateBy?.type === 'date';

  const q = useRows(
    dbId,
    {
      sorts: dateBy ? [{ propId: dateBy.id, dir: 'asc' }] : [],
      filters: dateBy
        ? [...view.config.filters, { propId: dateBy.id, op: 'on_or_after', value: from }, { propId: dateBy.id, op: 'on_or_before', value: to }]
        : view.config.filters,
      limit: 200,
    },
    { enabled: Boolean(dateBy) },
  );
  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.rows) ?? [], [q.data]);
  // A month is small: load it all (up to MAX_ROWS).
  useEffect(() => {
    if (q.hasNextPage && !q.isFetchingNextPage && rows.length < MAX_ROWS) q.fetchNextPage();
  }, [q, rows.length]);
  const undated = useRows(dbId, { filters: dateBy ? [...view.config.filters, { propId: dateBy.id, op: 'is_empty' }] : [], limit: 50 }, { enabled: writable });

  const byDay = useMemo(() => {
    /** @type {Map<string, Row[]>} */
    const out = new Map();
    if (dateBy) for (const r of rows) {
      const d = dayOf(r, dateBy);
      if (d) out.set(d, [...(out.get(d) ?? []), r]);
    }
    return out;
  }, [rows, dateBy]);

  const [more, setMore] = useState(/** @type {{ day: string, el: HTMLElement } | null} */ (null));
  const [noDate, setNoDate] = useState(/** @type {HTMLElement | null} */ (null));
  const [dropDay, setDropDay] = useState(/** @type {string | null} */ (null));

  if (!dateBy) return <p className="py-6 text-[14px] text-muted">Add a date property to see rows on a calendar.</p>;

  const title = new Date(month.y, month.m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  /** @param {number} by */
  const shift = (by) => setMonth(({ y, m: mm }) => ({ y: mm + by < 0 ? y - 1 : mm + by > 11 ? y + 1 : y, m: (mm + by + 12) % 12 }));
  const undatedCount = undated.data?.pages[0]?.total ?? 0;

  /** @param {Row} row */
  const card = (row) => (
    <button
      key={row.id}
      type="button"
      draggable={writable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData(DB_DRAG_TYPE, row.id);
        e.dataTransfer.setData('text/plain', row.title || 'Untitled');
      }}
      onClick={() => openRow(row.id)}
      data-row-id={row.id}
      className="flex h-6 w-full min-w-0 items-center gap-1 rounded border border-line bg-s-sidebar px-1.5 text-left text-[12px] text-fg-strong hover:bg-hover"
    >
      {row.icon && <span>{row.icon}</span>}
      <span className="truncate">
        <TitleText title={row.title} titleContent={row.titleContent} />
      </span>
    </button>
  );

  return (
    <div className="flex flex-col gap-2" aria-label="Calendar">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-[160px] text-[15px] font-medium text-fg-strong">{title}</h3>
        <button type="button" aria-label="Previous month" onClick={() => shift(-1)} className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover">
          ‹
        </button>
        <button
          type="button"
          onClick={() => {
            const d = new Date();
            setMonth({ y: d.getFullYear(), m: d.getMonth() });
          }}
          className="h-7 rounded-md px-2 text-[13px] text-muted hover:bg-hover hover:text-fg"
        >
          Today
        </button>
        <button type="button" aria-label="Next month" onClick={() => shift(1)} className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover">
          ›
        </button>
        <span className="flex-1" />
        {writable && undatedCount > 0 && (
          <button type="button" onClick={(e) => setNoDate(e.currentTarget)} className="h-7 rounded-md px-2 text-[13px] text-muted hover:bg-hover hover:text-fg">
            No date ({undatedCount})
          </button>
        )}
        <label className="flex items-center gap-1.5 text-[13px] whitespace-nowrap text-muted">
          Date by
          <select value={dateBy.id} aria-label="Date by" onChange={(e) => setConfig({ dateBy: e.target.value })} className={`${field} w-auto`}>
            {dateProps.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-7 border-t border-l border-line text-[12px]">
        {WEEKDAYS.map((d) => (
          <div key={d} className="border-r border-b border-line px-2 py-1 text-faint">
            {d}
          </div>
        ))}
        {days.map((day) => {
          const list = byDay.get(day) ?? [];
          const inMonth = Number(day.slice(5, 7)) - 1 === month.m;
          return (
            <div
              key={day}
              data-day={day}
              onDragOver={(e) => {
                if (!writable || !e.dataTransfer.types.includes(DB_DRAG_TYPE)) return;
                e.preventDefault();
                if (dropDay !== day) setDropDay(day);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(/** @type {Node | null} */ (e.relatedTarget))) setDropDay(null);
              }}
              onDrop={(e) => {
                setDropDay(null);
                const id = e.dataTransfer.getData(DB_DRAG_TYPE);
                if (!writable || !id) return;
                e.preventDefault();
                m.setProps(id, { [dateBy.id]: day });
              }}
              className={`group/day flex min-h-[112px] flex-col gap-1 border-r border-b border-line p-1 ${inMonth ? '' : 'bg-black/10'} ${dropDay === day ? 'bg-accent-soft' : ''}`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1 ${day === today ? 'bg-accent font-medium text-[#141414]' : inMonth ? 'text-muted' : 'text-faint'}`}
                >
                  {Number(day.slice(8))}
                </span>
                {writable && (
                  <button
                    type="button"
                    aria-label={`New on ${day}`}
                    onClick={() => onNewRow({ [dateBy.id]: day })}
                    className="flex size-5 items-center justify-center rounded text-faint opacity-0 group-hover/day:opacity-100 hover:bg-hover hover:text-fg focus-visible:opacity-100"
                  >
                    <Icon path={ICONS.plus} size={12} />
                  </button>
                )}
              </div>
              {list.slice(0, PER_DAY).map(card)}
              {list.length > PER_DAY && (
                <button type="button" onClick={(e) => setMore({ day, el: e.currentTarget })} className="px-1 text-left text-[12px] text-muted hover:text-fg">
                  +{list.length - PER_DAY} more
                </button>
              )}
            </div>
          );
        })}
      </div>

      {more && (
        <Popover anchor={more.el} onClose={() => setMore(null)} width={240}>
          <div className={menuLabel}>{new Date(`${more.day}T00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          <div className="flex flex-col gap-1 p-1">{(byDay.get(more.day) ?? []).map(card)}</div>
        </Popover>
      )}
      {noDate && (
        <Popover anchor={noDate} onClose={() => setNoDate(null)} width={260} align="end">
          <div className={menuLabel}>No {dateBy.name}</div>
          {(undated.data?.pages.flatMap((p) => p.rows) ?? []).map((r) => (
            <button key={r.id} type="button" className={menuItem} onClick={() => openRow(r.id)}>
              <span className="truncate">
                <TitleText title={r.title} titleContent={r.titleContent} />
              </span>
            </button>
          ))}
        </Popover>
      )}
    </div>
  );
}
