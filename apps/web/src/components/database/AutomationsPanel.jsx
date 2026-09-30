import { useEffect, useRef, useState } from 'react';
import { filterOps } from '@papier/core/props';
import { useAutomationMutations, useAutomations } from '../../api/automations.js';
import { showToast } from '../../toast.js';
import { ActionsEditor } from './ActionsEditor.jsx';
import { TITLE, useDb } from './context.js';
import { Icon, ICONS } from './meta.jsx';
import { field, menuItem, menuLabel, Popover } from './Popover.jsx';
import { ConditionRow } from './Toolbar.jsx';

/**
 * A database's automations: a list with on/off switches, and an editor for one
 * ("When … then …"). Edits save after a short pause.
 *
 * @typedef {import('../../api/automations.js').Automation} Automation
 * @typedef {import('../../api/automations.js').Trigger} Trigger
 * @typedef {import('./context.js').Property} Property
 */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Properties whose changes a trigger can watch (not computed, not buttons). */
const watchable = (/** @type {Property[]} */ ps) => ps.filter((p) => !['created_time', 'edited_time', 'rollup', 'button'].includes(p.type));

/** A fresh trigger of a type. @param {Trigger['type']} type @param {Property[]} properties @returns {Trigger} */
function newTrigger(type, properties) {
  if (type === 'row_added') return { type };
  if (type === 'prop_changed') return { type, propId: watchable(properties)[0]?.id ?? TITLE.id, when: null };
  return { type: 'schedule', every: 'day', at: '09:00', weekday: 1, monthday: 1, rows: 'matching', filters: [] };
}

/** "When Done changes", "Every Monday at 09:00". @param {Trigger} t @param {Property[]} properties */
export function describeTrigger(t, properties) {
  if (t.type === 'row_added') return 'When a row is added';
  if (t.type === 'prop_changed') return `When ${properties.find((p) => p.id === t.propId)?.name ?? 'a property'} changes${t.when ? ' (with a condition)' : ''}`;
  const when = t.every === 'day' ? 'Every day' : t.every === 'week' ? `Every ${WEEKDAYS[t.weekday]}` : `Monthly on day ${t.monthday}`;
  return `${when} at ${t.at}`;
}

