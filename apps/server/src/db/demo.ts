import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { orderBetween } from '@papier/core';
import type { Db } from './index.ts';
import { purgePages } from './trash.ts';
import { blocks, members, pages, sessions, users, workspaces } from './schema.ts';
import { DEMO_SESSION_TTL_MS } from '../auth/sessions.ts';

/** Wipe any existing demo user+workspace, create a fresh one, seed starter content, return a raw session token. */
export function startDemo(db: Db, now = Date.now()): string {
  return db.transaction((tx) => {
    // --- 1. Purge all existing demo users ---
    const demoUsers = tx.select({ id: users.id }).from(users).where(eq(users.isDemo, true)).all();
    for (const { id: uid } of demoUsers) {
      const wsIds = tx
        .select({ id: members.workspaceId })
        .from(members)
        .where(and(eq(members.userId, uid), eq(members.role, 'owner')))
        .all()
        .map((r) => r.id);
      for (const wsId of wsIds) {
        const rootIds = tx
          .select({ id: pages.id })
          .from(pages)
          .where(and(eq(pages.workspaceId, wsId), isNull(pages.parentId)))
          .all()
          .map((r) => r.id);
        if (rootIds.length) purgePages(tx, rootIds);
        tx.delete(workspaces).where(eq(workspaces.id, wsId)).run();
      }
      tx.delete(users).where(eq(users.id, uid)).run();
    }

    // --- 2. Create fresh demo user + workspace ---
    const userId = randomUUID();
    const workspaceId = randomUUID();
    tx.insert(users)
      .values({ id: userId, email: 'demo@papier.local', name: 'Demo', passwordHash: '', isAdmin: false, isDemo: true, createdAt: now })
      .run();
    tx.insert(workspaces).values({ id: workspaceId, name: 'Demo Workspace', createdAt: now }).run();
    tx.insert(members).values({ workspaceId, userId, role: 'owner', createdAt: now }).run();

    // --- 3. Seed a welcome page with a few blocks ---
    const pageId = randomUUID();
    tx.insert(pages)
      .values({ id: pageId, workspaceId, parentId: null, title: 'Welcome to Papier', icon: '👋', kind: 'page', orderKey: orderBetween(null, null), createdAt: now, updatedAt: now })
      .run();

    const o1 = orderBetween(null, null);
    const o2 = orderBetween(o1, null);
    const o3 = orderBetween(o2, null);
    const o4 = orderBetween(o3, null);
    const o5 = orderBetween(o4, null);
    tx.insert(blocks).values([
      { id: randomUUID(), pageId, parentId: null, type: 'heading1', orderKey: o1, props: {}, content: [{ type: 'text', text: 'Welcome to Papier 👋', styles: {} }], createdAt: now, updatedAt: now },
      { id: randomUUID(), pageId, parentId: null, type: 'paragraph', orderKey: o2, props: {}, content: [{ type: 'text', text: 'This is a temporary demo workspace. Anything you create here will be cleared when the session ends (4 hours max).', styles: {} }], createdAt: now, updatedAt: now },
      { id: randomUUID(), pageId, parentId: null, type: 'paragraph', orderKey: o3, props: {}, content: [{ type: 'text', text: 'Try the editor: type / to insert blocks, @ for dates and page links, or drag the ⠿ handle to reorder.', styles: {} }], createdAt: now, updatedAt: now },
      { id: randomUUID(), pageId, parentId: null, type: 'todo', orderKey: o4, props: { checked: false }, content: [{ type: 'text', text: 'Create a new page in the sidebar', styles: {} }], createdAt: now, updatedAt: now },
      { id: randomUUID(), pageId, parentId: null, type: 'todo', orderKey: o5, props: { checked: false }, content: [{ type: 'text', text: 'Try /database to start a table', styles: {} }], createdAt: now, updatedAt: now },
    ]).run();

    // --- 4. Issue demo session (4h fixed TTL, no sliding) ---
    const token = randomBytes(32).toString('base64url');
    const sessionId = createHash('sha256').update(token).digest('hex');
    tx.insert(sessions)
      .values({ id: sessionId, userId, kind: 'cookie', userAgent: null, createdAt: now, lastSeenAt: now, expiresAt: now + DEMO_SESSION_TTL_MS })
      .run();

    return token;
  });
}

/** Called hourly: delete demo users whose every session has expired. */
export function purgeExpiredDemos(db: Db, now = Date.now()): number {
  // Find demo users that have no live session remaining.
  const demoUsers = db.select({ id: users.id }).from(users).where(eq(users.isDemo, true)).all();
  const expired = demoUsers.filter(({ id }) => {
    const live = db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.userId, id), gt(sessions.expiresAt, now)))
      .get();
    return !live;
  });

  for (const { id: uid } of expired) {
    const wsIds = db
      .select({ id: members.workspaceId })
      .from(members)
      .where(and(eq(members.userId, uid), eq(members.role, 'owner')))
      .all()
      .map((r) => r.id);
    db.transaction((tx) => {
      for (const wsId of wsIds) {
        const rootIds = tx
          .select({ id: pages.id })
          .from(pages)
          .where(and(eq(pages.workspaceId, wsId), isNull(pages.parentId)))
          .all()
          .map((r) => r.id);
        if (rootIds.length) purgePages(tx, rootIds);
        tx.delete(workspaces).where(eq(workspaces.id, wsId)).run();
      }
      tx.delete(users).where(eq(users.id, uid)).run();
    });
  }
  return expired.length;
}
