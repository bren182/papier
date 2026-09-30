export class ApiError extends Error {
  /** @param {number} status @param {string} message */
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * JSON fetch against the papier server. Throws ApiError on non-2xx.
 * @param {string} path  path under /api, e.g. '/pages'
 * @param {{ method?: string, body?: unknown }} [opts]
 */
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.error ?? res.statusText);
  }
  return res.status === 204 ? null : res.json();
}
