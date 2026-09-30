import { useEffect, useRef, useState } from 'react';
import { ROLLUP_TARGET_TYPES, rollupFns, TITLE_PROP } from '@papier/core/props';
import { useDatabase, useDatabaseList } from '../../api/databases.js';
import { usePage } from '../../api/pages.js';
import { TitleText } from '../TitleText.jsx';
import { ActionsEditor } from './ActionsEditor.jsx';
import { FormulaEditor } from './FormulaEditor.jsx';
import { DatabaseIcon, ROLLUP_LABELS, TYPE_LABELS } from './meta.jsx';
import { field, menuItem, menuLabel } from './Popover.jsx';

/**
 * Settings of relation, rollup, button and formula properties, shown in the property menu (and
 * on a row page right after adding one). They take the mutations as a prop, so
 * they work outside a database view too.
 *
 * @typedef {import('../../api/databases.js').Property} Property
 * @typedef {ReturnType<typeof import('../../api/databases.js').useDatabaseMutations>} Mutations
 */

/**
 * Which database a relation links to, and whether that one shows it too.
 * @param {{ prop: Property, m: Mutations }} props
 */
export function RelationConfig({ prop, m }) {
  const { databaseId, reverseId, reverseOf } = prop.config;
  const [choosing, setChoosing] = useState(!databaseId);
  const [q, setQ] = useState('');
  const { data: found = [] } = useDatabaseList(q.trim());
  const target = usePage(databaseId ?? null).data?.page;
  const targetName = target ? target.title || 'Untitled' : 'the other database';

  if (reverseOf) {
    return (
      <div className="pb-1">
        <div className={menuLabel}>Related to</div>
        <div className="flex items-center gap-2 px-2 py-1 text-[13px] text-fg">
          <DatabaseIcon size={14} />
          <span className="truncate">{target ? <TitleText title={target.title} titleContent={target.titleContent} /> : targetName}</span>
        </div>
        <div className="px-2 pb-1 text-[12px] text-muted">Two-way: its links are edited on either side. Change the database from there.</div>
      </div>
    );
  }

  return (
    <div className="pb-1">
      <div className={menuLabel}>Related to</div>
      {!choosing && (
        <button type="button" className={menuItem} onClick={() => setChoosing(true)}>
          <DatabaseIcon size={14} />
          <span className="min-w-0 flex-1 truncate">{target ? <TitleText title={target.title} titleContent={target.titleContent} /> : 'Choose a database…'}</span>
          <span className="text-muted">Change</span>
        </button>
      )}
      {choosing && (
        <div className="flex flex-col gap-1 px-1">
          <input
            autoFocus
            value={q}
            placeholder="Find a database…"
            aria-label="Find a database"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            className={field}
          />
          <div className="max-h-[200px] overflow-y-auto">
            {found.map((d) => (
              <button
                key={d.id}
                type="button"
                className={menuItem}
                onClick={() => {
                  setChoosing(false);
                  if (d.id !== databaseId) m.updateProperty(prop.id, { config: { databaseId: d.id } });
                }}
              >
                <DatabaseIcon size={14} />
                <span className="min-w-0 flex-1 truncate">
                  <TitleText title={d.title} titleContent={d.titleContent} />
                </span>
                {d.id === databaseId && <span className="text-accent">✓</span>}
              </button>
            ))}
            {!found.length && <div className="px-2 py-1 text-[13px] text-muted">No databases found.</div>}
          </div>
          {databaseId && <div className="px-1 text-[12px] text-muted">Changing it clears this property’s links.</div>}
        </div>
      )}
      {databaseId && (
        <button type="button" className={menuItem} onClick={() => m.updateProperty(prop.id, { config: { twoWay: !reverseId } })}>
          <span className="min-w-0 flex-1 truncate">Show on {targetName}</span>
          {reverseId && <span className="text-accent">✓</span>}
        </button>
      )}
    </div>
  );
}

/**
 * What a rollup aggregates: a relation of this database, a property of the
 * rows it links to, and a function.
 * @param {{ prop: Property, m: Mutations, properties: Property[] }} props
 */
