import { Backdrop } from '@papier/ui';
import { usePrefs } from './usePrefs.js';
import { Sidebar } from './components/Sidebar.jsx';
import { Topbar } from './components/Topbar.jsx';
import { Page } from './components/Page.jsx';

export function App() {
  const [prefs, updatePrefs] = usePrefs();

  return (
    <div className="relative flex h-full overflow-hidden">
      <Backdrop />
      <Sidebar />
      <main className="relative flex min-w-0 flex-1 flex-col">
        <Topbar prefs={prefs} onChange={updatePrefs} />
        <Page />
      </main>
    </div>
  );
}
