import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { transferRows, useDatabaseList, useTransferPreview } from '../../api/databases.js';
import { pageKeys } from '../../api/pages.js';
import { showToast } from '../../toast.js';
import { useSelectedPage } from '../../useSelectedPage.js';
import { TitleText } from '../TitleText.jsx';
import { DatabaseIcon, TYPE_LABELS } from './meta.jsx';

/**
 * Move or copy rows into another database: pick it, see how the properties
 * map (by name) and what would be dropped, optionally add the missing ones,
 * then Move or Copy.
 * @param {{ sourceId: string, rowIds: string[], mode: 'move' | 'copy', onClose: () => void, onDone?: () => void }} props
 */
export function TransferDialog({ sourceId, rowIds, mode, onClose, onDone }) {
  const [q, setQ] = useState('');
  const [targetId, setTargetId] = useState(/** @type {string | null} */ (null));
  const [addMissing, setAddMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data: list = [] } = useDatabaseList(q.trim());
  const target = list.find((d) => d.id === targetId);
  const preview = useTransferPreview(sourceId, targetId);
  const qc = useQueryClient();
  const [, select] = useSelectedPage();
  const count = rowIds.length === 1 ? 'this row' : `${rowIds.length} rows`;

  /** @param {'move' | 'copy'} how */
  const run = async (how) => {
    if (!targetId) return;
    setBusy(true);
    try {
      const res = await transferRows(sourceId, { rowIds, targetId, mode: how, addMissing });
      qc.invalidateQueries({ queryKey: ['db'] });
      qc.invalidateQueries({ queryKey: pageKeys.all });
      const n = res.rows.length;
      showToast({
        text: `${how === 'move' ? 'Moved' : 'Copied'} ${n} ${n === 1 ? 'row' : 'rows'} to ${target?.title || 'the database'}`,
        action: { label: 'Open', run: () => select(targetId) },
      });
      onDone?.();
      onClose();
    } catch (err) {
      showToast({ text: err instanceof Error ? err.message : 'That didn’t work', tone: 'error' });
      setBusy(false);
    }
  };

  const button = 'h-8 rounded-md px-3 text-[13px] disabled:opacity-50';

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/40 px-4 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'move' ? 'Move to' : 'Copy to'}
        className="papier-popover flex h-fit max-h-[70vh] w-full max-w-[560px] flex-col overflow-hidden"
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <div className="border-b border-line px-4 pt-3 pb-2">
          <div className="text-[13px] text-muted">
            {mode === 'move' ? 'Move' : 'Copy'} {count} to…
          </div>
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setTargetId(null);
            }}
            placeholder="Find a database…"
            aria-label="Find a database"
            style={{ outline: 'none' }}
            className="h-9 w-full bg-transparent text-[15px] text-fg-strong placeholder:text-faint"
          />
        </div>

        {!targetId ? (
          <ul className="min-h-0 overflow-y-auto p-1.5" aria-label="Databases">
            {list
              .filter((d) => d.id !== sourceId)
              .map((d) => (
                <li key={d.id}>
                  <button type="button" onClick={() => setTargetId(d.id)} className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left hover:bg-hover">
                    {d.icon ? <span className="w-4 text-center">{d.icon}</span> : <DatabaseIcon size={14} />}
                    <span className="min-w-0 flex-1 truncate text-sm text-fg-strong">
                      <TitleText title={d.title || 'Untitled'} titleContent={d.titleContent} />
                    </span>
                    {d.path.length > 0 && <span className="max-w-[45%] truncate text-[12px] text-faint">{d.path.join(' › ')}</span>}
                  </button>
                </li>
              ))}
            {!list.some((d) => d.id !== sourceId) && <li className="px-3 py-2 text-sm text-faint">No other databases.</li>}
          </ul>
        ) : (
          <div className="flex min-h-0 flex-col gap-2 overflow-y-auto px-4 py-3 text-[13px]" aria-label="Preview">
            <div className="text-muted">
              Into <span className="text-fg-strong">{target?.path.length ? `${target.path.join(' › ')} › ` : ''}{target?.title || 'Untitled'}</span>
              <button type="button" onClick={() => setTargetId(null)} className="ml-2 text-faint underline hover:text-muted">
                change
              </button>
            </div>
            {preview.data ? (
              <>
                {preview.data.mapped.length > 0 && (
                  <ul className="flex flex-col gap-0.5">
                    {preview.data.mapped.map((m) => (
                      <li key={m.from.id} className="text-fg">
                        {m.from.name} → {m.to.name}
                        {m.convert && (
                          <span className="text-faint">
                            {' '}
                            ({TYPE_LABELS[m.from.type] ?? m.from.type} → {TYPE_LABELS[m.to.type] ?? m.to.type})
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {preview.data.dropped.length > 0 && (
                  <>
                    <div className="text-muted">
                      {addMissing ? 'Added to the target: ' : 'Dropped (no property with that name there): '}
                      {preview.data.dropped.map((d) => d.name).join(', ')}
                    </div>
                    <label className="flex items-center gap-2 text-muted">
                      <input type="checkbox" checked={addMissing} onChange={(e) => setAddMissing(e.target.checked)} />
                      Add missing properties to the target
                    </label>
                  </>
                )}
                {!preview.data.mapped.length && !preview.data.dropped.length && <div className="text-faint">Only the title and content carry over.</div>}
                <div className="text-faint">The title, content and sub-pages always come along.</div>
              </>
            ) : (
              <div className="text-faint">Checking properties…</div>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-2.5">
          <button type="button" className={`${button} text-muted hover:bg-hover`} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={!targetId || busy} className={`${button} border border-line text-fg hover:bg-hover`} onClick={() => run(mode === 'move' ? 'copy' : 'move')}>
            {mode === 'move' ? 'Copy instead' : 'Move instead'}
          </button>
          <button
            type="button"
            disabled={!targetId || busy}
            className={`${button} bg-accent font-medium text-[#141414] hover:bg-accent-text`}
            onClick={() => run(mode)}
          >
            {mode === 'move' ? 'Move' : 'Copy'}
          </button>
        </div>
      </div>
    </div>
  );
}
