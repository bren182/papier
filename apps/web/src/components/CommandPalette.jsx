import { THEMES } from '@papier/ui';
import { useArchivePage, useCreatePage, usePage, useSetFavorite, useUpdatePage } from '../api/pages.js';
import { useDuplicatePage } from '../api/templates.js';
import { useUpdateWorkspace, useWorkspace } from '../api/workspaces.js';
import { requestPageAction } from '../pageActions.js';
import { recentPages } from '../recentPages.js';
import { keyLabel } from '../shortcuts.js';
import { showToast } from '../toast.js';
import { SearchDialog } from './SearchDialog.jsx';

/**
 * Ctrl/Cmd-K: search pages and run commands (type ">" for commands only).
 * Commands come from the app (new page, trash, theme…) and the open page
 * (icon, cover, layout, duplicate, move, delete).
 *
 * @typedef {import('./SearchDialog.jsx').Command} Command
 * @param {{
 *   onClose: () => void,
 *   onSelect: (id: string | null, blockId?: string | null) => void,
 *   selectedId: string | null,
 *   prefs: import('../usePrefs.js').Prefs,
 *   onPrefs: (patch: Partial<import('../usePrefs.js').Prefs> | ((p: import('../usePrefs.js').Prefs) => Partial<import('../usePrefs.js').Prefs>)) => void,
 *   onTrash: () => void,
 *   onTemplates: () => void,
 *   onShortcuts: () => void,
 *   onSettings: () => void,
 *   onAi?: () => void,
 * }} props
 */
