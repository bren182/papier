import { useQuery } from '@tanstack/react-query';
import { api } from './client.js';

/**
 * @typedef {{ id: string, pageId: string, blockId: string, date: string, note: string,
 *   pageTitle: string | null, pageIcon: string | null }} Reminder
 */

/**
 * Reminders due on or before `date` (YYYY-MM-DD).
 * @param {string | null} date
 */
export function useReminders(date) {
  return useQuery({
    queryKey: ['reminders', date],
    queryFn: () => /** @type {Promise<Reminder[]>} */ (api(`/reminders?date=${date}`)),
    enabled: !!date,
    staleTime: 60_000,
  });
}
