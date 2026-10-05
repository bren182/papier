import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { z } from 'zod/v4';
import { hashPassword } from '../auth/password.ts';
import { loginThrottle } from '../auth/rateLimit.ts';
import { addMember, createSession, createUser, normalizeEmail, SESSION_TTL_MS, userWorkspaces } from '../auth/sessions.ts';
import { setSessionCookie, type CookieOptions } from '../auth/plugin.ts';
import type { Db } from '../db/index.ts';
import type { Tx } from '../db/props.ts';
import { DEFAULT_WORKSPACE_ID, invites, users } from '../db/schema.ts';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const AcceptBody = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
});

export function inviteRoutes(app: FastifyInstance, db: Db, opts: CookieOptions) {
  const throttle = loginThrottle({ free: 3, maxLockMs: 60 * 60_000 });

  /** Create a single-use invite link (authenticated). */
  app.post('/api/invites', async (req, reply) => {
    const now = Date.now();
    const token = randomBytes(32).toString('hex');
    db.insert(invites).values({ id: token, createdBy: req.user!.id, createdAt: now, expiresAt: now + INVITE_TTL_MS }).run();
    reply.code(201);
    return { url: `/?join=${token}` };
  });

  /** Validate an invite token — public so the join page can check before showing the form. */
  app.get('/api/invites/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const invite = db.select().from(invites)
      .where(and(eq(invites.id, token), gt(invites.expiresAt, Date.now()), isNull(invites.usedAt)))
      .get();
    if (!invite) return reply.code(410).send({ error: 'Invite not found or expired' });
    return { valid: true };
  });

  /** Accept an invite: create account, sign in, return session. Public. */
  app.post('/api/invites/:token/accept', async (req, reply) => {
    const { token } = req.params as { token: string };
    const key = req.ip;
    const wait = throttle.wait(key);
    if (wait > 0) {
      reply.header('retry-after', Math.ceil(wait / 1000));
      return reply.code(429).send({ error: 'Too many attempts, try again shortly', retryAfter: Math.ceil(wait / 1000) });
    }

    const body = AcceptBody.parse(req.body);
    const now = Date.now();

    // Pre-check invite and email availability (before the async hash).
    const preCheck = db.transaction((tx: Tx) => {
      const invite = tx.select().from(invites)
        .where(and(eq(invites.id, token), gt(invites.expiresAt, now), isNull(invites.usedAt)))
        .get();
      if (!invite) return 'invalid' as const;
      const taken = tx.select({ id: users.id }).from(users).where(eq(users.email, normalizeEmail(body.email))).get();
      if (taken) return 'taken' as const;
      return 'ok' as const;
    });

    if (preCheck === 'invalid') {
      throttle.fail(key);
      return reply.code(410).send({ error: 'Invite not found or expired' });
    }
    if (preCheck === 'taken') {
      return reply.code(409).send({ error: 'That email is already in use' });
    }

    const passwordHash = await hashPassword(body.password);

    // Re-check invite under the async gap, then create the user atomically.
    const user = db.transaction((tx: Tx) => {
      const invite = tx.select().from(invites)
        .where(and(eq(invites.id, token), gt(invites.expiresAt, now), isNull(invites.usedAt)))
        .get();
      if (!invite) return null;
      const newUser = createUser(tx, { email: body.email, name: body.name, passwordHash });
      tx.update(invites).set({ usedAt: now, usedBy: newUser.id }).where(eq(invites.id, token)).run();
      addMember(tx, DEFAULT_WORKSPACE_ID, newUser.id, 'editor', now);
      return newUser;
    });

    if (!user) {
      throttle.fail(key);
      return reply.code(410).send({ error: 'Invite not found or expired' });
    }

    throttle.succeed(key);
    const sessionToken = createSession(db, user.id, 'cookie', req.headers['user-agent']);
    setSessionCookie(reply, sessionToken, SESSION_TTL_MS, opts);
    reply.code(201);
    const { id, email, name, isAdmin } = user;
    return { user: { id, email, name, isAdmin, isDemo: false }, workspaces: userWorkspaces(db, user.id) };
  });
}
