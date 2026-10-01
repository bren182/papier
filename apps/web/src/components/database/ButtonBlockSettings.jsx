import { ActionsEditor } from './ActionsEditor.jsx';
import { field, menuLabel, Popover } from './Popover.jsx';

/**
 * Settings of a button block in a page: its label and actions (row-less, so
 * adding rows to databases). Edits go straight into the block's attrs, which
 * autosave with the page.
 * @param {import('../../editor/ButtonBlock.jsx').ButtonSettings & { anchor: HTMLElement | null,
 *   onChange: (patch: Partial<import('../../editor/ButtonBlock.jsx').ButtonSettings>) => void, onClose: () => void }} props
 */
export function ButtonBlockSettings({ anchor, label, actions, open, onChange, onClose }) {
  return (
    <Popover anchor={anchor} onClose={onClose} width={340}>
      <div className="flex flex-col gap-1 p-1">
        <div className={`${menuLabel} -mx-1`}>Button</div>
        <input
          autoFocus
          value={label}
          placeholder="Label"
          aria-label="Button label"
          onChange={(e) => onChange({ label: e.target.value })}
          onKeyDown={(e) => e.stopPropagation()}
          className={field}
        />
        <ActionsEditor actions={actions} properties={[]} rowless onChange={(next) => onChange({ actions: next })} />
        {actions.some((a) => a.type === 'add_row') && (
          <label className="flex items-center gap-2 px-1 pt-1 text-[13px] text-fg">
            <input type="checkbox" checked={open} onChange={(e) => onChange({ open: e.target.checked })} className="accent-[var(--p-accent)]" />
            Open the new row
          </label>
        )}
      </div>
    </Popover>
  );
}
