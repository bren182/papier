import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { pageKeys } from '../api/pages.js';
import { templateKeys, useDuplicatePage, useTemplates } from '../api/templates.js';
import { saveBlocks } from '../api/blocks.js';
import { TitleText } from './TitleText.jsx';

/**
 * Built-in starter templates: title, icon, description and a blocks factory.
 * Blocks use the stored format: { id, type, content, props, indent, order, parent_id }.
 */
const STARTERS = [
  {
    id: 'starter:daily-journal',
    title: 'Daily Journal',
    icon: '📓',
    description: 'Morning notes, goals and end-of-day reflections.',
    blocks: () => [
      block('heading', 'Morning Notes', { level: 2 }, 'a0'),
      block('paragraph', '', {}, 'b0'),
      block('heading', "Today's Goals", { level: 2 }, 'c0'),
      block('paragraph', '', {}, 'd0'),
      block('heading', 'Reflections', { level: 2 }, 'e0'),
      block('paragraph', '', {}, 'f0'),
    ],
  },
  {
    id: 'starter:meeting-notes',
    title: 'Meeting Notes',
    icon: '🗒',
    description: 'Attendees, agenda items and action points in one place.',
    blocks: () => [
      block('heading', 'Attendees', { level: 2 }, 'a0'),
      block('paragraph', '', {}, 'b0'),
      block('heading', 'Agenda', { level: 2 }, 'c0'),
      block('bulleted_list', '', {}, 'd0'),
      block('heading', 'Action Items', { level: 2 }, 'e0'),
      block('todo', '', { checked: false }, 'f0'),
    ],
  },
  {
    id: 'starter:cookbook',
    title: 'Cookbook Recipe',
    icon: '🍳',
    description: 'Ingredients list, step-by-step instructions and notes.',
    blocks: () => [
      block('heading', 'Ingredients', { level: 2 }, 'a0'),
      block('bulleted_list', '', {}, 'b0'),
      block('heading', 'Instructions', { level: 2 }, 'c0'),
      block('numbered_list', '', {}, 'd0'),
      block('heading', 'Notes', { level: 2 }, 'e0'),
      block('paragraph', '', {}, 'f0'),
    ],
  },
  {
    id: 'starter:reading-list',
    title: 'Reading List',
    icon: '📚',
    description: 'Track books you want to read, are reading and have finished.',
    blocks: () => [
      block('heading', 'To Read', { level: 2 }, 'a0'),
      block('todo', '', { checked: false }, 'b0'),
      block('heading', 'Currently Reading', { level: 2 }, 'c0'),
      block('paragraph', '', {}, 'd0'),
      block('heading', 'Finished', { level: 2 }, 'e0'),
      block('bulleted_list', '', {}, 'f0'),
    ],
  },
];

/**
 * Build a stored block object.
 * @param {string} type @param {string} text @param {Record<string,any>} props @param {string} order
 */
function block(type, text, props, order) {
  return {
    id: crypto.randomUUID(),
    type,
    content: text ? [{ type: 'text', text, styles: {} }] : [],
    props,
    indent: 0,
    order,
    parentId: null,
  };
}

/**
 * The template library: starter templates plus your own saved pages.
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
  const [creating, setCreating] = useState(/** @type {string | null} */ (null));

  /** Use one of the user's saved templates (duplicate it). @param {string} id */
  const useSaved = (id) =>
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

  /** Use a built-in starter template (create page + blocks). */
  const useStarter = async (/** @type {typeof STARTERS[0]} */ starter) => {
    setCreating(starter.id);
    try {
      const page = /** @type {{ id: string }} */ (await api('/pages', {
        method: 'POST',
        body: { parentId: target.parentId, kind: 'page', title: starter.title, icon: starter.icon },
      }));
      await saveBlocks(page.id, { upserts: /** @type {any} */ (starter.blocks()), deletes: [] });
      if (target.replaceId) {
        await api(`/pages/${target.replaceId}`, { method: 'DELETE' });
        qc.invalidateQueries({ queryKey: pageKeys.all });
      }
      qc.invalidateQueries({ queryKey: pageKeys.all });
      onOpen(page.id);
      onClose();
    } finally {
      setCreating(null);
    }
  };

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
      <div role="dialog" aria-modal="true" aria-label="Template Library" className="papier-popover flex h-fit max-h-[75vh] w-full max-w-[600px] flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-[15px] font-semibold text-fg-strong">Start from a template</h2>
          <button type="button" autoFocus onClick={onClose} aria-label="Close" className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg">
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Starter templates */}
          <div className="border-b border-line px-4 py-2.5">
            <p className="mb-2.5 text-[11px] font-medium uppercase tracking-wide text-faint">Starter templates</p>
            <div className="grid grid-cols-2 gap-2">
              {STARTERS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  disabled={creating !== null}
                  onClick={() => useStarter(s)}
                  className="flex items-start gap-2.5 rounded-lg border border-line bg-black/10 p-3 text-left hover:border-accent/40 hover:bg-hover disabled:opacity-50"
                >
                  <span className="mt-0.5 text-[20px] leading-none">{s.icon}</span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-fg-strong">{s.title}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-faint">{s.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* User's saved templates */}
          <div className="px-4 py-2.5">
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">Your templates</p>
            {isPending ? (
              <div className="h-12" />
            ) : !templates?.length ? (
              <p className="py-3 text-[13px] text-muted">
                None yet. Save any page as a template from its ⋯ menu (top right).
              </p>
            ) : (
              <ul aria-label="Your templates">
                {templates.map((t) => (
                  <li key={t.id} className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-hover">
                    <span className="text-faint">{t.icon ?? (t.kind === 'database' ? '▦' : '▤')}</span>
                    <span className={`min-w-0 flex-1 truncate text-sm font-medium ${t.title ? 'text-fg-strong' : 'text-faint'}`}>
                      <TitleText title={t.title} titleContent={t.titleContent} />
                    </span>
                    <button type="button" className={`${action} bg-accent !text-[#141414] hover:bg-accent-text`} disabled={duplicate.isPending} onClick={() => useSaved(t.id)}>
                      Use
                    </button>
                    <button type="button" className={action} onClick={() => { onOpen(t.id); onClose(); }}>
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
      </div>
    </div>
  );
}
