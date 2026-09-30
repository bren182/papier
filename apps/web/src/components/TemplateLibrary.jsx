import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { pageKeys } from '../api/pages.js';
import { templateKeys, useDuplicatePage, useTemplates } from '../api/templates.js';
import { TitleText } from './TitleText.jsx';

/**
 * The template library: your page templates, to start a new page from, edit or
 * delete. (Built-in templates join this list later, as data.)
 *
 * `target` says where "Use" puts the new page; `replaceId` is an empty page it
 * replaces (the "Or start from a template" strip on a new page).
 * @param {{
 *   onClose: () => void,
 *   onOpen: (pageId: string) => void,
 *   target?: { parentId: string | null, replaceId?: string },
 * }} props
 */
export function TemplateLibrary({ onClose, onOpen, target = { parentId: null } }) {
  const { data: templates, isPending } = useTemplates();
  const duplicate = useDuplicatePage();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(/** @type {string | null} */ (null));

  /** @param {string} id */
  const use = (id) =>
    duplicate.mutate(
      { id, parentId: target.parentId },
      {
        onSuccess: async (page) => {
          if (target.replaceId) {
            await api(`/pages/${target.replaceId}`, { method: 'DELETE' });
            qc.invalidateQueries({ queryKey: pageKeys.all });
          }
          onOpen(page.id);
          onClose();
        },
      },
    );

  /** @param {string} id */
  const remove = async (id) => {
    if (confirm !== id) return setConfirm(id);
    await api(`/pages/${id}`, { method: 'DELETE' });
    qc.invalidateQueries({ queryKey: templateKeys.all });
    setConfirm(null);
  };

  const action = 'h-7 rounded-md px-2.5 text-[12px] text-muted hover:bg-white/[0.08] hover:text-fg disabled:opacity-50';

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center bg-black/40 px-4 pt-[12vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-label="Templates" className="papier-popover flex h-fit max-h-[70vh] w-full max-w-[560px] flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-[15px] font-semibold text-fg-strong">Templates</h2>
          <button type="button" autoFocus onClick={onClose} aria-label="Close" className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg">
            ×
          </button>
        </div>

        {isPending ? (
          <div className="h-24" />
        ) : !templates?.length ? (
          <div className="flex flex-col gap-1.5 px-5 py-8 text-[14px] text-muted">
            <p className="text-fg">No templates yet.</p>
            <p>Save any page as a template from its ⋯ menu (top right). Pages made from it start as a copy — sub-pages and databases included.</p>
            <p className="text-faint">Dates set to “Today” in a template become the day you use it.</p>
          </div>
        ) : (
          <ul className="min-h-0 overflow-y-auto p-1.5" aria-label="Your templates">
            {templates.map((t) => (
              <li key={t.id} className="group flex items-center gap-2 rounded-md px-3 py-2 hover:bg-hover">
                <span className="text-faint">{t.kind === 'database' ? '▦' : '▤'}</span>
                <span className={`min-w-0 flex-1 truncate text-sm font-medium ${t.title ? 'text-fg-strong' : 'text-faint'}`}>
                  <TitleText title={t.title} titleContent={t.titleContent} />
                </span>
                <button type="button" className={`${action} bg-accent !text-[#141414] hover:bg-accent-text`} disabled={duplicate.isPending} onClick={() => use(t.id)}>
                  Use
                </button>
                <button
                  type="button"
                  className={action}
                  onClick={() => {
                    onOpen(t.id);
                    onClose();
                  }}
                >
                  Edit
                </button>
                <button type="button" className={action} onClick={() => remove(t.id)} onBlur={() => setConfirm(null)}>
                  {confirm === t.id ? 'Delete?' : 'Delete'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
