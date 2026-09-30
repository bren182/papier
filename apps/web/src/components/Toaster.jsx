import { dismissToast, useToasts } from '../toast.js';

/** The toasts (see toast.js), bottom centre, newest last. */
export function Toaster() {
  const toasts = useToasts();
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`papier-popover pointer-events-auto flex max-w-[560px] items-center gap-3 px-3 py-2 text-[13px] ${t.tone === 'error' ? 'text-fg-strong' : 'text-fg'}`}
        >
          <span className="min-w-0 truncate">{t.text}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                dismissToast(t.id);
                t.action?.run();
              }}
              className="shrink-0 rounded px-1.5 py-0.5 font-medium text-accent-text hover:bg-hover"
            >
              {t.action.label}
            </button>
          )}
          <button type="button" aria-label="Dismiss" onClick={() => dismissToast(t.id)} className="shrink-0 text-muted hover:text-fg">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
