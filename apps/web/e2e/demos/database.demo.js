// @ts-check
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

/** @typedef {import('@playwright/test').APIRequestContext} APIRequestContext */
/** @typedef {{ id: string, name: string, config: { options?: { id: string, name: string }[] } }} Prop */

/**
 * @param {APIRequestContext} request
 * @returns {Promise<{ id: string, status: Prop, priority: Prop, optionId: (prop: Prop, name: string) => string | undefined }>}
 */
async function seedProjectTracker(request) {
  const uid = randomUUID().slice(0, 6);
  const db = /** @type {{ id: string }} */ (
    await (await request.post('/api/pages', { data: { title: `Project Tracker ${uid}`, kind: 'database' } })).json()
  );

  const status = /** @type {Prop} */ (
    await (
      await request.post(`/api/databases/${db.id}/properties`, {
        data: {
          name: 'Status',
          type: 'select',
          config: { options: [{ name: 'Todo' }, { name: 'In Progress' }, { name: 'Done' }] },
        },
      })
    ).json()
  );

  const priority = /** @type {Prop} */ (
    await (
      await request.post(`/api/databases/${db.id}/properties`, {
        data: {
          name: 'Priority',
          type: 'select',
          config: { options: [{ name: 'Low' }, { name: 'Medium' }, { name: 'High' }] },
        },
      })
    ).json()
  );

  const optionId = (/** @type {Prop} */ prop, /** @type {string} */ name) =>
    prop.config.options?.find((o) => o.name === name)?.id;

  /** @type {{ title: string, status: string, priority: string }[]} */
  const rows = [
    { title: 'Design system tokens', status: 'Done', priority: 'High' },
    { title: 'API documentation', status: 'In Progress', priority: 'Medium' },
    { title: 'Mobile layout fixes', status: 'Todo', priority: 'High' },
    { title: 'Dark mode support', status: 'In Progress', priority: 'Low' },
    { title: 'Security review', status: 'Todo', priority: 'Medium' },
  ];

  for (const r of rows) {
    const props = {
      [status.id]: optionId(status, r.status),
      [priority.id]: optionId(priority, r.priority),
    };
    const res = await request.post(`/api/databases/${db.id}/rows`, { data: { title: r.title, props } });
    expect(res.ok()).toBe(true);
  }

  return { id: db.id, status, priority, optionId };
}

test('database — rows and properties', async ({ page, request }) => {
  const db = await seedProjectTracker(request);

  await page.goto(`/?p=${db.id}`);
  await expect(page.locator('[role=tab][aria-selected=true]')).toBeVisible();

  // Let the viewer see the seeded table.
  await page.waitForTimeout(1200);

  // Add a new row.
  await page.getByRole('button', { name: 'New', exact: true }).last().click();
  await page.waitForTimeout(400);

  const titleInput = page.getByPlaceholder('Untitled');
  await titleInput.fill('Performance audit');
  await titleInput.press('Escape');
  await page.waitForTimeout(600);

  // Set Status on the new row.
  const newRow = page.locator('[role=row][data-row-id]').last();
  await newRow.locator('[data-col]').first().locator('[role=button]').click();
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: 'Todo' }).click();
  await page.waitForTimeout(1500);
});
