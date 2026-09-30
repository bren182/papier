export class ApiError extends Error {
  /** @param {number} status @param {string} message @param {Record<string, unknown>} [data] the error body */
  constructor(status, message, data = {}) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

/**
 * JSON fetch against the papier server. Throws ApiError on non-2xx.
 * @param {string} path  path under /api, e.g. '/pages'
 * @param {{ method?: string, body?: unknown, keepalive?: boolean }} [opts]
 *   keepalive lets a request outlive the page (saves on tab close).
 */
export async function api(path, { method = 'GET', body, keepalive } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    keepalive,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.error ?? res.statusText, data);
  }
  return res.status === 204 ? null : res.json();
}
