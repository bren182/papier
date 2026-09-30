import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { openDb } from '../db/index.ts';
import { purgeExpired, RETENTION_DAYS } from '../db/trash.ts';

// The trash: list the top-most trashed pages, restore them, delete them forever.

let app: ReturnType<typeof buildApp>;

beforeEach(() => {
  app = buildApp({ logger: false });
});
afterEach(async () => {
  await app.close();
});

type Block = { id: string; type: string; props: Record<string, unknown> };
type TrashItem = { page: { id: string; title: string }; parent: { id: string } | null; isRow: boolean; trashedAt: number };

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object, status?: number) {
  const res = await app.inject({ method, url, payload });
  if (status !== undefined) expect(res.statusCode, res.body).toBe(status);
  return res.statusCode === 204 ? null : res.json();
}

const create = async (title: string, parentId: string | null = null, kind = 'page') =>
  ((await call('POST', '/api/pages', { title, parentId, kind }, 201)) as { id: string }).id;
const trash = (id: string) => call('DELETE', `/api/pages/${id}`, undefined, 204);
const trashed = async (q = '') => ((await call('GET', `/api/trash?q=${q}`, undefined, 200)) as TrashItem[]).map((t) => t.page.title);
const blocks = async (id: string) => (await call('GET', `/api/pages/${id}/blocks`, undefined, 200)) as Block[];

