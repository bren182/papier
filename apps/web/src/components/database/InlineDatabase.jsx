import { useState } from 'react';
import { usePage, useUpdatePage } from '../../api/pages.js';
import { openPeek } from '../../useSelectedPage.js';
import { DatabaseView } from './DatabaseView.jsx';
import { DatabaseIcon, Icon, ICONS } from './meta.jsx';

/**
 * A database inside a page's content (the editor's databaseBlock): its title,
 * editable in place, above the chosen view.
 * @param {{ databaseId: string, viewId: string | null, onViewChange: (id: string) => void, onOpenPage: (id: string) => void }} props
 */
export function InlineDatabase({ databaseId, viewId, onViewChange, onOpenPage }) {
  const { data, error } = usePage(databaseId);
  if (error) return <p className="py-2 text-[14px] text-faint">This database is in the trash or doesn’t exist.</p>;
  if (!data) return <div className="h-24" />;

  return (
    <div className="my-2 cursor-auto text-[14px] font-normal">
      <DatabaseView
        databaseId={databaseId}
        inline
        viewId={viewId}
        onViewChange={onViewChange}
        onOpenRow={openPeek}
        header={<InlineTitle id={databaseId} title={data.page.title} onOpen={() => onOpenPage(databaseId)} />}
      />
    </div>
  );
}

/** @param {{ id: string, title: string, onOpen: () => void }} props */
function InlineTitle({ id, title, onOpen }) {
  const update = useUpdatePage();
  const [text, setText] = useState(title);
  return (
    <div className="group/title flex items-center gap-2">
      <DatabaseIcon size={18} />
      <input
        value={text}
        aria-label="Database title"
        placeholder="Untitled database"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== title && update.mutate({ id, patch: { title: text } })}
        onKeyDown={(e) => e.key === 'Enter' && /** @type {HTMLInputElement} */ (e.target).blur()}
        className="min-w-0 flex-1 bg-transparent text-[20px] leading-8 font-semibold text-fg-strong outline-none placeholder:text-[#3d3d3d]"
      />
      <button
        type="button"
        onClick={onOpen}
        className="flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-muted opacity-0 group-hover/title:opacity-100 hover:bg-hover hover:text-fg focus-visible:opacity-100"
      >
        <Icon path={ICONS.open} size={12} /> Open as page
      </button>
    </div>
  );
}
