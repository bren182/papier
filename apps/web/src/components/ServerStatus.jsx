import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

/** @returns {boolean | null} null while the first check is in flight */
export function useServerHealth() {
  const [online, setOnline] = useState(/** @type {boolean | null} */ (null));

  useEffect(() => {
    let cancelled = false;
    const check = () =>
      api('/health')
        .then(() => true, () => false)
        .then((ok) => {
          if (!cancelled) setOnline(ok);
        });
    check();
    const id = setInterval(check, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return online;
}

/**
 * Quiet unless something is wrong: nothing while the server answers, an
 * "Offline" pill (edits may not save) when it doesn't.
 */
export function ServerStatus() {
  const online = useServerHealth();
  if (online !== false) return null;
  return (
    <span
      role="status"
      title="Can't reach the Papier server. Edits may not save until it's back."
      className="flex shrink-0 items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[12px] text-muted"
    >
      <span className="size-1.5 rounded-full bg-faint" />
      Offline
    </span>
  );
}
