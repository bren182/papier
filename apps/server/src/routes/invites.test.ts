import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testApp } from '../testing.ts';

let app: ReturnType<typeof testApp>;
beforeEach(() => { app = testApp(); });
afterEach(async () => { await app.close(); });

const createInvite = () => app.inject({ method: 'POST', url: '/api/invites', payload: {} });

const accept = (token: string, payload: Partial<{ email: string; name: string; password: string }> = {}) =>
  app.inject({
    method: 'POST',
    url: `/api/invites/${token}/accept`,
    payload: { email: 'guest@example.com', name: 'Guest', password: 'correct horse', ...payload },
    headers: { 'x-papier': '1' },
  });

async function freshToken() {
  const res = await createInvite();
  expect(res.statusCode).toBe(201);
  const url = res.json().url as string;
  return url.split('/?join=')[1]!;
}

describe('invites', () => {
  it('creates a single-use invite link', async () => {
    const res = await createInvite();
    expect(res.statusCode).toBe(201);
    expect(res.json().url).toMatch(/\/\?join=.{20,}/);
  });

  it('validates a live token and rejects a bogus one', async () => {
    const token = await freshToken();
    expect((await app.inject({ method: 'GET', url: `/api/invites/${token}` })).json()).toEqual({ valid: true });
    expect((await app.inject({ method: 'GET', url: '/api/invites/bogus' })).statusCode).toBe(410);
  });

  it('accepts an invite, creates the user, and marks it used', async () => {
    const token = await freshToken();
    const res = await accept(token);
    expect(res.statusCode).toBe(201);
    expect(res.json().user).toMatchObject({ email: 'guest@example.com', name: 'Guest' });
    // Single-use: second accept with same token is rejected
    expect((await accept(token, { email: 'second@example.com' })).statusCode).toBe(410);
  });

  it('rejects if the email is already taken', async () => {
    const token = await freshToken();
    // owner@example.com already exists (from testApp)
    expect((await accept(token, { email: 'owner@example.com' })).statusCode).toBe(409);
  });

  it('rejects a missing name or a short password', async () => {
    const token = await freshToken();
    expect((await accept(token, { password: 'short' })).statusCode).toBe(400);
    // Provide invalid email so accept fails body validation, not invite validation
    const res = await app.inject({
      method: 'POST',
      url: `/api/invites/${token}/accept`,
      payload: { email: 'guest@example.com', password: 'correct horse' }, // no name
      headers: { 'x-papier': '1' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns a working session cookie after acceptance', async () => {
    const token = await freshToken();
    const res = await accept(token);
    const cookie = String(res.headers['set-cookie']).split(';')[0];
    expect(cookie).toMatch(/^papier_session=/);
    // The new session can reach a protected route
    expect((await app.inject({ method: 'GET', url: '/api/auth/state', headers: { cookie } })).json().user?.email)
      .toBe('guest@example.com');
  });
});
