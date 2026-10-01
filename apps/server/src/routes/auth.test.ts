import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { internalHeaders, SESSION_COOKIE } from '../auth/plugin.ts';
import { createSession, SESSION_TTL_MS } from '../auth/sessions.ts';
import { testApp } from '../testing.ts';

const SETUP = 'setup-secret';
const OWNER = { email: 'Me@Example.com', name: 'Me', password: 'correct horse' };
const csrf = { 'x-papier': '1' };

let app: ReturnType<typeof buildApp>;
afterEach(async () => {
  await app.close();
});

const fresh = () => (app = buildApp({ logger: false, setupToken: SETUP }));
const post = (url: string, payload: object, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, payload, headers: { ...csrf, ...headers } });
const pagesWith = (headers: Record<string, string>) => app.inject({ method: 'GET', url: '/api/pages', headers });
const cookieOf = (res: { headers: Record<string, unknown> }) => String(res.headers['set-cookie']).split(';')[0]!;

async function setUp() {
  const res = await post('/api/auth/setup', { ...OWNER, setupToken: SETUP, workspaceName: 'Home' });
  expect(res.statusCode).toBe(201);
  return cookieOf(res);
}

describe('setup', () => {
  it('needs the setup token, then works once', async () => {
    fresh();
    expect((await app.inject({ method: 'GET', url: '/api/auth/state' })).json()).toMatchObject({ setupNeeded: true, user: null });
    expect((await post('/api/auth/setup', { ...OWNER, setupToken: 'guess' })).statusCode).toBe(403);

    const cookie = await setUp();
    expect(cookie).toMatch(/^papier_session=/);
    const state = (await app.inject({ method: 'GET', url: '/api/auth/state', headers: { cookie } })).json();
    expect(state).toMatchObject({
      setupNeeded: false,
      user: { email: 'me@example.com', name: 'Me', isAdmin: true },
      workspaces: [{ id: 'default', name: 'Home', role: 'owner' }],
    });

    const again = await post('/api/auth/setup', { ...OWNER, email: 'other@example.com', setupToken: SETUP });
    expect(again.statusCode).toBe(409);
  });

  it('rejects short passwords and bad emails', async () => {
    fresh();
    expect((await post('/api/auth/setup', { ...OWNER, password: 'short', setupToken: SETUP })).statusCode).toBe(400);
    expect((await post('/api/auth/setup', { ...OWNER, email: 'nope', setupToken: SETUP })).statusCode).toBe(400);
  });

  it('adopts the pages that existed before the first account', async () => {
    fresh();
    await post('/api/pages', { title: 'Old notes' }, internalHeaders(app));
    const cookie = await setUp();
    expect((await pagesWith({ cookie })).json().map((p: { title: string }) => p.title)).toEqual(['Old notes']);
  });
});

