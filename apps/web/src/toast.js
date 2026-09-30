import { useSyncExternalStore } from 'react';

/**
 * Toasts: short messages at the bottom of the screen ("Reminder → Dec 11, 2027 ·
 * Undo"). A tiny store in the main bundle, so lazy chunks (editor, databases)
 * can show them; `Toaster` renders them.
 *
 * @typedef {{ id: number, text: string, action?: { label: string, run: () => void | Promise<void> }, tone?: 'info' | 'error' }} Toast
 */

/** @type {Toast[]} */
let toasts = [];
/** @type {Set<() => void>} */
const listeners = new Set();
let seq = 0;

const emit = () => {
  for (const l of listeners) l();
};

/** Show a toast; it goes away after `ms`. Returns its id. @param {Omit<Toast, 'id'>} toast @param {number} [ms] */
export function showToast(toast, ms = 6000) {
  const id = ++seq;
  // One at a time reads best: a newer result replaces the older one.
  toasts = [...toasts.slice(-2), { ...toast, id }];
  emit();
  setTimeout(() => dismissToast(id), ms);
  return id;
}

/** @param {number} id */
export function dismissToast(id) {
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** @returns {Toast[]} */
export function useToasts() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
  );
}
