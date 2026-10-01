import { useState } from 'react';
import { THEMES } from '@papier/ui';
import { MIN_PASSWORD } from '@papier/core/text';
import { useAuthState, useChangePassword, useLogout, useUpdateProfile } from '../api/auth.js';
import { MoodOption } from './PageHeader.jsx';
import { AiPanel } from './OllamaSettings.jsx';

/** @typedef {'account' | 'display' | 'ai'} Tab */

const TABS = /** @type {const} */ ([
  { id: 'account', label: 'Account' },
  { id: 'display', label: 'Display' },
  { id: 'ai', label: 'AI' },
]);

const sectionLabel = 'mb-2 text-[11px] font-medium uppercase tracking-wide text-faint';
const inputCls = 'h-8 w-full min-w-0 rounded-md border border-line bg-black/20 px-2.5 text-[13px] text-fg-strong placeholder:text-faint focus:border-accent focus:outline-none';

function AccountTab() {
  const { data } = useAuthState();
  const rename = useUpdateProfile();
  const logout = useLogout();
  const change = useChangePassword();
  const [pw, setPw] = useState(/** @type {{ current: string, next: string } | null} */ (null));
  const user = data?.user;
  if (!user) return null;
  const initials = user.name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || 'P';
  return (
    <div className="flex flex-col gap-5">
      <section>
        <div className={sectionLabel}>Profile</div>
        <div className="flex items-center gap-3 rounded-md border border-line bg-black/10 p-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-[6px] bg-accent/20 text-[13px] font-semibold text-accent">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <input
              key={user.name}
              className={inputCls}
              defaultValue={user.name}
              aria-label="Your name"
              onBlur={(e) => {
                const name = e.target.value.trim();
                if (name && name !== user.name) rename.mutate({ name });
              }}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
            <div className="mt-1 truncate px-0.5 text-[12px] text-faint">{user.email}</div>
          </div>
        </div>
      </section>

      <section>
        <div className={sectionLabel}>Password</div>
        {pw ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              change.mutate(pw, { onSuccess: () => setPw(null) });
            }}
          >
            <input className={inputCls} type="password" autoComplete="current-password" placeholder="Current password" autoFocus required value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
            <input className={inputCls} type="password" autoComplete="new-password" placeholder={`New password (${MIN_PASSWORD}+ characters)`} minLength={MIN_PASSWORD} required value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            {change.isError && <div className="text-[12px] text-fg">{change.error.message}</div>}
            <div className="flex gap-2">
              <button type="button" className="h-8 flex-1 rounded-md border border-line text-[13px] text-muted hover:bg-hover hover:text-fg" onClick={() => setPw(null)}>Cancel</button>
              <button type="submit" className="h-8 flex-1 rounded-md bg-accent text-[13px] font-medium text-root hover:brightness-110 disabled:opacity-50" disabled={change.isPending}>Change password</button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className="h-9 w-full rounded-md border border-line bg-black/10 px-3 text-left text-[13px] text-muted hover:bg-hover hover:text-fg"
            onClick={() => { change.reset(); setPw({ current: '', next: '' }); }}
          >
            {change.isSuccess ? 'Password changed ✓ — other devices signed out' : 'Change password…'}
          </button>
        )}
      </section>

      <section>
        <div className={sectionLabel}>Session</div>
        <button
          type="button"
          className="h-9 w-full rounded-md border border-line/50 bg-black/10 px-3 text-left text-[13px] text-muted hover:bg-hover hover:text-fg disabled:opacity-50"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
        >
          Sign out
        </button>
      </section>
    </div>
  );
}

/**
 * @param {{ prefs: import('../usePrefs.js').Prefs, onChange: (patch: Partial<import('../usePrefs.js').Prefs>) => void }} props
 */
function DisplayTab({ prefs, onChange }) {
  const row = (/** @type {string} */ label, /** @type {boolean} */ on, /** @type {() => void} */ flip) => (
    <button
      type="button"
      className="flex h-9 items-center justify-between rounded-md px-3 text-[13px] text-fg hover:bg-hover"
      onClick={flip}
      aria-pressed={on}
    >
      <span>{label}</span>
      <span className={`text-[11px] font-medium ${on ? 'text-accent' : 'text-faint'}`}>{on ? 'On' : 'Off'}</span>
    </button>
  );
  return (
    <div className="flex flex-col gap-5">
      <section>
        <div className={sectionLabel}>Theme</div>
        <div className="flex flex-col gap-0.5 rounded-md border border-line bg-black/10 p-1.5" aria-label="Themes">
          {THEMES.map((t) => (
            <MoodOption key={t.id} label={t.name} swatches={t.swatches} selected={prefs.theme === t.id} onClick={() => onChange({ theme: t.id })} />
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-faint">A page can override this with its own mood (Customise, above the title).</p>
      </section>

      <section>
        <div className={sectionLabel}>Options</div>
        <div className="flex flex-col rounded-md border border-line bg-black/10">
          {row('Grayscale backdrop', prefs.mode === 'grayscale', () => onChange({ mode: prefs.mode === 'grayscale' ? 'ambient' : 'grayscale' }))}
          {prefs.mode === 'ambient' && row('Clear glass', prefs.glass === 'clear', () => onChange({ glass: prefs.glass === 'clear' ? 'frosted' : 'clear' }))}
          {row('Motion', prefs.motion, () => onChange({ motion: !prefs.motion }))}
        </div>
      </section>
    </div>
  );
}

/**
 * Full settings modal: Account, Display, AI & Ollama tabs.
 * @param {{ onClose: () => void, prefs: import('../usePrefs.js').Prefs,
 *   onChange: (patch: Partial<import('../usePrefs.js').Prefs>) => void,
 *   initialTab?: Tab }} props
 */
export function SettingsDialog({ onClose, prefs, onChange, initialTab = 'account' }) {
  const [tab, setTab] = useState(/** @type {Tab} */ (initialTab));
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="papier-popover flex w-full max-w-[560px] flex-col overflow-hidden"
        style={{ maxHeight: 'min(680px, calc(100vh - 64px))' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-[15px] font-medium text-fg-strong">Settings</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-6 items-center justify-center rounded text-faint hover:bg-hover hover:text-fg"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-line px-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`-mb-px border-b-2 px-3 py-2.5 text-[13px] transition-colors ${
                tab === t.id
                  ? 'border-accent text-fg-strong'
                  : 'border-transparent text-muted hover:text-fg'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {tab === 'account' && <AccountTab />}
          {tab === 'display' && <DisplayTab prefs={prefs} onChange={onChange} />}
          {tab === 'ai' && <AiPanel />}
        </div>
      </div>
    </div>
  );
}
