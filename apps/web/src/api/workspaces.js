import { useSyncExternalStore } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { authKey, useAuthState } from './auth.js';
import { api } from './client.js';

/** @typedef {import('./auth.js').Workspace} Workspace */

const KEY = 'papier.workspace';
const EVENT = 'papier:workspace';

/** The workspace this device last chose (null: none yet — the first membership). */
export function chosenWorkspaceId() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** @param {() => void} onChange */
function subscribe(onChange) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/**
 * The current workspace (and every one the user belongs to): the one this
 * device chose, if the user is still a member, else the first.
 * @returns {{ workspace: Workspace | null, workspaces: Workspace[] }}
 */
export function useWorkspace() {
  const chosen = useSyncExternalStore(subscribe, chosenWorkspaceId);
  const { data } = useAuthState();
  const workspaces = data?.workspaces ?? [];
  return { workspace: workspaces.find((w) => w.id === chosen) ?? workspaces[0] ?? null, workspaces };
}

/**
 * Switch workspace: remember it, leave the open page (it belongs to the old
 * one) and drop every cached query but the account's.
 */
export function useSwitchWorkspace() {
  const qc = useQueryClient();
  return (/** @type {string} */ id) => {
    try {
      localStorage.setItem(KEY, id);
    } catch {
      // no storage: stays for this session only via the event below
    }
    window.dispatchEvent(new Event(EVENT));
    const url = new URL(window.location.href);
    url.searchParams.delete('p');
    url.searchParams.delete('peek');
    url.searchParams.delete('b');
    window.history.pushState(null, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== authKey[0] });
  };
}

/** Create a new workspace; the caller becomes its owner. */
export function useCreateWorkspace() {
  const qc = useQueryClient();
  const switchTo = useSwitchWorkspace();
  return useMutation({
    /** @param {{ name: string }} input */
    mutationFn: (input) => /** @type {Promise<import('./auth.js').Workspace>} */ (api('/workspaces', { method: 'POST', body: input })),
    onSuccess: (ws) => {
      qc.invalidateQueries({ queryKey: authKey });
      switchTo(ws.id);
    },
  });
}

/** Rename a workspace, change its icon, or choose its Home page (null clears it). */
export function useUpdateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    /** @param {{ id: string, name?: string, icon?: string | null, homePageId?: string | null }} input */
    mutationFn: ({ id, ...patch }) => /** @type {Promise<Workspace>} */ (api(`/workspaces/${id}`, { method: 'PATCH', body: patch })),
    onSuccess: () => qc.invalidateQueries({ queryKey: authKey }),
  });
}
