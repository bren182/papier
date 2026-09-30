import { useRef, useState } from 'react';
import { PROPERTY_TYPES } from '@papier/core/props';
import { rememberRefs, useDatabase, useDatabaseMutations } from '../../api/databases.js';
import { ValueCell } from './cells.jsx';
import { Icon, ICONS, TYPE_LABELS, TypeIcon } from './meta.jsx';
import { menuItem, menuLabel, Popover } from './Popover.jsx';
import { ButtonConfig, RelationConfig, RollupConfig } from './RelationConfig.jsx';

/** Types set up after they're added (which database, what to roll up, what a button does). */
const CONFIGURED = new Set(['relation', 'rollup', 'button']);

/**
 * A row page's property values, between its title and its content.
 * @param {{ page: { id: string, createdAt: number, updatedAt: number }, databaseId: string, values: Record<string, unknown>,
 *   refs?: Record<string, import('../../api/databases.js').Ref>, template?: boolean }} props
 *   template: a row template, whose dates may stay "today"; refs: titles of linked rows
 */
export function RowProperties({ page, databaseId, values, refs, template = false }) {
  const { data } = useDatabase(databaseId);
  const m = useDatabaseMutations(databaseId);
  const [adding, setAdding] = useState(false);
  const [configuring, setConfiguring] = useState(/** @type {{ id: string, el: HTMLElement | null } | null} */ (null));
  const addRef = useRef(/** @type {HTMLButtonElement | null} */ (null));
  rememberRefs(refs);
  if (!data) return <div className="h-8" />;
  const configProp = configuring && data.properties.find((p) => p.id === configuring.id);

  /** @param {import('../../api/databases.js').Property} prop @param {string} name */
  const addOption = async (prop, name) => {
    const updated = await m.updateProperty(prop.id, { config: { ...prop.config, options: [...(prop.config.options ?? []), { name }] } });
    return updated.config.options?.find((o) => o.name === name)?.id;
  };

  return (
    <div className="flex flex-col border-b border-line pb-3" aria-label="Properties">
      {data.properties.map((p) => (
        <div key={p.id} className="flex min-h-[34px] items-start gap-2">
          {CONFIGURED.has(p.type) ? (
            <button
              type="button"
              title={`${TYPE_LABELS[p.type]} settings`}
              onClick={(e) => setConfiguring({ id: p.id, el: e.currentTarget })}
              className="flex h-[34px] w-[160px] shrink-0 items-center gap-2 rounded-md px-1 text-left text-[14px] text-muted hover:bg-hover"
            >
              <TypeIcon type={p.type} />
              <span className="truncate">{p.name}</span>
            </button>
          ) : (
            <span className="flex h-[34px] w-[160px] shrink-0 items-center gap-2 px-1 text-[14px] text-muted">
              <TypeIcon type={p.type} />
              <span className="truncate">{p.name}</span>
            </span>
          )}
          <ValueCell
            prop={p}
            value={values[p.id]}
            row={page}
            wrap
            placeholder="Empty"
            template={template}
            onChange={(v) => m.setProps(page.id, { [p.id]: v })}
            onAddOption={addOption}
            className="min-h-[34px] flex-1 rounded-md px-2 py-1.5 text-[14px] text-fg hover:bg-hover focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          />
        </div>
      ))}
      <button
        ref={addRef}
        type="button"
        onClick={() => setAdding(true)}
        className="flex h-[34px] w-fit items-center gap-2 rounded-md px-1 text-[14px] text-faint hover:bg-hover hover:text-muted"
      >
        <Icon path={ICONS.plus} /> Add a property
      </button>
      {adding && (
        <Popover anchor={addRef.current} onClose={() => setAdding(false)} width={220}>
          <div className={menuLabel}>New property</div>
          {PROPERTY_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              className={menuItem}
              onClick={async () => {
                setAdding(false);
                const prop = await m.addProperty({ name: TYPE_LABELS[t] ?? t, type: t });
                if (CONFIGURED.has(t)) setConfiguring({ id: prop.id, el: addRef.current });
              }}
            >
              <TypeIcon type={t} />
              {TYPE_LABELS[t]}
            </button>
          ))}
        </Popover>
      )}
      {configProp && (
        <Popover anchor={configuring.el} onClose={() => setConfiguring(null)} width={configProp.type === 'button' ? 340 : 280}>
          {configProp.type === 'relation' ? (
            <RelationConfig prop={configProp} m={m} />
          ) : configProp.type === 'button' ? (
            <ButtonConfig prop={configProp} m={m} properties={data.properties} />
          ) : (
            <RollupConfig prop={configProp} m={m} properties={data.properties} />
          )}
        </Popover>
      )}
    </div>
  );
}
