import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { App } from './App.jsx';
import { AuthGate } from './components/AuthGate.jsx';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

createRoot(/** @type {HTMLElement} */ (document.getElementById('root'))).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthGate>
        <App />
      </AuthGate>
    </QueryClientProvider>
  </StrictMode>,
);