describe('trash', () => {
  it('lists only the top-most trashed pages, newest first', async () => {
    const a = await create('Alpha');
    await create('Alpha child', a);
    const b = await create('Beta');
    await trash(a);
    await trash(b);
    expect(await trashed()).toEqual(['Beta', 'Alpha']);
    expect(await trashed('alp')).toEqual(['Alpha']);
  });

  it('says a trashed page is in the trash', async () => {
    const a = await create('Alpha');
    await trash(a);
    const res = await app.inject({ method: 'GET', url: `/api/pages/${a}` });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ trashed: true });
    expect((await app.inject({ method: 'GET', url: '/api/pages/nope' })).json()).toMatchObject({ trashed: false });
  });

  it('restores a sub-page with its page block, and an inline database with a database block', async () => {
    const home = await create('Home');
    const sub = await create('Sub', home);
    const db = await create('Tasks', home, 'database');
    await trash(sub);
    await trash(db);
    expect((await blocks(home)).filter((b) => b.type !== 'paragraph')).toEqual([]);

    const res = (await call('POST', `/api/pages/${sub}/restore`, undefined, 200)) as { contentChanged: string };
    expect(res.contentChanged).toBe(home);
    await call('POST', `/api/pages/${db}/restore`, undefined, 200);
    expect((await blocks(home)).map((b) => [b.type, b.props.pageId])).toEqual([
      ['page', sub],
      ['database', db],
    ]);
    expect(await trashed()).toEqual([]);
    await call('POST', `/api/pages/${sub}/restore`, undefined, 400);
  });

  it('restores a row into its database; a page whose parent is gone to the top level', async () => {
    const db = await create('Tasks', null, 'database');
    const row = ((await call('POST', `/api/databases/${db}/rows`, { title: 'Row' }, 201)) as { id: string }).id;
    await trash(row);
    expect(((await call('GET', '/api/trash', undefined, 200)) as TrashItem[])[0]).toMatchObject({ isRow: true, parent: { id: db } });
    await call('POST', `/api/pages/${row}/restore`, undefined, 200);
    expect(((await call('POST', `/api/databases/${db}/query`, {}, 200)) as { rows: { id: string }[] }).rows.map((r) => r.id)).toEqual([row]);

    const home = await create('Home');
    const sub = await create('Sub', home);
    await trash(sub);
    await trash(home);
    // Sub stays listed: it was trashed on its own before Home.
    await call('POST', `/api/pages/${sub}/restore`, undefined, 200);
    const page = (await call('GET', `/api/pages/${sub}`, undefined, 200)) as { page: { parentId: string | null } };
    expect(page.page.parentId).toBe(null);

    // A row whose database is in the trash waits for the database.
    const row2 = ((await call('POST', `/api/databases/${db}/rows`, { title: 'Row 2' }, 201)) as { id: string }).id;
    await trash(row2);
    await trash(db);
    await call('POST', `/api/pages/${row2}/restore`, undefined, 400);
  });

  it('delete forever takes the subtree, values, links from other databases and search rows', async () => {
    const projects = await create('Projects', null, 'database');
    const tasks = await create('Tasks', null, 'database');
    const rel = (await call('POST', `/api/databases/${tasks}/properties`, { name: 'Project', type: 'relation', config: { databaseId: projects } }, 201)) as { id: string };
    const alpha = ((await call('POST', `/api/databases/${projects}/rows`, { title: 'Alpha zebra' }, 201)) as { id: string }).id;
    await call('POST', `/api/databases/${tasks}/rows`, { title: 'Task', props: { [rel.id]: [alpha] } }, 201);

    await call('DELETE', `/api/pages/${projects}/purge`, undefined, 400); // not in the trash
    await trash(projects);
    await call('DELETE', `/api/pages/${projects}/purge`, undefined, 204);
    expect(await trashed()).toEqual([]);
    await call('GET', `/api/pages/${alpha}`, undefined, 404);
    expect(((await call('GET', '/api/search?q=zebra', undefined, 200)) as { items: unknown[] }).items).toEqual([]);
    // The relation's twin went with Projects; Tasks' side is one-way and empty.
    const schema = (await call('GET', `/api/databases/${tasks}`, undefined, 200)) as { properties: { id: string; config: Record<string, unknown> }[] };
    expect(schema.properties[0]!.config.reverseId).toBeUndefined();
    const row = ((await call('POST', `/api/databases/${tasks}/query`, {}, 200)) as { rows: { props: Record<string, unknown> }[] }).rows[0]!;
    expect(row.props[rel.id]).toBeUndefined();
  });

  it(`purges what has been in the trash over ${RETENTION_DAYS} days`, async () => {
    await app.close();
    const dir = mkdtempSync(join(tmpdir(), 'papier-trash-'));
    const file = join(dir, 'test.db');
    app = buildApp({ dbPath: file, logger: false });
    const { db, sqlite } = openDb(file);
    try {
      const old = await create('Old');
      await create('Old child', old);
      const recent = await create('Recent');
      await trash(old);
      await trash(recent);
      sqlite.prepare('update pages set archived_at = ? where id = ?').run(Date.now() - (RETENTION_DAYS + 1) * 86_400_000, old);
      expect(purgeExpired(db)).toBe(2);
      expect(await trashed()).toEqual(['Recent']);
      sqlite.close();
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
      app = buildApp({ logger: false });
    }
  });
});

describe('appearance', () => {
  it('merges patches, drops nulls, and comes along on duplicate', async () => {
    const a = await create('Alpha');
    await call('PATCH', `/api/pages/${a}`, { icon: '🌿', appearance: { cover: 'dawn', fullWidth: true } }, 200);
    const page = (await call('PATCH', `/api/pages/${a}`, { appearance: { font: 'serif', fullWidth: null } }, 200)) as { icon: string; appearance: object };
    expect(page).toMatchObject({ icon: '🌿', appearance: { cover: 'dawn', font: 'serif' } });
    expect(page.appearance).not.toHaveProperty('fullWidth');
    await call('PATCH', `/api/pages/${a}`, { appearance: { font: 'comic' } }, 400);
    const copy = ((await call('POST', `/api/pages/${a}/duplicate`, { today: '2026-09-30' }, 201)) as { id: string }).id;
    const detail = (await call('GET', `/api/pages/${copy}`, undefined, 200)) as { page: { appearance: object } };
    expect(detail.page.appearance).toEqual({ cover: 'dawn', font: 'serif' });
  });
});
