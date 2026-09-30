import { useEffect, useState } from 'react';
import { usePurgePage, useRestorePage, useTrash } from '../api/pages.js';
import { forgetRecent } from '../recentPages.js';
import { TitleText } from './TitleText.jsx';

/** Days pages stay in the trash (the server's RETENTION_DAYS). */
const RETENTION_DAYS = 30;

/** "just now", "3 hours ago", "4 days ago". @param {number} ms */
function ago(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86_400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/**
 * The trash: what was deleted (top-most pages only — sub-pages come back with
 * them), with Restore and Delete forever. Clicking a title opens it (a
 * trashed page offers Restore too).
 * @param {{ onClose: () => void, onOpen: (id: string) => void }} props
 */
export function TrashDialog({ onClose, onOpen }) {
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 150);
    return () => clearTimeout(t);
  }, [input]);
  const { data: items = [], isFetching } = useTrash(q);
  const restore = useRestorePage();
  const purge = usePurgePage();
  const [confirm, setConfirm] = useState(/** @type {string | null} */ (null));
  const button = 'shrink-0 rounded-md px-2 py-1 text-[12px] hover:bg-s-active disabled:opacity-50';

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/40 px-4 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Trash"
        className="papier-popover flex h-fit max-h-[70vh] w-full max-w-[600px] flex-col overflow-hidden"
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <span className="text-[13px] font-medium text-muted">Trash</span>
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Filter by title…"
            aria-label="Filter the trash"
            style={{ outline: 'none' }}
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-fg-strong placeholder:text-faint"
          />
        </div>
        {items.length ? (
          <ul className="min-h-0 overflow-y-auto p-1.5" aria-label="Trashed pages">
            {items.map((item) => (
              <li key={item.page.id} className="flex items-center gap-2 rounded-md px-3 py-1.5 hover:bg-hover">
                <button
                  type="button"
                  onClick={() => {
                    onOpen(item.page.id);
                    onClose();
                  }}
                  className="flex min-w-0 flex-1 flex-col text-left"
                >
                  <span className={`truncate text-sm font-medium ${item.page.title ? 'text-fg-strong' : 'text-faint'}`}>
                    {item.page.icon && <span className="mr-1.5">{item.page.icon}</span>}
                    <TitleText title={item.page.title} titleContent={item.page.titleContent} />
                  </span>
                  <span className="truncate text-[12px] text-faint">
                    Deleted {ago(item.trashedAt)}
                    {item.parent && (
                      <>
                        {' · '}
                        {item.isRow ? 'row in ' : 'in '}
                        <TitleText title={item.parent.title || 'Untitled'} titleContent={item.parent.titleContent} />
                      </>
                    )}
                    {item.page.isTemplate && ' · template'}
                  </span>
                </button>
                <button
                  type="button"
                  className={`${button} text-fg`}
                  disabled={restore.isPending}
                  onClick={() => restore.mutate(item.page.id)}
                >
                  Restore
                </button>
                <button
                  type="button"
                  className={`${button} ${confirm === item.page.id ? 'text-fg-strong' : 'text-muted'}`}
                  disabled={purge.isPending}
                  onClick={() => {
                    if (confirm !== item.page.id) return setConfirm(item.page.id);
                    setConfirm(null);
                    forgetRecent(item.page.id);
                    purge.mutate(item.page.id);
                  }}
                >
                  {confirm === item.page.id ? 'Click again to delete forever' : 'Delete forever'}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-5 text-sm text-faint">{isFetching ? 'Loading…' : q ? 'Nothing in the trash matches.' : 'The trash is empty.'}</p>
        )}
        {restore.error && <p className="border-t border-line px-4 py-2 text-[12px] text-fg-strong">{restore.error.message}</p>}
        <p className="border-t border-line px-4 py-2 text-[12px] text-faint">Pages are deleted for good {RETENTION_DAYS} days after they go in the trash.</p>
      </div>
    </div>
  );
}