/** "5 min ago", "2 h ago", "3 days ago". @param {number} ms */
function ago(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} days ago`;
}

/** @param {{ anchor: HTMLElement | null, onClose: () => void }} props */
export function AutomationsPanel({ anchor, onClose }) {
  const { dbId, properties } = useDb();
  const { data: list = [] } = useAutomations(dbId);
  const m = useAutomationMutations(dbId);
  const [editing, setEditing] = useState(/** @type {string | null} */ (null));
  const current = list.find((a) => a.id === editing);

  return (
    <Popover anchor={anchor} onClose={onClose} width={480} align="end">
      {current ? (
        <AutomationEditor key={current.id} auto={current} properties={properties} m={m} onBack={() => setEditing(null)} />
      ) : (
        <div aria-label="Automations">
          <div className={menuLabel}>Automations</div>
          {list.length === 0 && (
            <div className="px-2 pb-1.5 text-[13px] text-muted">
              Make this database do things by itself: when a row is added, when a property changes, or on a schedule.
            </div>
          )}
          {list.map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-hover">
              <input
                type="checkbox"
                checked={a.enabled}
                aria-label={`${a.enabled ? 'Turn off' : 'Turn on'} ${a.name}`}
                onChange={() => m.update(a.id, { enabled: !a.enabled })}
                className="accent-[var(--p-accent)]"
              />
              <button type="button" onClick={() => setEditing(a.id)} className="flex min-w-0 flex-1 flex-col text-left">
                <span className={`truncate text-[13px] ${a.enabled ? 'text-fg' : 'text-muted'}`}>{a.name}</span>
                <span className="truncate text-[12px] text-muted">
                  {describeTrigger(a.trigger, properties)}
                  {a.lastError ? ' · failed last time' : a.lastRunAt ? ` · ran ${ago(a.lastRunAt)}` : ''}
                </span>
              </button>
            </div>
          ))}
          <div className="my-1 h-px bg-line" />
          <button
            type="button"
            className={menuItem}
            onClick={async () => {
              const type = watchable(properties).length ? 'prop_changed' : 'row_added';
              const a = await m.create({ name: 'New automation', trigger: newTrigger(type, properties), actions: [] });
              setEditing(a.id);
            }}
          >
            <Icon path={ICONS.plus} /> New automation
          </button>
        </div>
      )}
    </Popover>
  );
}

/**
 * One automation: name, trigger, actions. Kept as a local draft, saved after a pause.
 * @param {{ auto: Automation, properties: Property[], m: ReturnType<typeof useAutomationMutations>, onBack: () => void }} props
 */
function AutomationEditor({ auto, properties, m, onBack }) {
  const [draft, setDraft] = useState({ name: auto.name, trigger: auto.trigger, actions: auto.actions });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pending = useRef(/** @type {Partial<typeof draft> | null} */ (null));
  const timer = useRef(0);
  const save = () => {
    clearTimeout(timer.current);
    const patch = pending.current;
    pending.current = null;
    if (patch) m.update(auto.id, patch).catch((err) => showToast({ text: err.message, tone: 'error' }));
  };
  /** @param {Partial<typeof draft>} patch */
  const edit = (patch) => {
    setDraft((d) => ({ ...d, ...patch }));
    pending.current = { ...pending.current, ...patch };
    clearTimeout(timer.current);
    timer.current = window.setTimeout(save, 400);
  };
  // Leaving the editor (or the panel) saves what's pending.
  useEffect(() => () => save(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const t = draft.trigger;
  /** @param {Partial<Trigger>} patch */
  const setTrigger = (patch) => edit({ trigger: /** @type {Trigger} */ ({ ...t, ...patch }) });
  const all = [TITLE, ...properties];
  const rowless = t.type === 'schedule' && t.rows === 'none';

  return (
    <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto p-1" aria-label="Automation">
      <div className="flex items-center gap-1">
        <button type="button" aria-label="Back to automations" onClick={onBack} className="flex size-7 items-center justify-center rounded text-muted hover:bg-hover hover:text-fg">
          ←
        </button>
        <input
          value={draft.name}
          aria-label="Automation name"
          onChange={(e) => edit({ name: e.target.value || 'Automation' })}
          onKeyDown={(e) => e.stopPropagation()}
          className={field}
        />
        <label className="flex shrink-0 items-center gap-1.5 px-1 text-[12px] text-muted">
          <input type="checkbox" checked={auto.enabled} onChange={() => m.update(auto.id, { enabled: !auto.enabled })} className="accent-[var(--p-accent)]" />
          On
        </label>
      </div>

      <section className="flex flex-col gap-1">
        <div className={menuLabel}>When</div>
        <select value={t.type} aria-label="Trigger" onChange={(e) => edit({ trigger: newTrigger(/** @type {Trigger['type']} */ (e.target.value), properties) })} className={field}>
          <option value="row_added">A row is added</option>
          <option value="prop_changed">A property changes</option>
          <option value="schedule">On a schedule</option>
        </select>

        {t.type === 'prop_changed' && (
          <>
            <select value={t.propId} aria-label="Watched property" onChange={(e) => setTrigger({ propId: e.target.value, when: null })} className={field}>
              {[TITLE, ...watchable(properties)].map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {t.when ? (
              <div className="rounded-md border border-line">
                <div className="px-2 pt-1 text-[12px] text-muted">…and afterwards</div>
                <ConditionRow filter={t.when} properties={all} onChange={(patch) => t.when && setTrigger({ when: { ...t.when, ...patch } })} onRemove={() => setTrigger({ when: null })} />
              </div>
            ) : (
              <button
                type="button"
                className={menuItem}
                onClick={() => {
                  const prop = all.find((p) => p.id === t.propId);
                  setTrigger({ when: { propId: t.propId, op: filterOps(prop)[0] ?? 'is', value: prop?.type === 'checkbox' ? true : undefined } });
                }}
              >
                <Icon path={ICONS.plus} /> Only when it becomes…
              </button>
            )}
          </>
        )}

        {t.type === 'schedule' && (
          <>
            <div className="flex items-center gap-1">
              <select value={t.every} aria-label="Every" onChange={(e) => setTrigger({ every: /** @type {'day' | 'week' | 'month'} */ (e.target.value) })} className={field}>
                <option value="day">Every day</option>
                <option value="week">Every week</option>
                <option value="month">Every month</option>
              </select>
              {t.every === 'week' && (
                <select value={t.weekday} aria-label="Weekday" onChange={(e) => setTrigger({ weekday: Number(e.target.value) })} className={field}>
                  {WEEKDAYS.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              )}
              {t.every === 'month' && (
                <input
                  type="number"
                  min={1}
                  max={31}
                  aria-label="Day of the month"
                  value={t.monthday}
                  onChange={(e) => setTrigger({ monthday: Math.min(31, Math.max(1, Math.trunc(Number(e.target.value)) || 1)) })}
                  onKeyDown={(e) => e.stopPropagation()}
                  className={`${field} w-16`}
                />
              )}
              <input
                type="time"
                aria-label="At"
                value={t.at}
                onChange={(e) => e.target.value && setTrigger({ at: e.target.value })}
                className={`${field} w-28 [color-scheme:dark]`}
              />
            </div>
            <select value={t.rows} aria-label="Rows" onChange={(e) => setTrigger({ rows: /** @type {'matching' | 'none'} */ (e.target.value) })} className={field}>
              <option value="matching">For each row where…</option>
              <option value="none">Once (not for rows)</option>
            </select>
            {t.rows === 'matching' && (
              <div className="rounded-md border border-line py-0.5">
                {t.filters.length === 0 && <div className="px-2 py-1 text-[12px] text-muted">Every row. Add a condition to narrow it down.</div>}
                {t.filters.map((f, i) => (
                  <ConditionRow
                    key={i}
                    filter={f}
                    properties={all}
                    onChange={(patch) => setTrigger({ filters: t.filters.map((x, j) => (j === i ? { ...x, ...patch } : x)) })}
                    onRemove={() => setTrigger({ filters: t.filters.filter((_, j) => j !== i) })}
                  />
                ))}
                <button type="button" className={menuItem} onClick={() => setTrigger({ filters: [...t.filters, { propId: TITLE.id, op: 'contains', value: '' }] })}>
                  <Icon path={ICONS.plus} /> Add a condition
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <section className="flex flex-col gap-1">
        <div className={menuLabel}>Then</div>
        <ActionsEditor actions={draft.actions} properties={properties} rowless={rowless} onChange={(actions) => edit({ actions })} />
      </section>

      <div className="flex flex-wrap items-center gap-2 border-t border-line px-1 pt-2 text-[12px] text-muted">
        <span className="min-w-0 flex-1">
          {auto.lastError ? (
            <span className="text-fg-strong">Last run failed: {auto.lastError}</span>
          ) : auto.lastRunAt ? (
            `Ran ${ago(auto.lastRunAt)}`
          ) : (
            'Hasn’t run yet'
          )}
          {auto.nextRunAt && auto.enabled ? ` · next ${new Date(auto.nextRunAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}
        </span>
        {t.type === 'schedule' && (
          <button
            type="button"
            className="rounded-md border border-line px-2 py-1 text-fg hover:bg-hover"
            onClick={async () => {
              save();
              try {
                const res = await m.runNow(auto.id);
                showToast({ text: res.failed ? `Ran ${res.runs}×, ${res.failed} failed` : res.runs === 1 ? 'Ran once' : `Ran for ${res.runs} rows` });
              } catch (err) {
                showToast({ text: err instanceof Error ? err.message : 'That didn’t work', tone: 'error' });
              }
            }}
          >
            Run now
          </button>
        )}
        <button
          type="button"
          className={`rounded-md px-2 py-1 hover:bg-hover ${confirmDelete ? 'text-fg-strong' : ''}`}
          onClick={async () => {
            if (!confirmDelete) return setConfirmDelete(true);
            pending.current = null;
            clearTimeout(timer.current);
            await m.remove(auto.id);
            onBack();
          }}
        >
          {confirmDelete ? 'Click again to delete' : 'Delete'}
        </button>
      </div>
    </div>
  );
}
