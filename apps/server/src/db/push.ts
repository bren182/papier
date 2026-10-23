import { randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import webpush from 'web-push';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from './index.ts';
import { pushSubscriptions, reminders, pages, members } from './schema.ts';
import { getSetting, setSetting } from './settings.ts';

export type PushSubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

function initVapid(db: Db): string {
  let pub = getSetting(db, 'vapid_public_key');
  let priv = getSetting(db, 'vapid_private_key');
  if (!pub || !priv) {
    const kp = webpush.generateVAPIDKeys();
    setSetting(db, 'vapid_public_key', kp.publicKey);
    setSetting(db, 'vapid_private_key', kp.privateKey);
    pub = kp.publicKey;
    priv = kp.privateKey;
  }
  webpush.setVapidDetails('mailto:papier@localhost', pub, priv);
  return pub;
}

export function getVapidPublicKey(db: Db): string {
  return initVapid(db);
}

export function saveSubscription(db: Db, userId: string, sub: PushSubscriptionInput) {
  db.insert(pushSubscriptions)
    .values({
      id: randomBytes(12).toString('hex'),
      userId,
      endpoint: sub.endpoint,
      keysP256dh: sub.keys.p256dh,
      keysAuth: sub.keys.auth,
      createdAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId, keysP256dh: sub.keys.p256dh, keysAuth: sub.keys.auth },
    })
    .run();
}

export function removeSubscription(db: Db, endpoint: string) {
  db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)).run();
}

/**
 * Send push notifications for every reminder due on `today`. Idempotent — skips
 * if already sent today (tracked in server_settings). Called hourly by the scheduler.
 */
export async function sendDueReminderPush(db: Db, today: string, log: FastifyBaseLogger) {
  if (getSetting(db, 'push_sent_date') === today) return;

  initVapid(db);

  const subs = db.select().from(pushSubscriptions).all();
  if (!subs.length) {
    setSetting(db, 'push_sent_date', today);
    return;
  }

  for (const sub of subs) {
    const due = db
      .select({ id: reminders.id, pageTitle: pages.title, pageIcon: pages.icon })
      .from(reminders)
      .innerJoin(pages, eq(reminders.pageId, pages.id))
      .innerJoin(members, eq(members.workspaceId, pages.workspaceId))
      .where(and(eq(reminders.date, today), eq(members.userId, sub.userId), isNull(pages.archivedAt)))
      .all();

    if (!due.length) continue;

    const first = due[0]!;
    const body =
      due.length === 1
        ? first.pageTitle || 'Untitled'
        : `${first.pageTitle || 'Untitled'} and ${due.length - 1} more`;

    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.keysP256dh, auth: sub.keysAuth } },
        JSON.stringify({ title: 'Reminders due today', body, url: '/', tag: `reminders-${today}` }),
      );
      log.info({ userId: sub.userId, count: due.length }, 'Sent push reminder notification');
    } catch (err: unknown) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 410 || status === 404) {
        removeSubscription(db, sub.endpoint);
        log.info({ endpoint: sub.endpoint }, 'Removed expired push subscription');
      } else {
        log.warn({ err }, 'Push notification failed');
      }
    }
  }

  setSetting(db, 'push_sent_date', today);
}