export function CommandPalette({ onClose, onSelect, selectedId, prefs, onPrefs, onTrash, onTemplates, onShortcuts, onSettings, onAi }) {
  const createPage = useCreatePage();
  const updatePage = useUpdatePage();
  const archive = useArchivePage();
  const duplicate = useDuplicatePage();
  const setFavorite = useSetFavorite();
  const { workspace } = useWorkspace();
  const setHome = useUpdateWorkspace();
  const { data } = usePage(selectedId);
  const page = data?.page;
  const isRow = Boolean(data?.database);
  const keys = (/** @type {string[]} */ k) => k.map(keyLabel).join(' ');
  // Commands run after the palette closes (unmounts), so they chain on the promise:
  // callbacks passed to mutate() would be dropped with the component.
  const quietly = (/** @type {Promise<unknown>} */ p) => p.catch((err) => showToast({ text: err instanceof Error ? err.message : 'That didn’t work', tone: 'error' }));

  /** @type {Command[]} */
  const commands = [
    { id: 'new-page', title: 'New page', keywords: 'create add', common: true, run: () => quietly(createPage.mutateAsync({ parentId: null }).then((p) => onSelect(p.id))) },
    { id: 'new-database', title: 'New database', keywords: 'create add table board', common: true, run: () => quietly(createPage.mutateAsync({ parentId: null, kind: 'database' }).then((p) => onSelect(p.id))) },
    { id: 'home', title: 'Go to Home', keywords: 'start landing dashboard', common: true, run: () => onSelect(null) },
    { id: 'trash', title: 'Open trash', keywords: 'deleted restore bin', common: true, run: onTrash },
    { id: 'templates', title: 'Templates', keywords: 'library', run: onTemplates },
    { id: 'settings', title: 'Settings', keywords: 'theme display preferences', run: onSettings },
    { id: 'shortcuts', title: 'Keyboard shortcuts', keywords: 'keys help', keys: keys(['Mod', '/']), run: onShortcuts },
    ...(onAi ? [{ id: 'ai', title: '✦ Ask AI', keywords: 'smart search summarize ollama llm', run: () => { onClose(); onAi(); } }] : []),
    { id: 'sidebar', title: prefs.sidebar ? 'Hide sidebar' : 'Show sidebar', keywords: 'toggle sidebar', keys: keys(['Mod', '\\']), run: () => onPrefs((p) => ({ sidebar: !p.sidebar })) },
    ...THEMES.map((t) => ({
      id: `theme-${t.id}`,
      title: `Theme: ${t.name}${prefs.theme === t.id ? ' (current)' : ''}`,
      keywords: 'colour color look',
      run: () => onPrefs({ theme: t.id }),
    })),
    { id: 'mode', title: prefs.mode === 'grayscale' ? 'Ambient backdrop' : 'Grayscale backdrop', keywords: 'colour color display', run: () => onPrefs((p) => ({ mode: p.mode === 'grayscale' ? 'ambient' : 'grayscale' })) },
    ...(prefs.mode === 'ambient'
      ? [{ id: 'glass', title: prefs.glass === 'clear' ? 'Frosted glass' : 'Clear glass', keywords: 'display blur', run: () => onPrefs((p) => ({ glass: p.glass === 'clear' ? 'frosted' : 'clear' })) }]
      : []),
    { id: 'motion', title: prefs.motion ? 'Pause motion' : 'Play motion', keywords: 'animation display', run: () => onPrefs((p) => ({ motion: !p.motion })) },
    ...(page ? pageCommands() : []),
  ];

  /** @returns {Command[]} */
  function pageCommands() {
    if (!page) return [];
    const look = page.appearance ?? {};
    const setLook = (/** @type {import('../api/pages.js').Appearance} */ appearance) => updatePage.mutate({ id: page.id, patch: { appearance } });
    return [
      { id: 'icon', title: page.icon ? 'Change icon' : 'Add icon', keywords: 'emoji page', common: true, run: () => requestPageAction('icon') },
      ...(workspace && workspace.role !== 'viewer' && !isRow && !page.isTemplate
        ? [
            workspace.homePageId === page.id
              ? { id: 'unset-home', title: 'Remove as Home', keywords: 'landing start', run: () => quietly(setHome.mutateAsync({ id: workspace.id, homePageId: null })) }
              : { id: 'set-home', title: 'Set as Home', keywords: 'landing start dashboard', run: () => quietly(setHome.mutateAsync({ id: workspace.id, homePageId: page.id })) },
          ]
        : []),
      { id: 'cover', title: look.cover ? 'Change cover' : 'Add cover', keywords: 'page header', run: () => requestPageAction('cover') },
      { id: 'customise', title: 'Customise page', keywords: 'font mood layout', run: () => requestPageAction('customise') },
      { id: 'full-width', title: look.fullWidth ? 'Normal width' : 'Full width', keywords: 'page layout', run: () => setLook({ fullWidth: look.fullWidth ? null : true }) },
      { id: 'small-text', title: look.smallText ? 'Normal text size' : 'Small text', keywords: 'page layout font', run: () => setLook({ smallText: look.smallText ? null : true }) },
      ...(!page.isTemplate && !data?.inTemplate
        ? [{ id: 'favorite', title: page.favorite ? 'Remove from favourites' : 'Add to favourites', keywords: 'star pin sidebar', run: () => quietly(setFavorite.mutateAsync({ id: page.id, favorite: !page.favorite })) }]
        : []),
      { id: 'duplicate', title: 'Duplicate page', keywords: 'copy', run: () => quietly(duplicate.mutateAsync({ id: page.id }).then((copy) => onSelect(copy.id))) },
      ...(!page.isTemplate
        ? [
            {
              id: 'save-template',
              title: isRow ? 'Save as database template' : 'Save as template',
              keywords: 'template',
              run: () => quietly(duplicate.mutateAsync({ id: page.id, asTemplate: true }).then(() => showToast({ text: 'Saved to templates' }))),
            },
          ]
        : []),
      ...(!isRow && !page.isTemplate ? [{ id: 'move', title: 'Move page to…', keywords: 'parent', run: () => requestPageAction('move') }] : []),
      {
        id: 'delete',
        title: 'Delete page',
        keywords: 'trash remove',
        run: () => quietly(archive.mutateAsync({ id: page.id, parentId: page.parentId }).then(() => onSelect(page.parentId))),
      },
    ];
  }

  return <SearchDialog commands={commands} recent={recentPages().filter((p) => p.id !== selectedId)} onClose={onClose} onOpen={(id, blockId) => onSelect(id, blockId)} />;
}
