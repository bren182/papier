import { useState } from 'react';
import { PROPERTY_TYPES } from '@papier/core/props';
import { useDb } from './context.js';
import { Icon, ICONS, TYPE_LABELS, TypeIcon } from './meta.jsx';
import { field, menuItem, menuLabel, Popover } from './Popover.jsx';

/**
 * Column header menu: rename, change type, edit options, sort, hide, delete.
 * @param {{ prop: import('./context.js').Property, anchor: HTMLElement | null, onClose: () => void }} props
 */
export function PropertyMenu({ prop, anchor, onClose }) {
  const { m, view, setConfig } = useDb();
  const [name, setName] = useState(prop.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typesOpen, setTypesOpen] = useState(false);
  const isTitle = prop.id === 'title';

  const rename = () => {
    const n = name.trim();
    if (n && n !== prop.name) m.updateProperty(prop.id, { name: n });
  };

  /** @param {'asc' | 'desc' | 'upcoming'} dir */
  const sortBy = (dir) => {
    setConfig({ sorts: [{ propId: prop.id, dir }, ...view.config.sorts.filter((s) => s.propId !== prop.id)] });
    onClose();
  };

  return (
    <Popover anchor={anchor} onClose={onClose} width={250}>
      {!isTitle && (
        <div className="p-1">
          <input
            autoFocus
            value={name}
            aria-label="Property name"
            onChange={(e) => setName(e.target.value)}
            onBlur={rename}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                rename();
                onClose();
              }
            }}
            className={field}
          />
        </div>
      )}

      {!isTitle && (
        <>
          <button type="button" className={menuItem} onClick={() => setTypesOpen((o) => !o)}>
            <TypeIcon type={prop.type} />
            <span className="flex-1">Type</span>
            <span className="text-muted">{TYPE_LABELS[prop.type]}</span>
          </button>
          {typesOpen && (
            <div className="ml-3 border-l border-line pl-1">
              {PROPERTY_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={menuItem}
                  onClick={() => {
                    if (t !== prop.type) m.updateProperty(prop.id, { type: t });
                    setTypesOpen(false);
                  }}
                >
                  <TypeIcon type={t} />
                  <span className="flex-1">{TYPE_LABELS[t]}</span>
                  {t === prop.type && <span className="text-accent">✓</span>}
                </button>
              ))}
            </div>
          )}
          {(prop.type === 'select' || prop.type === 'multi_select') && <OptionsEditor prop={prop} />}
          {prop.type === 'number' && (
            <button
              type="button"
              className={menuItem}
              onClick={() => m.updateProperty(prop.id, { config: { ...prop.config, format: prop.config.format === 'percent' ? 'number' : 'percent' } })}
            >
              <span className="flex-1">Show as percent</span>
              {prop.config.format === 'percent' && <span className="text-accent">✓</span>}
            </button>
          )}
          <div className="my-1 h-px bg-line" />
        </>
      )}

      <button type="button" className={menuItem} onClick={() => sortBy('asc')}>
        <Icon path={ICONS.sort} />
        Sort ascending
      </button>
      <button type="button" className={menuItem} onClick={() => sortBy('desc')}>
        <Icon path={ICONS.sort} />
        Sort descending
      </button>
      {prop.type === 'date' && (
        <button type="button" className={menuItem} onClick={() => sortBy('upcoming')}>
          <Icon path={ICONS.sort} />
          Sort by upcoming
        </button>
      )}

      {!isTitle && (
        <>
          <button
            type="button"
            className={menuItem}
            onClick={() => {
              setConfig({ hidden: [...view.config.hidden, prop.id] });
              onClose();
            }}
          >
            <Icon path={ICONS.eyeOff} />
            Hide in view
          </button>
          <button
            type="button"
            className={`${menuItem} ${confirmDelete ? 'text-fg-strong' : ''}`}
            onClick={() => {
              if (!confirmDelete) return setConfirmDelete(true);
              m.deleteProperty(prop.id);
              onClose();
            }}
          >
            <Icon path={ICONS.trash} />
            {confirmDelete ? 'Click again to delete' : 'Delete property'}
          </button>
        </>
      )}
    </Popover>
  );
}

/**
 * Rename, remove and add select options. Removing one clears it from rows.
 * @param {{ prop: import('./context.js').Property }} props
 */
function OptionsEditor({ prop }) {
  const { m } = useDb();
  const options = prop.config.options ?? [];
  const [draft, setDraft] = useState('');

  /** @param {{ id?: string, name: string }[]} next */
  const save = (next) => m.updateProperty(prop.id, { config: { ...prop.config, options: next } });

  return (
    <div className="pb-1">
      <div className={menuLabel}>Options</div>
      {options.map((o) => (
        <div key={o.id} className="flex items-center gap-1 px-1 py-0.5">
          <input
            defaultValue={o.name}
            aria-label={`Option ${o.name}`}
            onBlur={(e) => {
              const n = e.target.value.trim();
              if (n && n !== o.name) save(options.map((x) => (x.id === o.id ? { ...x, name: n } : x)));
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') /** @type {HTMLInputElement} */ (e.target).blur();
            }}
            className={`${field} h-6`}
          />
          <button
            type="button"
            aria-label={`Delete option ${o.name}`}
            onClick={() => save(options.filter((x) => x.id !== o.id))}
            className="flex size-6 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-fg"
          >
            <Icon path={ICONS.x} size={12} />
          </button>
        </div>
      ))}
      <div className="px-1 py-0.5">
        <input
          value={draft}
          placeholder="Add an option…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && draft.trim()) {
              save([...options, { name: draft.trim() }]);
              setDraft('');
            }
          }}
          className={`${field} h-6`}
        />
      </div>
    </div>
  );
}
