import { useDatabaseList } from '../../api/databases.js';
import { usePage } from '../../api/pages.js';
import { openPeek } from '../../useSelectedPage.js';
import { TitleText } from '../TitleText.jsx';
import { DatabaseView } from './DatabaseView.jsx';
import { DatabaseIcon, Icon, ICONS } from './meta.jsx';
import { field } from './Popover.jsx';

/** @typedef {import('../../editor/LinkedDatabaseBlock.jsx').LinkedView} LinkedView */

/**
 * The editor's linkedDatabase block: a database from elsewhere through the
 * block's own view. Its title links to the database (not editable here: it
 * belongs to the database's page). No database yet: a picker.
 * @param {{ databaseId: string | null, view: LinkedView | null, onChange: (patch: { databaseId?: string | null, view?: LinkedView | null }) => void,
 *   onOpenPage: (id: string) => void }} props
 */
export function LinkedDatabase({ databaseId, view, onChange, onOpenPage }) {
  const { data, error } = usePage(databaseId);
  if (!databaseId) return <Picker onPick={(id) => onChange({ databaseId: id, view: { type: 'table', config: /** @type {any} */ ({}) } })} />;
  if (error) return <p className="py-2 text-[14px] text-faint">This database is in the trash or doesn’t exist.</p>;
  if (!data) return <div className="h-24" />;

  return (
    <div className="my-2 cursor-auto text-[14px] font-normal">
      <DatabaseView
        databaseId={databaseId}
        inline
        local={{ view, onConfig: (next) => onChange({ view: next }) }}
        onOpenRow={openPeek}
        header={
          <div className="group/title flex items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenPage(databaseId)}
              title="Open the database"
              className="flex min-w-0 items-center gap-2 rounded-md text-left hover:text-fg-strong"
            >
              <span className="text-muted">
                <Icon path={ICONS.open} size={14} />
              </span>
              {data.page.icon ? <span className="text-[18px] leading-none">{data.page.icon}</span> : <DatabaseIcon size={18} />}
              <span className="truncate text-[20px] leading-8 font-semibold text-fg-strong">
                <TitleText title={data.page.title || 'Untitled database'} titleContent={data.page.titleContent} />
              </span>
            </button>
            <button
              type="button"
              onClick={() => onChange({ databaseId: null, view: null })}
              className="h-7 shrink-0 rounded-md px-2 text-[12px] text-muted opacity-0 group-hover/title:opacity-100 hover:bg-hover hover:text-fg focus-visible:opacity-100"
            >
              Change database
            </button>
          </div>
        }
      />
    </div>
  );
}

/** @param {{ onPick: (id: string) => void }} props */
function Picker({ onPick }) {
  const { data: databases = [] } = useDatabaseList('');
  return (
    <div className="my-2 flex items-center gap-2 rounded-md border border-dashed border-line px-3 py-3 text-[14px] text-muted">
      <DatabaseIcon size={16} />
      <span className="shrink-0">Linked view of</span>
      <select defaultValue="" aria-label="Database to show" onChange={(e) => e.target.value && onPick(e.target.value)} className={`${field} max-w-[320px]`}>
        <option value="">Choose a database…</option>
        {databases.map((d) => (
          <option key={d.id} value={d.id}>
            {[...d.path, d.title || 'Untitled'].join(' › ')}
          </option>
        ))}
      </select>
    </div>
  );
}
