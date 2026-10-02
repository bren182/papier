// @ts-check
import { test } from '@playwright/test';
import { createPage } from '../helpers.js';

test('editor — block editing and slash menu', async ({ page, request }) => {
  const id = await createPage(request, 'Weekly Planning', [
    { text: 'This week', type: 'heading' },
    { text: 'Ship the new dashboard design' },
    { text: 'Review open pull requests' },
    { text: 'Sync with design team' },
  ]);

  await page.goto(`/?p=${id}`);
  await page.locator('.papier-editor .pb').first().waitFor();

  // Let the viewer see the initial page.
  await page.waitForTimeout(1200);

  // Click the last block and append a new one.
  const lastBlock = page.locator('.papier-editor .pb').last();
  await lastBlock.locator('.pb-c').click();
  await page.waitForTimeout(400);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);

  await page.keyboard.type('Write demo recording scripts');
  await page.waitForTimeout(800);

  // Open the slash menu and insert a callout.
  await page.keyboard.press('Enter');
  await page.keyboard.type('/callout');
  await page.waitForTimeout(700);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);

  await page.keyboard.type('🎯 Ship v1.0 by end of month');
  await page.waitForTimeout(1500);
});
