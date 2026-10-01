import { lazy, Suspense, useRef, useState } from 'react';
import { useAuthState, useLogout } from '../api/auth.js';
import { useCreateWorkspace, useSwitchWorkspace, useUpdateWorkspace, useWorkspace } from '../api/workspaces.js';
import { field, menuItem, menuLabel, Popover } from './database/Popover.jsx';

const EmojiPicker = lazy(() => import('./EmojiPicker.jsx').then((m) => ({ default: m.EmojiPicker })));

/** @typedef {import('../api/auth.js').Workspace} Workspace */

/** A workspace's badge: its emoji, else its initial. @param {{ workspace: Workspace | null, size?: number }} props */
export function WorkspaceBadge({ workspace, size = 22 }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[5px] bg-hover font-display text-fg-strong"
      style={{ width: size, height: size, fontSize: size * 0.64 }}
      aria-hidden="true"
    >
      {workspace?.icon ?? (workspace?.name.trim()[0] ?? 'P').toUpperCase()}
    </span>
  );
}

/**
 * The sidebar's header: the current workspace, and a menu to switch, rename
 * it or change its icon (owners), go Home, create workspaces, and sign out.
 * @param {{ onHome: () => void, onSettings: () => void }} props
 */
export function WorkspaceMenu({ onHome, onSettings }) {
  const { workspace, workspaces } = useWorkspace();
  const [open, setOpen] = useState(false);
  const ref = useRef(/** @type {HTMLButtonElement | null} */ (null));
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="menu"
        aria-label={`Workspace: ${workspace?.name ?? 'Papier'}`}
        className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 text-left hover:bg-s-active"
      >
        <WorkspaceBadge workspace={workspace} />
        <span className="truncate text-sm font-semibold text-fg-strong">{workspace?.name ?? 'Papier'}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" className="shrink-0 text-faint" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && workspace && (
        <Panel
          anchor={ref.current}
          workspace={workspace}
          workspaces={workspaces}
          onHome={onHome}
          onSettings={onSettings}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** @param {{ anchor: HTMLElement | null, workspace: Workspace, workspaces: Workspace[], onHome: () => void, onSettings: () => void, onClose: () => void }} props */
function Panel({ anchor, workspace, workspaces, onHome, onSettings, onClose }) {
  const { data } = useAuthState();
  const update = useUpdateWorkspace();
  const create = useCreateWorkspace();
  const switchTo = useSwitchWorkspace();
  const logout = useLogout();
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const owner = workspace.role === 'owner';

  const submitCreate = (/** @type {import('react').FormEvent} */ e) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    create.mutate({ name }, { onSuccess: () => { setCreating(false); setNewName(''); onClose(); } });
  };

  return (
    <Popover anchor={anchor} onClose={onClose} width={280}>
      {/* Workspace header: icon + name */}
      <div className="flex items-center gap-2 px-2 pt-1.5 pb-1">
        <button
          type="button"
          disabled={!owner}
          aria-label="Workspace icon"
          title={owner ? 'Change icon' : undefined}
          onClick={() => setPicking(!picking)}
          className="rounded-md p-0.5 enabled:hover:bg-hover"
        >
          <WorkspaceBadge workspace={workspace} size={30} />
        </button>
        {owner ? (
          <input
            key={workspace.name}
            className={field}
            defaultValue={workspace.name}
            aria-label="Workspace name"
            onBlur={(e) => {
              const name = e.target.value.trim();
              if (name && name !== workspace.name) update.mutate({ id: workspace.id, name });
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        ) : (
          <span className="truncate text-[14px] font-medium text-fg-strong">{workspace.name}</span>
        )}
      </div>
      {picking && (
        <div className="px-1 pb-1">
          <Suspense fallback={<div className="h-40" />}>
            <EmojiPicker
              onPick={(icon) => { update.mutate({ id: workspace.id, icon }); setPicking(false); }}
              onRemove={() => { update.mutate({ id: workspace.id, icon: null }); setPicking(false); }}
            />
          </Suspense>
        </div>
      )}
      <button type="button" className={menuItem} onClick={() => { onHome(); onClose(); }}>
        {workspace.homePageId ? 'Go to Home' : 'Set up Home…'}
      </button>
      <button type="button" className={menuItem} onClick={() => { onSettings(); onClose(); }}>
        <SettingsIcon />
        Settings &amp; members
      </button>

      <div className="my-1 h-px bg-line" />

      {/* Workspace switcher */}
      <div className={menuLabel}>Workspaces</div>
      {workspaces.map((w) => (
        <button
          key={w.id}
          type="button"
          className={menuItem}
          aria-current={w.id === workspace.id}
          onClick={() => { if (w.id !== workspace.id) switchTo(w.id); onClose(); }}
        >
          <WorkspaceBadge workspace={w} size={18} />
          <span className="flex-1 truncate">{w.name}</span>
          <span className="text-[11px] text-faint capitalize">{w.role}</span>
          {w.id === workspace.id && <span className="text-accent">✓</span>}
        </button>
      ))}

      {/* Create workspace */}
      {creating ? (
        <form className="flex items-center gap-1 px-2 py-1" onSubmit={submitCreate}>
          <input
            autoFocus
            className={`${field} flex-1`}
            placeholder="Workspace name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setCreating(false)}
          />
          <button type="submit" disabled={!newName.trim() || create.isPending} className="rounded px-2 py-1 text-[12px] text-accent hover:bg-hover disabled:opacity-40">
            Create
          </button>
        </form>
      ) : (
        <button type="button" className={menuItem} onClick={() => setCreating(true)}>
          <PlusIcon />
          Create workspace…
        </button>
      )}

      <div className="my-1 h-px bg-line" />
      <div className="truncate px-2 pb-1 text-[12px] text-faint">{data?.user?.email}</div>
      <button type="button" className={menuItem} onClick={() => logout.mutate()} disabled={logout.isPending}>
        Sign out
      </button>
    </Popover>
  );
}

function SettingsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
