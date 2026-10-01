import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authKey, useAuthState } from '../api/auth.js';
import { SIGNED_IN_EVENT, UNAUTHORIZED_EVENT } from '../api/client.js';
import { AuthScreen, SessionExpired } from './AuthScreen.jsx';

/**
 * Shows the app only to a signed-in user; otherwise the sign-in (or, on a
 * fresh server, the first-account setup). A session that ends mid-use keeps
 * the app mounted under a sign-in dialog, so nothing unsaved is lost.
 * @param {{ children: import('react').ReactNode }} props
 */
export function AuthGate({ children }) {
  const qc = useQueryClient();
  const { data, isError, refetch } = useAuthState();
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const onUnauthorized = () => setExpired(true);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  if (isError) {
    return (
      <div className="grid h-full place-items-center text-[14px] text-muted">
        <div className="flex flex-col items-center gap-3">
          Can't reach the Papier server.
          <button type="button" className="rounded-md px-3 py-1.5 text-fg hover:bg-hover" onClick={() => refetch()}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (!data) return null;
  if (!data.user) return <AuthScreen setup={data.setupNeeded} />;

  return (
    <>
      <div className="contents" inert={expired}>
        {children}
      </div>
      {expired && (
        <SessionExpired
          onDone={() => {
            setExpired(false);
            // Refetch what failed while signed out, and let autosave resend.
            qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== authKey[0] });
            window.dispatchEvent(new Event(SIGNED_IN_EVENT));
          }}
        />
      )}
    </>
  );
}
