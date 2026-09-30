// @ts-check
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

/** @typedef {import('@playwright/test').APIRequestContext} APIRequestContext */
/** @typedef {{ id: string, name: string, type: string, config: Record<string, unknown> }} Prop */

const uid = () => randomUUID().slice(0, 6);

/** @param {APIRequestContext} request @param {string} url @param {object} [data] */
async function post(request, url, data) {
  const res = await request.post(url, { data });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

/** Projects (Alpha, Beta) and Tasks (Design, Build) with a Done checkbox. @param {APIRequestContext} request */
async function seed(request) {
  const tag = uid();
  const projects = /** @type {{ id: string }} */ (await post(request, '/api/pages', { title: `Projects ${tag}`, kind: 'database' })).id;
  const tasks = /** @type {{ id: string }} */ (await post(request, '/api/pages', { title: `Tasks ${tag}`, kind: 'database' })).id;
  const done = /** @type {Prop} */ (await post(request, `/api/databases/${tasks}/properties`, { name: 'Done', type: 'checkbox' }));
  const alpha = (await post(request, `/api/databases/${projects}/rows`, { title: 'Alpha' })).id;
  await post(request, `/api/databases/${projects}/rows`, { title: 'Beta' });
  const design = (await post(request, `/api/databases/${tasks}/rows`, { title: 'Design', props: { [done.id]: true } })).id;
  const build = (await post(request, `/api/databases/${tasks}/rows`, { title: 'Build' })).id;
  return { tag, projects, tasks, done, alpha, design, build };
}

/** @param {APIRequestContext} request @param {string} db */
const schema = async (request, db) => /** @type {Prop[]} */ ((await (await request.get(`/api/databases/${db}`)).json()).properties);

/** Row title → the titles it links to through a property, from the API. @param {APIRequestContext} request @param {string} db @param {string} propId */
async function links(request, db, propId) {
  const { rows, refs } = await post(request, `/api/databases/${db}/query`, {});
  return Object.fromEntries(
    rows.map((/** @type {{ title: string, props: Record<string, string[]> }} */ r) => [r.title, (r.props[propId] ?? []).map((id) => refs[id].title)]),
  );
}

test('adds a two-way relation in the table and links a row', async ({ page, request }) => {
  const s = await seed(request);
  await page.goto(`/?p=${s.tasks}`);
  await expect(page.getByRole('tab', { selected: true })).toBeVisible();

  await page.getByRole('button', { name: 'Add a property' }).click();
  await page.locator('[data-popover]').getByRole('button', { name: 'Relation' }).click();
  // Its menu opens on the target chooser.
  const menu = page.locator('[data-popover]');
  await menu.getByLabel('Find a database').fill(s.tag);
  await menu.getByRole('button', { name: `Projects ${s.tag}` }).click();
  await expect(menu.getByRole('button', { name: `Show on Projects ${s.tag}` })).toContainText('✓');
  await page.keyboard.press('Escape');

  const rel = (await schema(request, s.tasks)).find((p) => p.type === 'relation');
  expect(rel).toBeTruthy();
  const row = page.locator(`[role=row][data-row-id="${s.design}"]`);
  await row.locator(`[data-col="${rel?.id}"] [role=button]`).click();
  await page.locator('[data-popover]').getByRole('button', { name: 'Alpha' }).click();
  await expect(row.locator(`[data-col="${rel?.id}"]`)).toContainText('Alpha');
  await page.keyboard.press('Escape');

  // The other side shows it too: in the Projects table and on Alpha's page.
  const twin = (await schema(request, s.projects)).find((p) => p.type === 'relation');
  await expect.poll(() => links(request, s.projects, /** @type {string} */ (twin?.id))).toEqual({ Alpha: ['Design'], Beta: [] });
  await page.goto(`/?p=${s.alpha}`);
  await expect(page.getByRole('region', { name: 'Properties' }).or(page.getByLabel('Properties'))).toContainText('Design');
});

test('a rollup shows the share of linked tasks that are done', async ({ page, request }) => {
  const s = await seed(request);
  const rel = /** @type {Prop} */ (await post(request, `/api/databases/${s.tasks}/properties`, { name: 'Project', type: 'relation', config: { databaseId: s.projects } }));
  for (const t of [s.design, s.build]) {
    const res = await request.patch(`/api/pages/${t}/props`, { data: { [rel.id]: [s.alpha] } });
    expect(res.ok()).toBe(true);
  }

  await page.goto(`/?p=${s.projects}`);
  await expect(page.getByRole('tab', { selected: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add a property' }).click();
  await page.locator('[data-popover]').getByRole('button', { name: 'Rollup' }).click();
  const menu = page.locator('[data-popover]');
  await menu.getByLabel('Relation', { exact: true }).selectOption({ label: `Tasks ${s.tag}` });
  await menu.getByLabel('Property', { exact: true }).selectOption({ label: 'Done (Checkbox)' });
  await menu.getByLabel('Calculate').selectOption({ label: 'Percent checked' });
  await page.keyboard.press('Escape');

  const rollup = (await schema(request, s.projects)).find((p) => p.type === 'rollup');
  const cell = page.locator(`[role=row][data-row-id="${s.alpha}"] [data-col="${rollup?.id}"]`);
  await expect(cell).toHaveText('50%');

  // Ticking the other task updates it.
  await request.patch(`/api/pages/${s.build}/props`, { data: { [s.done.id]: true } });
  await page.reload();
  await expect(cell).toHaveText('100%');
});
