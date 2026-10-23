import { api } from './client.js';

/** @param {ArrayBuffer} buf */
function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** @param {PushSubscription} sub */
function serializeSub(sub) {
  // sub.toJSON() returns { endpoint, keys: { p256dh, auth } } as base64url strings
  // when the browser supports it — otherwise fall back to ArrayBuffer extraction.
  const json = sub.toJSON?.();
  if (json?.keys?.p256dh) return { endpoint: json.endpoint, keys: json.keys };
  return {
    endpoint: sub.endpoint,
    keys: {
      p256dh: b64url(/** @type {ArrayBuffer} */ (sub.getKey('p256dh'))),
      auth: b64url(/** @type {ArrayBuffer} */ (sub.getKey('auth'))),
    },
  };
}

/**
 * If the browser supports push and the service worker is active, subscribe and
 * register the subscription with the server. No-ops silently if unavailable or
 * already subscribed. Called once after notification permission is granted.
 */
export async function ensurePushSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) return; // already subscribed on this device

    const { publicKey } = await api('/push/vapid-key');
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
    await api('/push/subscribe', { method: 'POST', body: JSON.stringify(serializeSub(sub)) });
  } catch {
    // push not available (e.g. Firefox private mode, Electron, HTTP without SW)
  }
}

/**
 * Remove this device's push subscription. Called when the user explicitly
 * disables notifications.
 */
export async function removePushSubscription() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    await api('/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint: sub.endpoint }) });
    await sub.unsubscribe();
  } catch { /* ignore */ }
}
