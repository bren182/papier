import { useState } from 'react';
import { toISODate } from '../../editor/dates.js';

/**
 * A small month calendar to pick a day — our own, rather than the browser's
 * native date popup, which lives outside the page (clicks in it looked like
 * clicks outside our popovers and closed them) and ignores the theme.
 * @param {{ value: string | null, onPick: (iso: string) => void }} props
 */
export function MiniCalendar({ value, onPick }) {
  const initial = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00`) : new Date();
  const [month, setMonth] = useState({ y: initial.getFullYear(), m: initial.getMonth() });
  const today = toISODate(new Date());
  const first = new Date(month.y, month.m, 1);
  const start = new Date(month.y, month.m, 1 - ((first.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  /** @param {number} by */
  const shift = (by) => setMonth(({ y, m }) => ({ y: m + by < 0 ? y - 1 : m + by > 11 ? y + 1 : y, m: (m + by + 12) % 12 }));
  const nav = 'flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg';

  return (
    <div className="flex flex-col gap-1 select-none" aria-label="Calendar">
      <div className="flex items-center justify-between px-0.5">
        <button type="button" aria-label="Previous month" className={nav} onClick={() => shift(-1)}>
          ‹
        </button>
        <span className="text-[13px] font-medium text-fg">{first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
        <button type="button" aria-label="Next month" className={nav} onClick={() => shift(1)}>
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] text-faint">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={i} className="py-0.5">
            {d}
          </span>
        ))}
        {days.map((d) => {
          const iso = toISODate(d);
          const inMonth = d.getMonth() === month.m;
          const selected = iso === value;
          return (
            <button
              key={iso}
              type="button"
              aria-label={d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              aria-pressed={selected}
              onClick={() => onPick(iso)}
              className={`m-0.5 flex h-7 items-center justify-center rounded-md text-[12px] ${
                selected
                  ? 'bg-accent font-medium text-[#141414]'
                  : iso === today
                    ? 'text-accent-text ring-1 ring-accent/60 hover:bg-hover'
                    : inMonth
                      ? 'text-fg hover:bg-hover'
                      : 'text-faint hover:bg-hover'
              }`}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