export function RollupConfig({ prop, m, properties }) {
  const relations = properties.filter((p) => p.type === 'relation' && p.config.databaseId);
  const relation = relations.find((r) => r.id === prop.config.relationId);
  /** @param {object} patch */
  const save = (patch) => m.updateProperty(prop.id, { config: { ...prop.config, ...patch } });

  return (
    <div className="flex flex-col gap-1 px-1 pb-1">
      <div className={`${menuLabel} -mx-1`}>Rollup</div>
      {relations.length === 0 ? (
        <div className="px-1 text-[12px] text-muted">Add a relation first: a rollup sums up the rows it links to.</div>
      ) : (
        <label className="flex items-center gap-2 text-[13px] text-muted">
          <span className="w-[64px] shrink-0">Relation</span>
          <select
            value={relation?.id ?? ''}
            aria-label="Relation"
            onChange={(e) => save({ relationId: e.target.value || null, targetPropId: TITLE_PROP, fn: 'count' })}
            className={field}
          >
            <option value="">Choose…</option>
            {relations.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {relation && <RollupTarget prop={prop} targetDb={/** @type {string} */ (relation.config.databaseId)} save={save} />}
    </div>
  );
}

/**
 * The target property and function (the target's schema loads only once a relation is chosen).
 * @param {{ prop: Property, targetDb: string, save: (patch: object) => void }} props
 */
function RollupTarget({ prop, targetDb, save }) {
  const { data } = useDatabase(targetDb);
  const targets = [
    { id: TITLE_PROP, name: 'Name', type: TITLE_PROP },
    ...(data?.properties ?? []).filter((p) => ROLLUP_TARGET_TYPES.has(p.type)),
  ];
  const target = targets.find((t) => t.id === prop.config.targetPropId);
  const fns = target ? rollupFns(target.type) : [];

  return (
    <>
      <label className="flex items-center gap-2 text-[13px] text-muted">
        <span className="w-[64px] shrink-0">Property</span>
        <select
          value={target?.id ?? ''}
          aria-label="Property"
          onChange={(e) => {
            const next = targets.find((t) => t.id === e.target.value);
            const nextFns = next ? rollupFns(next.type) : [];
            save({ targetPropId: next?.id ?? null, fn: nextFns.includes(prop.config.fn ?? '') ? prop.config.fn : 'count' });
          }}
          className={field}
        >
          <option value="">Choose…</option>
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.type !== TITLE_PROP ? ` (${TYPE_LABELS[t.type] ?? t.type})` : ''}
            </option>
          ))}
        </select>
      </label>
      {target && (
        <label className="flex items-center gap-2 text-[13px] text-muted">
          <span className="w-[64px] shrink-0">Calculate</span>
          <select value={fns.includes(prop.config.fn ?? '') ? /** @type {string} */ (prop.config.fn) : ''} aria-label="Calculate" onChange={(e) => save({ fn: e.target.value })} className={field}>
            {!fns.includes(prop.config.fn ?? '') && <option value="">Choose…</option>}
            {fns.map((fn) => (
              <option key={fn} value={fn}>
                {ROLLUP_LABELS[fn] ?? fn}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

/**
 * A button property: its label and what it does. Edits are kept locally and
 * saved after a short pause, so typing an amount doesn't round-trip per key.
 * @param {{ prop: Property, m: Mutations, properties: Property[] }} props
 */
export function ButtonConfig({ prop, m, properties }) {
  const [label, setLabel] = useState(prop.config.label ?? '');
  const [actions, setActions] = useState(/** @type {import('@papier/core/actions').Action[]} */ (prop.config.actions ?? []));
  const timer = useRef(0);
  /** @param {object} patch */
  const save = (patch) => {
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => m.updateProperty(prop.id, { config: { ...prop.config, label, actions, ...patch } }), 400);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div className="flex flex-col gap-1 px-1 pb-1">
      <div className={`${menuLabel} -mx-1`}>Button</div>
      <input
        value={label}
        placeholder={`Label (default: ${prop.name})`}
        aria-label="Button label"
        onChange={(e) => {
          setLabel(e.target.value);
          save({ label: e.target.value });
        }}
        onKeyDown={(e) => e.stopPropagation()}
        className={field}
      />
      <ActionsEditor
        actions={actions}
        properties={properties.filter((p) => p.id !== prop.id)}
        onChange={(next) => {
          setActions(next);
          save({ actions: next });
        }}
      />
    </div>
  );
}

/**
 * A formula property: its expression, saved after a short pause. What it
 * computes (`resultType`) comes back from the server.
 * @param {{ prop: Property, m: Mutations, properties: Property[] }} props
 */
export function FormulaConfig({ prop, m, properties }) {
  const [expression, setExpression] = useState(prop.config.expression ?? '');
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div className="flex flex-col gap-1 px-1 pb-1">
      <div className={`${menuLabel} -mx-1`}>Formula</div>
      <FormulaEditor
        value={expression}
        properties={properties.filter((p) => p.id !== prop.id)}
        onChange={(next) => {
          setExpression(next);
          clearTimeout(timer.current);
          timer.current = window.setTimeout(() => m.updateProperty(prop.id, { config: { ...prop.config, expression: next } }), 500);
        }}
      />
    </div>
  );
}
