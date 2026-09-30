import { useEffect, useState } from 'react';
import { Backdrop } from '@papier/ui';
import { usePrefs } from './usePrefs.js';
import { useSelectedPage } from './useSelectedPage.js';
import { Sidebar } from './components/Sidebar.jsx';
import { Topbar } from './components/Topbar.jsx';
import { Page } from './components/Page.jsx';
import { SearchDialog } from './components/SearchDialog.jsx';

export function App() {
  const [prefs, updatePrefs] = usePrefs();
  const [selectedId, select] = useSelectedPage();
  const [searching, setSearching] = useState(false);

  // Ctrl/Cmd-K anywhere opens search — unless something already used it
  // (over a text selection in the editor it makes a link).
  useEffect(() => {
    /** @param {KeyboardEvent} e */
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k' && !e.defaultPrevented) {
        e.preventDefault();
        setSearching((open) => !open);
      }
      // Ctrl/Cmd- shows or hides the sidebar (as in Notion).
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key === '\\') {
        e.preventDefault();
        updatePrefs((p) => ({ sidebar: !p.sidebar }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [updatePrefs]);

  return (
    <div className="relative flex h-full overflow-hidden">
      <Backdrop />
      {/* Collapsing slides the sidebar out; it stays mounted so its tree state survives. */}
      <div
        className="relative flex shrink-0 overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none"
        style={{ width: prefs.sidebar ? 260 : 0 }}
        inert={!prefs.sidebar}
      >
        <Sidebar selectedId={selectedId} onSelect={select} onSearch={() => setSearching(true)} onCollapse={() => updatePrefs({ sidebar: false })} />
      </div>
      <main className="relative flex min-w-0 flex-1 flex-col">
        <Topbar selectedId={selectedId} onSelect={select} prefs={prefs} onChange={updatePrefs} />
        <Page selectedId={selectedId} onSelect={select} />
      </main>
      {searching && <SearchDialog onClose={() => setSearching(false)} onOpen={select} />}
    </div>
  );
}