describe('sessions', () => {
  it('logs in with a cookie, logs out, and the cookie stops working', async () => {
    fresh();
    await setUp();
    expect((await post('/api/auth/login', { email: OWNER.email, password: 'wrong password' })).statusCode).toBe(401);
    expect((await post('/api/auth/login', { email: 'who@example.com', password: 'whatever1' })).statusCode).toBe(401);

    const res = await post('/api/auth/login', { email: ' ME@example.com ', password: OWNER.password });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['set-cookie'])).toMatch(/HttpOnly; SameSite=Lax/);
    expect(String(res.headers['set-cookie'])).not.toMatch(/Secure/);
    const cookie = cookieOf(res);
    expect((await pagesWith({ cookie })).statusCode).toBe(200);

    expect((await post('/api/auth/logout', {}, { cookie })).statusCode).toBe(204);
    expect((await pagesWith({ cookie })).statusCode).toBe(401);
  });

  it('marks the cookie Secure behind https', async () => {
    app = buildApp({ logger: false, setupToken: SETUP, origin: 'https://papier.example.com' });
    const res = await post('/api/auth/setup', { ...OWNER, setupToken: SETUP });
    expect(String(res.headers['set-cookie'])).toMatch(/; Secure/);
  });

  it('gives the desktop app a bearer token instead of a cookie', async () => {
    fresh();
    await setUp();
    const res = await post('/api/auth/login', { ...OWNER, client: 'desktop' });
    expect(res.headers['set-cookie']).toBeUndefined();
    const authorization = `Bearer ${res.json().token}`;
    expect((await pagesWith({ authorization })).statusCode).toBe(200);
    expect((await post('/api/pages', { title: 'From desktop' }, { authorization })).statusCode).toBe(201);
  });

  it('forgets expired sessions', async () => {
    const t = (app = testApp());
    const long = Date.now() - SESSION_TTL_MS - 1;
    const token = createSession(t.db, t.owner.id, 'cookie', null, long);
    expect((await pagesWith({ cookie: `${SESSION_COOKIE}=${token}` })).statusCode).toBe(401);
  });

  it('throttles repeated failures', async () => {
    fresh();
    await setUp();
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await post('/api/auth/login', { email: OWNER.email, password: `nope-${i}` })).statusCode);
    expect(codes).toEqual([401, 401, 401, 401, 401, 429]);
    // Even the right password waits out the lock.
    expect((await post('/api/auth/login', OWNER)).statusCode).toBe(429);
  });

  it('changes the password and signs out other sessions', async () => {
    fresh();
    const here = await setUp();
    const there = cookieOf(await post('/api/auth/login', OWNER));
    expect((await post('/api/auth/password', { current: 'wrong', next: 'new password!' }, { cookie: here })).statusCode).toBe(403);
    expect((await post('/api/auth/password', { current: OWNER.password, next: 'new password!' }, { cookie: here })).statusCode).toBe(204);

    expect((await pagesWith({ cookie: here })).statusCode).toBe(200);
    expect((await pagesWith({ cookie: there })).statusCode).toBe(401);
    expect((await post('/api/auth/login', OWNER)).statusCode).toBe(401);
    expect((await post('/api/auth/login', { ...OWNER, password: 'new password!' })).statusCode).toBe(200);
  });

  it('renames the user', async () => {
    app = testApp();
    const res = await app.inject({ method: 'PATCH', url: '/api/auth/me', payload: { name: 'Renamed' } });
    expect(res.json()).toMatchObject({ name: 'Renamed' });
    expect((await app.inject({ method: 'GET', url: '/api/auth/state' })).json().user.name).toBe('Renamed');
  });
});

describe('guards', () => {
  /** Every `/api` route, read from the route files so new ones are covered too. */
  function allRoutes() {
    const dir = new URL('.', import.meta.url);
    const routes: { method: string; url: string }[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
      const src = readFileSync(new URL(file, dir), 'utf8');
      for (const m of src.matchAll(/app\.(get|post|patch|put|delete)(?:<[^>]*>)?\(\s*'(\/api\/[^']+)'/g)) {
        routes.push({ method: m[1]!.toUpperCase(), url: m[2]!.replace(/:[A-Za-z]+/g, 'x') });
      }
    }
    return routes;
  }

  it('refuses every non-public route when signed out', async () => {
    fresh();
    await setUp();
    const routes = allRoutes();
    expect(routes.length).toBeGreaterThan(40);
    const open = [];
    for (const r of routes) {
      const res = await app.inject({ method: r.method as 'GET', url: r.url, headers: csrf, payload: r.method === 'GET' ? undefined : {} });
      if (res.statusCode !== 401) open.push(`${r.method} ${r.url} → ${res.statusCode}`);
    }
    expect(open.sort()).toEqual(['GET /api/auth/state → 200', 'POST /api/auth/login → 400', 'POST /api/auth/setup → 400']);
  });

  it('needs the X-Papier header on writes, even signed in', async () => {
    app = testApp();
    expect((await app.inject({ method: 'POST', url: '/api/pages', payload: {}, headers: { 'x-papier': '' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: OWNER, headers: { 'x-papier': '' } })).statusCode).toBe(403);
  });

  it('ignores a forged internal header', async () => {
    fresh();
    await setUp();
    expect((await pagesWith({ 'x-papier-internal': 'guess' })).statusCode).toBe(401);
    expect((await pagesWith(internalHeaders(app))).statusCode).toBe(200);
  });
});
