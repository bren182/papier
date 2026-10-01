import { useCallback, useEffect, useRef, useState } from 'react';
import { Backdrop } from '@papier/ui';
import { usePrefs } from './usePrefs.js';
import { useWorkspace } from './api/workspaces.js';
import { useSelectedPage } from './useSelectedPage.js';
import { usePage, useSetFavorite } from './api/pages.js';
import { useDuplicatePage } from './api/templates.js';
import { Sidebar } from './components/Sidebar.jsx';
import { Topbar } from './components/Topbar.jsx';
import { Page } from './components/Page.jsx';
import { RowPeek } from './components/RowPeek.jsx';
import { CommandPalette } from './components/CommandPalette.jsx';
import { SettingsDialog } from './components/SettingsDialog.jsx';
import { ShortcutsDialog } from './components/ShortcutsDialog.jsx';
import { TemplateLibrary } from './components/TemplateLibrary.jsx';
import { TrashDialog } from './components/TrashDialog.jsx';
import { Toaster } from './components/Toaster.jsx';
import { AiPanel } from './components/AiPanel.jsx';

export function App() {
  const [prefs, updatePrefs] = usePrefs();
  const [selectedId, select] = useSelectedPage();
  const { workspace } = useWorkspace();
  const atHome = !selectedId;
  const pageId = selectedId ?? workspace?.homePageId ?? null;
  const [searching, setSearching] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [library, setLibrary] = useState(/** @type {import('./components/Page.jsx').LibraryTarget | null} */ (null));
  const [trash, setTrash] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const { data: pageData } = usePage(pageId);
  const setFavorite = useSetFavorite();
  const duplicate = useDuplicatePage();
  // Keep a stable ref so the keydown handler always sees the current pageId.
  const pageIdRef = useRef(pageId);
  pageIdRef.current = pageId;

  // On narrow viewports (<= 768px) treat the sidebar as an overlay: auto-close on
  // page navigate and auto-collapse the initial state so content is not hidden.
  const mqRef = useRef(typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)') : null);
  const [isMobile, setIsMobile] = useState(() => mqRef.current?.matches ?? false);
  useEffect(() => {
    const mq = mqRef.current;
    if (!mq) return;
    const handler = (/** @type {MediaQueryListEvent} */ e) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  // Auto-collapse when first rendered on a narrow screen.
  useEffect(() => {
    if (isMobile && prefs.sidebar) updatePrefs({ sidebar: false });
  }, [isMobile]); // eslint-disable-line react-hooks/exhaustive-deps
  // Close overlay sidebar after the user picks a page on mobile.
  const selectAndClose = useCallback(
    /** @param {string | null} id */ (id) => {
      select(id);
      if (isMobile) updatePrefs({ sidebar: false });
    },
    [select, isMobile, updatePrefs],
  );

  useEffect(() => {
    /** @param {KeyboardEvent} e */
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.altKey) return;
      const key = e.key;

      // Ctrl+K — search/command palette (editor uses it for links so respect defaultPrevented)
      if (key.toLowerCase() === 'k' && !e.shiftKey && !e.defaultPrevented) {
        e.preventDefault();
        setSearching((o) => !o);
      }
      // Ctrl+S — flush autosave immediately (prevent browser Save dialog)
      if (key.toLowerCase() === 's' && !e.shiftKey) { e.preventDefault(); window.dispatchEvent(new CustomEvent('papier:save')); }
      // Ctrl+/ — keyboard shortcuts dialog
      if (key === '/' && !e.shiftKey) { e.preventDefault(); setShortcuts((o) => !o); }
      // Ctrl+\ — sidebar toggle
      if (key === '\\' && !e.shiftKey) { e.preventDefault(); updatePrefs((p) => ({ sidebar: !p.sidebar })); }

      // ── Navigation shortcuts ──
      if (!e.shiftKey) return;
      // Ctrl+Shift+H — Home
      if (key.toLowerCase() === 'h') { e.preventDefault(); select(null); }
      // Ctrl+Shift+T — Templates
      if (key.toLowerCase() === 't') { e.preventDefault(); setLibrary({ parentId: null }); }
      // Ctrl+Shift+X — Trash
      if (key.toLowerCase() === 'x') { e.preventDefault(); setTrash(true); }
      // Ctrl+Shift+F — Toggle favourite on current page
      if (key.toLowerCase() === 'f' && pageIdRef.current) {
        e.preventDefault();
        const page = pageData?.page;
        if (page && !page.isTemplate && !pageData?.inTemplate) {
          setFavorite.mutate({ id: page.id, favorite: !page.favorite });
        }
      }
      // Ctrl+Shift+A — Ask AI
      if (key.toLowerCase() === 'a') { e.preventDefault(); setAiOpen((o) => !o); }
      // Ctrl+Shift+D — Duplicate current page
      if (key.toLowerCase() === 'd' && pageIdRef.current) {
        e.preventDefault();
        const page = pageData?.page;
        if (page && !page.isTemplate) {
          duplicate.mutate({ id: page.id }, { onSuccess: (copy) => select(copy.id) });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [updatePrefs, select, pageData, setFavorite, duplicate]);

  const sidebarOpen = prefs.sidebar;

  return (
    <div className="relative flex h-full overflow-hidden">
      <Backdrop />
      {/* On mobile the sidebar is a fixed overlay; on desktop it shifts content. */}
      {isMobile && sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40"
          onClick={() => updatePrefs({ sidebar: false })}
          aria-hidden="true"
        />
      )}
      <div
        className={`${isMobile ? 'fixed inset-y-0 left-0 z-50' : 'relative'} flex shrink-0 overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none`}
        style={{ width: sidebarOpen ? 260 : 0 }}
        inert={!sidebarOpen}
      >
        <Sidebar
          selectedId={pageId}
          atHome={atHome}
          onSelect={selectAndClose}
          onSearch={() => { setSearching(true); if (isMobile) updatePrefs({ sidebar: false }); }}
          onTemplates={() => setLibrary({ parentId: null })}
          onShortcuts={() => setShortcuts(true)}
          onCollapse={() => updatePrefs({ sidebar: false })}
          onSettings={() => setSettingsOpen(true)}
          onTrash={() => setTrash(true)}
        />
      </div>
      <main className="relative flex min-w-0 flex-1 flex-col">
        <Topbar selectedId={pageId} onSelect={selectAndClose} prefs={prefs} onChange={updatePrefs} onAi={() => setAiOpen(true)} />
        <div className="relative flex min-h-0 flex-1">
          <Page selectedId={pageId} onSelect={selectAndClose} onTemplates={setLibrary} />
          <RowPeek onSelect={selectAndClose} />
        </div>
      </main>
      {searching && (
        <CommandPalette
          onClose={() => setSearching(false)}
          onSelect={select}
          selectedId={pageId}
          prefs={prefs}
          onPrefs={updatePrefs}
          onTrash={() => setTrash(true)}
          onTemplates={() => setLibrary({ parentId: null })}
          onShortcuts={() => setShortcuts(true)}
          onSettings={() => setSettingsOpen(true)}
          onAi={() => { setSearching(false); setAiOpen(true); }}
        />
      )}
      {trash && <TrashDialog onClose={() => setTrash(false)} onOpen={select} />}
      {settingsOpen && (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          prefs={prefs}
          onChange={updatePrefs}
        />
      )}
      {shortcuts && <ShortcutsDialog onClose={() => setShortcuts(false)} />}
      {aiOpen && (
        <AiPanel
          onClose={() => setAiOpen(false)}
          selectedId={pageId}
          selectedTitle={pageData?.page?.title ?? null}
          onSelect={select}
        />
      )}
      {library && <TemplateLibrary target={library} onClose={() => setLibrary(null)} onOpen={select} />}
      <Toaster />
    </div>
  );
}
