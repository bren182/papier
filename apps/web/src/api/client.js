import { chosenWorkspaceId } from './workspaces.js';

export class ApiError extends Error {
  /** @param {number} status @param {string} message @param {Record<string, unknown>} [data] the error body */
  constructor(status, message, data = {}) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

/** Fired on window when a request comes back 401: the session ended (AuthGate shows the sign-in). */
export const UNAUTHORIZED_EVENT = 'papier:unauthorized';
/** Fired on window after signing back in, so work that failed meanwhile (autosave) retries. */
export const SIGNED_IN_EVENT = 'papier:signed-in';

/**
 * JSON fetch against the papier server. Throws ApiError on non-2xx.
 * Every request carries `X-Papier` (the server's CSRF guard) and the session cookie.
 * @param {string} path  path under /api, e.g. '/pages'
 * @param {{ method?: string, body?: unknown, keepalive?: boolean }} [opts]
 *   keepalive lets a request outlive the page (saves on tab close).
 */
export async function api(path, { method = 'GET', body, keepalive } = {}) {
  /** @type {Record<string, string>} */
  const headers = { 'x-papier': '1' };
  // The workspace this device works in (server-side scoping reads it).
  const workspace = chosenWorkspaceId();
  if (workspace) headers['x-papier-workspace'] = workspace;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`/api${path}`, {
    method,
    keepalive,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    // Auth routes answer 401 for a wrong password; that isn't a lost session.
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw new ApiError(res.status, data.error ?? res.statusText, data);
  }
  return res.status === 204 ? null : res.json();
}
