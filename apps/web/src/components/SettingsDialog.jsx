import { lazy, Suspense, useState } from 'react';
import { THEMES } from '@papier/ui';
import { MIN_PASSWORD } from '@papier/core/text';
import { useAuthState, useChangePassword, useLogout, useUpdateProfile, useServerInfo } from '../api/auth.js';
import { useUpdateWorkspace, useWorkspace } from '../api/workspaces.js';
import { MoodOption } from './PageHeader.jsx';
import { AiPanel } from './OllamaSettings.jsx';

const EmojiPicker = lazy(() => import('./EmojiPicker.jsx').then((m) => ({ default: m.EmojiPicker })));

/** @typedef {'account' | 'workspace' | 'display' | 'ai' | 'about'} Tab */

const TABS = /** @type {const} */ ([
  { id: 'account', label: 'Account' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'display', label: 'Display' },
  { id: 'ai', label: 'AI' },
  { id: 'about', label: 'About' },
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

function WorkspaceTab() {
  const { workspace } = useWorkspace();
  const update = useUpdateWorkspace();
  const [picking, setPicking] = useState(false);
  if (!workspace) return null;
  const owner = workspace.role === 'owner';
  return (
    <div className="flex flex-col gap-5">
      <section>
        <div className={sectionLabel}>Identity</div>
        <div className="flex items-center gap-3 rounded-md border border-line bg-black/10 p-3">
          <button
            type="button"
            disabled={!owner}
            aria-label="Workspace icon"
            title={owner ? 'Change icon' : undefined}
            onClick={() => setPicking((o) => !o)}
            className="flex size-10 shrink-0 items-center justify-center rounded-[6px] bg-hover text-[22px] leading-none enabled:hover:ring-1 enabled:hover:ring-accent/50 disabled:opacity-60"
          >
            {workspace.icon ?? (workspace.name.trim()[0] ?? 'P').toUpperCase()}
          </button>
          <div className="min-w-0 flex-1">
            {owner ? (
              <input
                key={workspace.name}
                className={inputCls}
                defaultValue={workspace.name}
                aria-label="Workspace name"
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (name && name !== workspace.name) update.mutate({ id: workspace.id, name });
                }}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
            ) : (
              <p className="text-[13px] text-fg-strong">{workspace.name}</p>
            )}
            <p className="mt-1 text-[11px] text-faint capitalize">Your role: {workspace.role}</p>
          </div>
        </div>
        {picking && owner && (
          <div className="mt-2 rounded-md border border-line bg-black/10 p-1">
            <Suspense fallback={<div className="h-40" />}>
              <EmojiPicker
                onPick={(icon) => { update.mutate({ id: workspace.id, icon }); setPicking(false); }}
                onRemove={() => { update.mutate({ id: workspace.id, icon: null }); setPicking(false); }}
              />
            </Suspense>
          </div>
        )}
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

function AboutTab() {
  const { data } = useServerInfo();
  const row = (/** @type {string} */ label, /** @type {string} */ value) => (
    <div className="flex items-baseline justify-between px-3 py-2 text-[13px]">
      <span className="text-muted">{label}</span>
      <span className="font-mono text-[12px] text-fg-strong">{value}</span>
    </div>
  );
  return (
    <div className="flex flex-col gap-5">
      <section>
        <div className={sectionLabel}>Release</div>
        <div className="flex flex-col rounded-md border border-line bg-black/10 divide-y divide-line/50">
          {row('Version', data ? `v${data.version}` : '—')}
          {data?.sha && row('Commit', data.sha.slice(0, 10))}
        </div>
      </section>

      <section>
        <div className={sectionLabel}>Resources</div>
        <div className="flex flex-col gap-1.5">
          <a
            href="https://github.com/bren182/papier"
            target="_blank"
            rel="noreferrer"
            className="flex h-9 items-center gap-2.5 rounded-md border border-line bg-black/10 px-3 text-[13px] text-muted hover:bg-hover hover:text-fg"
          >
            <GitHubIcon />
            GitHub — source &amp; issues
          </a>
          <a
            href="https://github.com/bren182/papier/releases"
            target="_blank"
            rel="noreferrer"
            className="flex h-9 items-center gap-2.5 rounded-md border border-line bg-black/10 px-3 text-[13px] text-muted hover:bg-hover hover:text-fg"
          >
            <TagIcon />
            Releases &amp; changelog
          </a>
        </div>
      </section>

      <p className="text-[12px] text-faint">
        Papier is open source, self-hosted, and MIT licensed.
      </p>
    </div>
  );
}

function GitHubIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
      <circle cx="7" cy="7" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * Full settings modal: Account, Display, AI & About tabs.
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
          {tab === 'workspace' && <WorkspaceTab />}
          {tab === 'display' && <DisplayTab prefs={prefs} onChange={onChange} />}
          {tab === 'ai' && <AiPanel />}
          {tab === 'about' && <AboutTab />}
        </div>
      </div>
    </div>
  );
}
