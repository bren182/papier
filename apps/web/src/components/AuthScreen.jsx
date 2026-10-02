import { useState } from 'react';
import { MIN_PASSWORD } from '@papier/core/text';
import { useLogin, useSetup } from '../api/auth.js';
import { ApiError } from '../api/client.js';
import { usePrefs } from '../usePrefs.js';

const field =
  'h-9 w-full rounded-md border border-line bg-black/20 px-2.5 text-[14px] text-fg-strong placeholder:text-faint focus:border-accent focus:outline-none';
const label = 'mb-1 block text-[12px] text-muted';
const primary =
  'mt-2 h-9 w-full rounded-md bg-accent text-[14px] font-medium text-root hover:brightness-110 disabled:opacity-60 disabled:hover:brightness-100';

/** @param {unknown} err */
function message(err) {
  if (!(err instanceof ApiError)) return "Can't reach the server.";
  const issue = /** @type {{ issues?: { path: string[], message: string }[] }} */ (err.data).issues?.[0];
  if (issue) return issue.path[0] === 'email' ? 'That email looks wrong.' : issue.message;
  if (err.status === 429) return `Too many attempts. Try again in ${err.data.retryAfter ?? 'a few'} seconds.`;
  return err.message;
}

/**
 * The glass card the auth forms sit in.
 * @param {{ title: string, subtitle?: string, children: import('react').ReactNode }} props
 */
function Card({ title, subtitle, children }) {
  return (
    <div className="p-glass relative w-full max-w-[360px] rounded-xl border border-line bg-s-page px-7 py-8 shadow-2xl">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <img src="/pwa-192x192.png" alt="Papier" className="size-14 rounded-2xl" />
        <h1 className="font-display text-[26px] leading-tight text-fg-strong">{title}</h1>
        {subtitle && <p className="text-[13px] text-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

/** @param {{ onDone?: () => void }} props */
function LoginForm({ onDone }) {
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        login.mutate({ email, password }, { onSuccess: () => onDone?.() });
      }}
    >
      <div>
        <label className={label} htmlFor="login-email">Email</label>
        <input id="login-email" className={field} type="email" autoComplete="username" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <label className={label} htmlFor="login-password">Password</label>
        <input id="login-password" className={field} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {login.isError && <p role="alert" className="text-[13px] text-fg">{message(login.error)}</p>}
      <button type="submit" className={primary} disabled={login.isPending}>
        {login.isPending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

function SetupForm() {
  const setup = useSetup();
  const [form, setForm] = useState({ setupToken: '', name: '', email: '', password: '', workspaceName: '' });
  /** @param {keyof typeof form} key */
  const bind = (key) => ({ value: form[key], onChange: (/** @type {import('react').ChangeEvent<HTMLInputElement>} */ e) => setForm({ ...form, [key]: e.target.value }) });
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setup.mutate({ ...form, workspaceName: form.workspaceName.trim() || undefined });
      }}
    >
      <div>
        <label className={label} htmlFor="setup-token">Setup token</label>
        <input id="setup-token" className={`${field} font-mono`} autoComplete="off" autoFocus required {...bind('setupToken')} />
        <p className="mt-1 text-[11px] text-faint">Printed in the server log when it starts without accounts.</p>
      </div>
      <div>
        <label className={label} htmlFor="setup-name">Your name</label>
        <input id="setup-name" className={field} autoComplete="name" required {...bind('name')} />
      </div>
      <div>
        <label className={label} htmlFor="setup-email">Email</label>
        <input id="setup-email" className={field} type="email" autoComplete="username" required {...bind('email')} />
      </div>
      <div>
        <label className={label} htmlFor="setup-password">Password</label>
        <input id="setup-password" className={field} type="password" autoComplete="new-password" minLength={MIN_PASSWORD} required {...bind('password')} />
      </div>
      <div>
        <label className={label} htmlFor="setup-workspace">Workspace name</label>
        <input id="setup-workspace" className={field} placeholder="Papier" {...bind('workspaceName')} />
      </div>
      {setup.isError && <p role="alert" className="text-[13px] text-fg">{message(setup.error)}</p>}
      <button type="submit" className={primary} disabled={setup.isPending}>
        {setup.isPending ? 'Creating…' : 'Create account'}
      </button>
    </form>
  );
}

/**
 * Full-screen sign-in (or first-run setup) over the ambient backdrop.
 * @param {{ setup: boolean, onBack?: () => void }} props
 */
export function AuthScreen({ setup, onBack }) {
  usePrefs(); // theme, mode and glass for the backdrop; the app isn't mounted yet
  return (
    <div className="relative grid h-full place-items-center overflow-y-auto px-4 py-10">
      {/* Full-bleed photo background with frosted glass overlay */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/login_bg.webp')", backgroundColor: '#0d0f0d' }}
        aria-hidden="true"
      />
      <div className="absolute inset-0 bg-black/25 backdrop-blur-md" aria-hidden="true" />
      {setup ? (
        <Card title="Welcome to Papier" subtitle="Create the owner account for this server.">
          <SetupForm />
        </Card>
      ) : (
        <Card title="Sign in">
          <LoginForm />
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="mt-4 w-full text-center text-[13px] text-faint hover:text-muted"
            >
              ← Back
            </button>
          )}
        </Card>
      )}
    </div>
  );
}

/**
 * Shown over the app when the session ends mid-use: the app stays mounted, so
 * unsaved edits survive and are saved once signed back in.
 * @param {{ onDone: () => void }} props
 */
export function SessionExpired({ onDone }) {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 px-4" role="dialog" aria-modal="true" aria-label="Sign in again">
      <Card title="Signed out" subtitle="Your session ended. Sign in to keep working; unsaved edits are kept.">
        <LoginForm onDone={onDone} />
      </Card>
    </div>
  );
}
