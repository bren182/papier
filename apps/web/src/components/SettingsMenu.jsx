import { useState } from 'react';
import { FONTS, THEMES } from '@papier/ui';
import { MIN_PASSWORD } from '@papier/core/text';
import { useAuthState, useChangePassword, useLogout, useUpdateProfile } from '../api/auth.js';
import { field, menuItem, menuLabel, Popover } from './database/Popover.jsx';
import { MoodOption } from './PageHeader.jsx';

/** Who is signed in: rename, change password, sign out. */
function Account() {
  const { data } = useAuthState();
  const rename = useUpdateProfile();
  const logout = useLogout();
  const change = useChangePassword();
  const [pw, setPw] = useState(/** @type {{ current: string, next: string } | null} */ (null));
  const user = data?.user;
  if (!user) return null;
  return (
    <>
      <div className={menuLabel}>Account</div>
      <div className="flex flex-col gap-1 px-2 pb-1">
        <input
          key={user.name}
          className={field}
          defaultValue={user.name}
          aria-label="Your name"
          onBlur={(e) => {
            const name = e.target.value.trim();
            if (name && name !== user.name) rename.mutate({ name });
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <div className="truncate text-[12px] text-faint">{user.email}</div>
      </div>
      {pw ? (
        <form
          className="flex flex-col gap-1.5 px-2 pb-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            change.mutate(pw, { onSuccess: () => setPw(null) });
          }}
        >
          <input className={field} type="password" autoComplete="current-password" placeholder="Current password" autoFocus required value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          <input className={field} type="password" autoComplete="new-password" placeholder={`New password (${MIN_PASSWORD}+ characters)`} minLength={MIN_PASSWORD} required value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          {change.isError && <div className="text-[12px] text-fg">{change.error.message}</div>}
          <div className="flex justify-end gap-1">
            <button type="button" className="rounded-md px-2 py-1 text-[12px] text-muted hover:bg-hover" onClick={() => setPw(null)}>Cancel</button>
            <button type="submit" className="rounded-md px-2 py-1 text-[12px] text-accent hover:bg-hover" disabled={change.isPending}>Change</button>
          </div>
        </form>
      ) : (
        <button type="button" className={menuItem} onClick={() => { change.reset(); setPw({ current: '', next: '' }); }}>
          {change.isSuccess ? 'Password changed ✓ — other devices signed out' : 'Change password…'}
        </button>
      )}
      <button type="button" className={menuItem} onClick={() => logout.mutate()} disabled={logout.isPending}>
        Sign out
      </button>
      <div className="my-1 h-px bg-line" />
    </>
  );
}

/**
 * Settings: the account, then display settings (this device): colour theme, ambient or grayscale, glass,
 * motion. The same prefs the top bar toggles.
 * @param {{ anchor: HTMLElement | null, onClose: () => void, prefs: import('../usePrefs.js').Prefs,
 *   onChange: (patch: Partial<import('../usePrefs.js').Prefs>) => void, onAi: () => void }} props
 */
export function SettingsMenu({ anchor, onClose, prefs, onChange, onAi }) {
  const toggle = (/** @type {string} */ label, /** @type {boolean} */ on, /** @type {() => void} */ flip) => (
    <button type="button" className={menuItem} onClick={flip} aria-pressed={on}>
      <span className="flex-1">{label}</span>
      {on && <span className="text-accent">✓</span>}
    </button>
  );
  return (
    <Popover anchor={anchor} onClose={onClose} width={260}>
      <Account />
      <div className={menuLabel}>Theme</div>
      <div className="flex flex-col gap-0.5 px-1 pb-1" aria-label="Themes">
        {THEMES.map((t) => (
          <MoodOption key={t.id} label={t.name} swatches={t.swatches} selected={prefs.theme === t.id} onClick={() => onChange({ theme: t.id })} />
        ))}
      </div>
      <div className="px-2 pb-1 text-[11px] text-faint">A page can set its own mood (Customise, above its title).</div>
      <div className="my-1 h-px bg-line" />
      <div className={menuLabel}>Font</div>
      <div className="flex flex-col gap-0.5 px-1 pb-1">
        {FONTS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => onChange({ font: f.id })}
            className={`flex h-8 items-center gap-2.5 rounded px-2 text-[13px] hover:bg-hover ${prefs.font === f.id ? 'text-fg-strong' : 'text-muted'}`}
          >
            <span className={`size-1.5 shrink-0 rounded-full ${prefs.font === f.id ? 'bg-accent' : 'bg-line'}`} />
            <span style={{ fontFamily: f.css }} className="flex-1 text-left">{f.name}</span>
            {prefs.font === f.id && <span className="text-accent text-[10px]">✓</span>}
          </button>
        ))}
      </div>
      <div className="my-1 h-px bg-line" />
      <div className={menuLabel}>Display</div>
      {toggle('Grayscale backdrop', prefs.mode === 'grayscale', () => onChange({ mode: prefs.mode === 'grayscale' ? 'ambient' : 'grayscale' }))}
      {prefs.mode === 'ambient' && toggle('Clear glass', prefs.glass === 'clear', () => onChange({ glass: prefs.glass === 'clear' ? 'frosted' : 'clear' }))}
      {toggle('Motion', prefs.motion, () => onChange({ motion: !prefs.motion }))}
      <div className="my-1 h-px bg-line" />
      <button type="button" className={menuItem} onClick={() => { onClose(); onAi(); }}>
        <span className="flex-1">✦ AI &amp; Ollama…</span>
      </button>
    </Popover>
  );
}
