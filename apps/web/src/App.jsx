import { Backdrop } from '@papier/ui';
import { usePrefs } from './usePrefs.js';
import { useSelectedPage } from './useSelectedPage.js';
import { Sidebar } from './components/Sidebar.jsx';
import { Topbar } from './components/Topbar.jsx';
import { Page } from './components/Page.jsx';

export function App() {
  const [prefs, updatePrefs] = usePrefs();
  const [selectedId, select] = useSelectedPage();

  return (
    <div className="relative flex h-full overflow-hidden">
      <Backdrop />
      <Sidebar selectedId={selectedId} onSelect={select} />
      <main className="relative flex min-w-0 flex-1 flex-col">
        <Topbar selectedId={selectedId} onSelect={select} prefs={prefs} onChange={updatePrefs} />
        <Page selectedId={selectedId} onSelect={select} />
      </main>
    </div>
  );
}
