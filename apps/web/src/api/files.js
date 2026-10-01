import { chosenWorkspaceId } from './workspaces.js';
import { ApiError, UNAUTHORIZED_EVENT } from './client.js';

/**
 * Upload a file to POST /api/files.  Returns { id, url } where url is a
 * /files/<uuid>.ext path served with immutable headers — safe to embed in
 * `src` attributes and page covers.
 * @param {File} file
 * @returns {Promise<{ id: string, url: string }>}
 */
export async function uploadFile(file) {
  /** @type {Record<string, string>} */
  const headers = { 'x-papier': '1' };
  const workspace = chosenWorkspaceId();
  if (workspace) headers['x-papier-workspace'] = workspace;
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/files', {
    method: 'POST',
    headers,
    credentials: 'same-origin',
    body: form,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw new ApiError(res.status, data.error ?? res.statusText, data);
  }
  return res.json();
}
