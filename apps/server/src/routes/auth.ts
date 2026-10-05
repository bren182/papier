import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { AuthLogin, AuthSetup, PasswordChange, ProfileUpdate } from '@papier/core';
import { hashPassword, verifyPassword } from '../auth/password.ts';
import { clearSessionCookie, setSessionCookie, type CookieOptions } from '../auth/plugin.ts';
import { loginThrottle } from '../auth/rateLimit.ts';
import {
  createOwner,
  createSession,
  findUserByEmail,
  revokeSession,
  revokeUserSessions,
  SESSION_TTL_MS,
  userCount,
  userWorkspaces,
} from '../auth/sessions.ts';
import type { Db } from '../db/index.ts';
import { users } from '../db/schema.ts';
import { startDemo } from '../db/demo.ts';

export type AuthOptions = CookieOptions & {
  /** Needed to create the first account; null once there is one. */
  setupToken: () => string | null;
};

const sameSecret = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function authRoutes(app: FastifyInstance, db: Db, opts: AuthOptions) {
  const throttle = loginThrottle();
  const setupThrottle = loginThrottle({ free: 3, maxLockMs: 60 * 60_000 });

  /** What the client needs to boot: set up, sign in, or the user and their workspaces. */
  app.get('/api/auth/state', async (req) => {
    if (!req.user) return { setupNeeded: userCount(db) === 0, user: null, workspaces: [] };
    return { setupNeeded: false, user: req.user, workspaces: userWorkspaces(db, req.user.id) };
  });

  /** Start (or reset) the demo session. Public — no account needed. */
  app.post('/api/demo/start', async (req, reply) => {
    const token = startDemo(db);
    // Browser-session cookie: no Max-Age so the browser clears it when the tab closes.
    const attrs = [`papier_session=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
    if (opts.secure) attrs.push('Secure');
    reply.header('set-cookie', attrs.join('; '));
    reply.code(201);
    return {};
  });

  const signIn = (req: FastifyRequest, reply: import('fastify').FastifyReply, userId: string, client: 'web' | 'desktop') => {
    const token = createSession(db, userId, client === 'desktop' ? 'token' : 'cookie', req.headers['user-agent']);
    if (client === 'desktop') return { token };
    setSessionCookie(reply, token, SESSION_TTL_MS, opts);
    return {};
  };

  /** The first account (an admin owning the default workspace). Needs the token from the server log. */
  app.post('/api/auth/setup', async (req, reply) => {
    const key = req.ip;
    const wait = setupThrottle.wait(key);
    if (wait > 0) {
      reply.header('retry-after', Math.ceil(wait / 1000));
      return reply.code(429).send({ error: 'Too many attempts, try again shortly', retryAfter: Math.ceil(wait / 1000) });
    }
    const input = AuthSetup.parse(req.body);
    const expected = opts.setupToken();
    if (userCount(db) > 0 || !expected) return reply.code(409).send({ error: 'Already set up' });
    if (!sameSecret(input.setupToken, expected)) {
      setupThrottle.fail(key);
      return reply.code(403).send({ error: 'Wrong setup token' });
    }
    setupThrottle.succeed(key);
    const passwordHash = await hashPassword(input.password);
    // Check again after the await, in one synchronous transaction, so two racing setups can't both win.
    const user = db.transaction((tx) => (userCount(tx) > 0 ? null : createOwner(tx, { ...input, passwordHash })));
    if (!user) return reply.code(409).send({ error: 'Already set up' });
    reply.code(201);
    return { ...signIn(req, reply, user.id, 'web'), user };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const { email, password, client } = AuthLogin.parse(req.body);
    const key = `${req.ip}|${email}`;
    const wait = throttle.wait(key);
    if (wait > 0) {
      reply.header('retry-after', Math.ceil(wait / 1000));
      return reply.code(429).send({ error: 'Too many attempts, try again shortly', retryAfter: Math.ceil(wait / 1000) });
    }
    const user = findUserByEmail(db, email);
    // Hash even for unknown emails, so timing doesn't reveal which exist.
    const ok = user ? await verifyPassword(password, user.passwordHash) : (await hashPassword(password), false);
    if (!user || !ok) {
      throttle.fail(key);
      return reply.code(401).send({ error: 'Wrong email or password' });
    }
    throttle.succeed(key);
    const { id, email: e, name, isAdmin } = user;
    return { ...signIn(req, reply, id, client), user: { id, email: e, name, isAdmin } };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.sessionId) revokeSession(db, req.sessionId);
    clearSessionCookie(reply, opts);
    return reply.code(204).send();
  });

  app.patch('/api/auth/me', async (req) => {
    const { name } = ProfileUpdate.parse(req.body);
    db.update(users).set({ name }).where(eq(users.id, req.user!.id)).run();
    return { ...req.user!, name };
  });

  /** Changes the password and signs out every other session. */
  app.post('/api/auth/password', async (req, reply) => {
    const { current, next } = PasswordChange.parse(req.body);
    const user = db.select().from(users).where(eq(users.id, req.user!.id)).get();
    if (!user || !(await verifyPassword(current, user.passwordHash))) return reply.code(403).send({ error: 'Current password is wrong' });
    db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, user.id)).run();
    revokeUserSessions(db, user.id, req.sessionId ?? undefined);
    return reply.code(204).send();
  });
}
