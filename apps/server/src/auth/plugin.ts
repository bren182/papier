import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/index.ts';
import { resolveSession, type AuthUser } from './sessions.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /** The signed-in user; null for public routes (and in-process system calls). */
    user: AuthUser | null;
    /** The session making the request (hash), for logout / "sign out other devices". */
    sessionId: string | null;
    /** An in-process call (Notion import) made with `internalHeaders(app)`. */
    system: boolean;
  }
  interface FastifyInstance {
    /** Per-process secret for in-process calls; never leaves memory. */
    internalToken: string;
  }
}

export const SESSION_COOKIE = 'papier_session';
/** Required on every non-GET /api request: a custom header can't be sent cross-site without a CORS preflight. */
export const CSRF_HEADER = 'x-papier';
const INTERNAL_HEADER = 'x-papier-internal';

/** Routes that work signed out. Everything else under /api needs a session. */
const PUBLIC = new Set(['/api/health', '/api/auth/state', '/api/auth/setup', '/api/auth/login', '/api/demo/start']);

export function readCookie(req: FastifyRequest, name: string) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

export type CookieOptions = { secure: boolean };

export function setSessionCookie(reply: FastifyReply, token: string, maxAgeMs: number, { secure }: CookieOptions) {
  const attrs = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (secure) attrs.push('Secure');
  reply.header('set-cookie', attrs.join('; '));
}

export function clearSessionCookie(reply: FastifyReply, { secure }: CookieOptions) {
  reply.header('set-cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`);
}

function bearer(req: FastifyRequest) {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

/** Headers for in-process `app.inject` calls that act as the system (the Notion importer). */
export function internalHeaders(app: FastifyInstance) {
  return { [INTERNAL_HEADER]: app.internalToken, [CSRF_HEADER]: '1' };
}

/**
 * Authenticates every /api request: the session cookie (browser, PWA) or a
 * bearer token (desktop app). Public routes pass through with `req.user` set
 * when there is a session. Non-GET requests need the CSRF header.
 */
export function authPlugin(app: FastifyInstance, db: Db) {
  app.decorate('internalToken', randomBytes(32).toString('base64url'));
  app.decorateRequest('user', null);
  app.decorateRequest('sessionId', null);
  app.decorateRequest('system', false);

  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?', 1)[0]!;
    if (!path.startsWith('/api/')) return;
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS' && req.headers[CSRF_HEADER] !== '1') {
      return reply.code(403).send({ error: 'Missing X-Papier header' });
    }
    if (req.headers[INTERNAL_HEADER] === app.internalToken) {
      req.system = true;
      return;
    }
    const token = bearer(req) ?? readCookie(req, SESSION_COOKIE);
    const session = token ? resolveSession(db, token) : null;
    if (session) {
      req.user = session.user;
      req.sessionId = session.sessionId;
    } else if (!PUBLIC.has(path)) {
      return reply.code(401).send({ error: 'Sign in required' });
    }
  });
}
