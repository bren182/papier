import { useRef, useState } from 'react';
import { useCreateShare, useDeleteShare } from '../api/share.js';

/**
 * @param {{ page: import('@papier/core').Page }} props
 */
export function ShareButton({ page }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const create = useCreateShare();
  const revoke = useDeleteShare();
  const shared = Boolean(page.shareToken);

  const shareUrl = shared ? `${window.location.origin}/?share=${page.shareToken}` : null;

  function toggle() {
    if (shared) {
      revoke.mutate(page.id);
    } else {
      create.mutate(page.id);
    }
  }

  function copy() {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl).catch(() => {});
  }

  return (
    <div className="relative">
      <button
        ref={ref}
        type="button"
        aria-label="Share this page"
        title="Share this page"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex h-7 items-center gap-1 rounded-md px-2 hover:bg-s-active ${shared ? 'text-accent' : 'text-muted hover:text-fg'}`}
      >
        <ShareIcon />
        <span className="hidden md:inline text-[11px] font-medium">Share</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-9 z-50 w-72 rounded-xl border border-line bg-s-panel shadow-lg shadow-black/20"
            role="dialog"
            aria-label="Sharing settings"
          >
            <div className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[13px] font-medium text-fg">Share this page</span>
                <button
                  type="button"
                  onClick={toggle}
                  aria-pressed={shared}
                  disabled={create.isPending || revoke.isPending}
                  className={`relative inline-flex h-5 w-9 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none disabled:opacity-50 ${shared ? 'bg-accent' : 'bg-line'}`}
                >
                  <span
                    className={`inline-block size-3.5 rounded-full bg-white shadow transition-transform ${shared ? 'translate-x-4' : 'translate-x-0.5'}`}
                  />
                </button>
              </div>

              <p className="mb-3 text-[12px] text-faint">
                {shared
                  ? 'Anyone with the link can view this page.'
                  : 'Generate a public link anyone can view — no sign-in required.'}
              </p>

              {shared && shareUrl && (
                <div className="flex items-center gap-2 rounded-lg bg-s-hover px-3 py-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted" title={shareUrl}>
                    {shareUrl}
                  </span>
                  <button
                    type="button"
                    onClick={copy}
                    className="shrink-0 rounded px-2 py-0.5 text-[11px] text-accent hover:bg-s-active"
                  >
                    Copy
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}
