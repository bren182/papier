import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

/**
 * @typedef {{ id: string, email: string, name: string, isAdmin: boolean, isDemo: boolean }} User
 * @typedef {'owner' | 'editor' | 'viewer'} Role
 * @typedef {{ id: string, name: string, icon: string | null, role: Role, homePageId: string | null }} Workspace
 *   homePageId: the page `/` opens (null: none, or it's in the trash)
 * @typedef {{ setupNeeded: boolean, user: User | null, workspaces: Workspace[] }} AuthState
 */

export const authKey = ['auth'];

/** Who is signed in (null user = signed out), and whether the server still needs its first account. */
export function useAuthState() {
  return useQuery({
    queryKey: authKey,
    queryFn: () => /** @type {Promise<AuthState>} */ (api('/auth/state')),
    staleTime: Infinity,
    retry: 1,
  });
}

/** After signing in: fetch the state that goes with the new session. */
function useSignedIn() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: authKey });
}

export function useLogin() {
  const done = useSignedIn();
  return useMutation({
    /** @param {{ email: string, password: string }} input */
    mutationFn: (input) => api('/auth/login', { method: 'POST', body: input }),
    onSuccess: done,
  });
}

export function useSetup() {
  const done = useSignedIn();
  return useMutation({
    /** @param {{ setupToken: string, email: string, name: string, password: string, workspaceName?: string }} input */
    mutationFn: (input) => api('/auth/setup', { method: 'POST', body: input }),
    onSuccess: done,
  });
}

/** Signs out: drops every cached query, so nothing of this account stays in memory. */
export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      // Signed out first (the gate unmounts the app), then forget the rest.
      qc.setQueryData(authKey, /** @type {AuthState} */ ({ setupNeeded: false, user: null, workspaces: [] }));
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== authKey[0] });
    },
  });
}

/** Start (or reset) the demo session — no account needed. */
export function useDemoStart() {
  const done = useSignedIn();
  return useMutation({
    mutationFn: () => api('/demo/start', { method: 'POST' }),
    onSuccess: done,
  });
}

export function useChangePassword() {
  return useMutation({
    /** @param {{ current: string, next: string }} input */
    mutationFn: (input) => api('/auth/password', { method: 'POST', body: input }),
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    /** @param {{ name: string }} input */
    mutationFn: (input) => /** @type {Promise<User>} */ (api('/auth/me', { method: 'PATCH', body: input })),
    onSuccess: (user) => qc.setQueryData(authKey, (/** @type {AuthState | undefined} */ s) => (s ? { ...s, user } : s)),
  });
}
