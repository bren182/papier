import type { InjectOptions } from 'fastify';
import { buildApp } from './app.ts';
import { CSRF_HEADER, SESSION_COOKIE } from './auth/plugin.ts';
import { createOwner, createSession, findUserByEmail } from './auth/sessions.ts';
import { DEFAULT_WORKSPACE_ID } from './db/schema.ts';

/** Stands in for a real scrypt hash in tests (never verifies, costs nothing). */
export const TEST_HASH = 'test$unusable';

type App = ReturnType<typeof buildApp>;

/**
 * Makes `app.inject` act as a signed-in user: every request carries the
 * session cookie and the CSRF header unless the call sets its own headers.
 */
export function signedIn(app: App, token: string) {
  const inject = app.inject.bind(app) as (opts: InjectOptions) => ReturnType<App['inject']>;
  const auth = { cookie: `${SESSION_COOKIE}=${token}`, [CSRF_HEADER]: '1' };
  (app as { inject: unknown }).inject = (opts: InjectOptions) => inject({ ...opts, headers: { ...auth, ...opts.headers } });
  return app;
}

/**
 * `buildApp` for route tests: an owner account exists (owning the default
 * workspace) and `app.inject` is signed in as them. `app.owner` is that user.
 */
export function testApp(opts: Parameters<typeof buildApp>[0] = {}) {
  const app = buildApp({ logger: false, ...opts });
  const db = app.db;
  // A reopened file database already has its owner.
  const found = findUserByEmail(db, 'owner@example.com');
  const owner = found
    ? { id: found.id, email: found.email, name: found.name, isAdmin: found.isAdmin }
    : createOwner(db, { email: 'owner@example.com', name: 'Owner', passwordHash: TEST_HASH });
  return Object.assign(signedIn(app, createSession(db, owner.id, 'cookie')), { owner, workspaceId: DEFAULT_WORKSPACE_ID });
}
