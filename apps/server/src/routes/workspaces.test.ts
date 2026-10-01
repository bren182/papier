import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { addMember, createSession, createUser } from '../auth/sessions.ts';
import { pages, workspaces } from '../db/schema.ts';
import { TEST_HASH, testApp } from '../testing.ts';

let app: ReturnType<typeof testApp>;
beforeEach(() => {
  app = testApp();
});
afterEach(async () => {
  await app.close();
});

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object, status = 200) {
  const res = await app.inject({ method, url, payload });
  expect(res.statusCode, res.body).toBe(status);
  return res.body ? res.json() : null;
}
const state = () => call('GET', '/api/auth/state');
const newPage = (title: string) => call('POST', '/api/pages', { title }, 201) as Promise<{ id: string }>;

describe('workspace Home', () => {
  it('sets, reports and clears the Home page', async () => {
    const home = await newPage('Home');
    expect((await state()).workspaces[0]).toMatchObject({ id: 'default', homePageId: null });

    const updated = await call('PATCH', '/api/workspaces/default', { homePageId: home.id });
    expect(updated).toMatchObject({ id: 'default', homePageId: home.id, role: 'owner' });
    expect((await state()).workspaces[0].homePageId).toBe(home.id);

    await call('PATCH', '/api/workspaces/default', { homePageId: null });
    expect((await state()).workspaces[0].homePageId).toBeNull();
  });

  it('hides a trashed Home, brings it back on restore, and forgets it on purge', async () => {
    const home = await newPage('Home');
    await call('PATCH', '/api/workspaces/default', { homePageId: home.id });
    await call('DELETE', `/api/pages/${home.id}`, undefined, 204);
    expect((await state()).workspaces[0].homePageId).toBeNull();
    await call('POST', `/api/pages/${home.id}/restore`);
    expect((await state()).workspaces[0].homePageId).toBe(home.id);

    await call('DELETE', `/api/pages/${home.id}`, undefined, 204);
    await call('DELETE', `/api/pages/${home.id}/purge`, undefined, 204);
    const row = app.db.select().from(workspaces).where(eq(workspaces.id, 'default')).get();
    expect(row?.homePageId).toBeNull();
  });

  it('refuses a trashed page, a missing page, or a page of another workspace', async () => {
    const gone = await newPage('Gone');
    await call('DELETE', `/api/pages/${gone.id}`, undefined, 204);
    await call('PATCH', '/api/workspaces/default', { homePageId: gone.id }, 400);
    await call('PATCH', '/api/workspaces/default', { homePageId: 'nope' }, 400);

    const other = await newPage('Elsewhere');
    app.db.insert(workspaces).values({ id: 'other', name: 'Other', createdAt: 0 }).run();
    app.db.update(pages).set({ workspaceId: 'other' }).where(eq(pages.id, other.id)).run();
    await call('PATCH', '/api/workspaces/default', { homePageId: other.id }, 400);
  });

  it('renames and sets the icon (owners only); non-members get a 404', async () => {
    expect(await call('PATCH', '/api/workspaces/default', { name: 'Home base', icon: '🌲' })).toMatchObject({ name: 'Home base', icon: '🌲' });
    app.db.insert(workspaces).values({ id: 'other', name: 'Other', createdAt: 0 }).run();
    await call('PATCH', '/api/workspaces/other', { name: 'Mine now' }, 404);
  });

  it('lets editors choose Home but not rename; viewers do neither', async () => {
    const home = await newPage('Home');
    for (const [role, homeStatus] of [['editor', 200], ['viewer', 403]] as const) {
      const user = createUser(app.db, { email: `${role}@example.com`, name: role, passwordHash: TEST_HASH });
      addMember(app.db, 'default', user.id, role);
      const cookie = `papier_session=${createSession(app.db, user.id, 'cookie')}`;
      const patch = (payload: object) => app.inject({ method: 'PATCH', url: '/api/workspaces/default', payload, headers: { cookie } });
      expect((await patch({ homePageId: home.id })).statusCode).toBe(homeStatus);
      expect((await patch({ name: 'Renamed' })).statusCode).toBe(403);
    }
  });
});
