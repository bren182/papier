import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, count, eq, gt, lte, ne } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { liveLineage } from '../db/lineage.ts';
import type { Conn } from '../db/props.ts';
import { DEFAULT_WORKSPACE_ID, members, sessions, users, workspaces } from '../db/schema.ts';

/** Sessions slide: each use pushes expiry to now + this. */
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
/** Demo sessions: fixed 4-hour window, no sliding. */
export const DEMO_SESSION_TTL_MS = 4 * 60 * 60 * 1000;
/** `last_seen_at` / expiry are written at most this often per session. */
const TOUCH_MS = 60_000;

export type SessionKind = 'cookie' | 'token';
export type AuthUser = { id: string; email: string; name: string; isAdmin: boolean; isDemo: boolean };
export type Role = 'owner' | 'editor' | 'viewer';

const tokenId = (token: string) => createHash('sha256').update(token).digest('hex');

/** A new session; returns the token the client keeps (only its hash is stored). */
export function createSession(db: Conn, userId: string, kind: SessionKind, userAgent?: string | null, now = Date.now()) {
  const token = randomBytes(32).toString('base64url');
  db.insert(sessions)
    .values({ id: tokenId(token), userId, kind, userAgent: userAgent?.slice(0, 300) ?? null, createdAt: now, lastSeenAt: now, expiresAt: now + SESSION_TTL_MS })
    .run();
  return token;
}

/** The session's user, or null when the token is unknown or expired. Slides the expiry (except for demo sessions). */
export function resolveSession(db: Conn, token: string, now = Date.now()): { user: AuthUser; sessionId: string } | null {
  const id = tokenId(token);
  const row = db
    .select({ id: users.id, email: users.email, name: users.name, isAdmin: users.isAdmin, isDemo: users.isDemo, lastSeenAt: sessions.lastSeenAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now)))
    .get();
  if (!row) return null;
  if (!row.isDemo && now - row.lastSeenAt > TOUCH_MS) {
    db.update(sessions).set({ lastSeenAt: now, expiresAt: now + SESSION_TTL_MS }).where(eq(sessions.id, id)).run();
  }
  const { lastSeenAt: _, ...user } = row;
  return { user, sessionId: id };
}

export function revokeSession(db: Conn, sessionId: string) {
  db.delete(sessions).where(eq(sessions.id, sessionId)).run();
}

/** Signs the user out everywhere, except (optionally) the session making the request. */
export function revokeUserSessions(db: Conn, userId: string, keepSessionId?: string) {
  db.delete(sessions)
    .where(keepSessionId ? and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId)) : eq(sessions.userId, userId))
    .run();
}

export function purgeExpiredSessions(db: Conn, now = Date.now()) {
  return db.delete(sessions).where(lte(sessions.expiresAt, now)).run().changes;
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function findUserByEmail(db: Conn, email: string) {
  return db.select().from(users).where(eq(users.email, normalizeEmail(email))).get() ?? null;
}

export function userCount(db: Conn) {
  return db.select({ n: count() }).from(users).get()!.n;
}

type NewUser = { email: string; name: string; passwordHash: string; isAdmin?: boolean; isDemo?: boolean };

/** Creates a user (throws on a taken email — check first). Hash with `hashPassword` beforehand, so this stays synchronous. */
export function createUser(db: Conn, input: NewUser, now = Date.now()) {
  const user = { id: randomUUID(), email: normalizeEmail(input.email), name: input.name.trim(), isAdmin: input.isAdmin ?? false, isDemo: input.isDemo ?? false };
  db.insert(users).values({ ...user, passwordHash: input.passwordHash, createdAt: now }).run();
  return user satisfies AuthUser;
}

export function addMember(db: Conn, workspaceId: string, userId: string, role: Role, now = Date.now()) {
  db.insert(members).values({ workspaceId, userId, role, createdAt: now }).onConflictDoUpdate({ target: [members.workspaceId, members.userId], set: { role } }).run();
}

export type WorkspaceInfo = { id: string; name: string; icon: string | null; role: Role; homePageId: string | null };

/** The workspaces a user belongs to, oldest membership first. `homePageId` is null while that page is in the trash. */
export function userWorkspaces(db: Conn, userId: string): WorkspaceInfo[] {
  const rows = db
    .select({ id: workspaces.id, name: workspaces.name, icon: workspaces.icon, role: members.role, homePageId: workspaces.homePageId })
    .from(members)
    .innerJoin(workspaces, eq(workspaces.id, members.workspaceId))
    .where(eq(members.userId, userId))
    .orderBy(members.createdAt, workspaces.id)
    .all() as WorkspaceInfo[];
  return rows.map((w) => ({ ...w, homePageId: w.homePageId && liveLineage(db as Db, w.homePageId) ? w.homePageId : null }));
}

/** The user's role in a workspace, or null when not a member. */
export function memberRole(db: Conn, workspaceId: string, userId: string) {
  const row = db
    .select({ role: members.role })
    .from(members)
    .where(and(eq(members.workspaceId, workspaceId), eq(members.userId, userId)))
    .get();
  return (row?.role as Role | undefined) ?? null;
}

/**
 * The first account: an admin who owns the default workspace (the one migration
 * 0011 adopted every existing page into), creating it if it's gone.
 */
export function createOwner(db: Conn, input: NewUser & { workspaceName?: string }, now = Date.now()) {
  const user = createUser(db, { ...input, isAdmin: true }, now);
  const existing = db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, DEFAULT_WORKSPACE_ID)).get();
  if (!existing) db.insert(workspaces).values({ id: DEFAULT_WORKSPACE_ID, name: 'Papier', createdAt: now }).run();
  if (input.workspaceName?.trim()) db.update(workspaces).set({ name: input.workspaceName.trim() }).where(eq(workspaces.id, DEFAULT_WORKSPACE_ID)).run();
  addMember(db, DEFAULT_WORKSPACE_ID, user.id, 'owner', now);
  return user;
}
