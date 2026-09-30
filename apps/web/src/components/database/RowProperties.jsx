import { useRef, useState } from 'react';
import { PROPERTY_TYPES } from '@papier/core/props';
import { useDatabase, useDatabaseMutations } from '../../api/databases.js';
import { ValueCell } from './cells.jsx';
import { Icon, ICONS, TYPE_LABELS, TypeIcon } from './meta.jsx';
import { menuItem, menuLabel, Popover } from './Popover.jsx';

/**
 * A row page's property values, between its title and its content.
 * @param {{ page: { id: string, createdAt: number, updatedAt: number }, databaseId: string, values: Record<string, unknown> }} props
 */
export function RowProperties({ page, databaseId, values }) {
  const { data } = useDatabase(databaseId);
  const m = useDatabaseMutations(databaseId);
  const [adding, setAdding] = useState(false);
  const addRef = useRef(/** @type {HTMLButtonElement | null} */ (null));
  if (!data) return <div className="h-8" />;

  /** @param {import('../../api/databases.js').Property} prop @param {string} name */
  const addOption = async (prop, name) => {
    const updated = await m.updateProperty(prop.id, { config: { ...prop.config, options: [...(prop.config.options ?? []), { name }] } });
    return updated.config.options?.find((o) => o.name === name)?.id;
  };

  return (
    <div className="flex flex-col border-b border-line pb-3" aria-label="Properties">
      {data.properties.map((p) => (
        <div key={p.id} className="flex min-h-[34px] items-start gap-2">
          <span className="flex h-[34px] w-[160px] shrink-0 items-center gap-2 px-1 text-[14px] text-muted">
            <TypeIcon type={p.type} />
            <span className="truncate">{p.name}</span>
          </span>
          <ValueCell
            prop={p}
            value={values[p.id]}
            row={page}
            wrap
            placeholder="Empty"
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
              onClick={() => {
                setAdding(false);
                m.addProperty({ name: TYPE_LABELS[t] ?? t, type: t });
              }}
            >
              <TypeIcon type={t} />
              {TYPE_LABELS[t]}
            </button>
          ))}
        </Popover>
      )}
    </div>
  );
}
