// @ts-check
// Screenshot a running Papier (e.g. `pnpm dev`) for a quick visual check.
//   pnpm --filter @papier/web shot [path] [out.png] [--width=1280] [--height=800] [--full]
//     [--press=Control+k] [--type=text]   keys, then typing, before the shot (menus, dialogs)
//   BASE_URL=http://127.0.0.1:5174 pnpm --filter @papier/web shot "/?p=<id>" page.png
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const flags = Object.fromEntries(
  args.filter((a) => a.startsWith('--')).map((a) => {
    const [k, v] = a.slice(2).split('=');
    return [k, v ?? 'true'];
  }),
);
const [path = '/', out = 'screenshot.png'] = args.filter((a) => !a.startsWith('--'));
const base = process.env.BASE_URL ?? 'http://localhost:5173';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: Number(flags.width ?? 1280), height: Number(flags.height ?? 800) },
    reducedMotion: 'reduce', // still backdrop, so shots are comparable
  });
  await page.goto(new URL(path, base).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  if (flags.press) await page.keyboard.press(flags.press);
  if (flags.type) await page.keyboard.type(flags.type);
  if (flags.press || flags.type) await page.waitForTimeout(600); // debounce + fetch + paint
  await page.screenshot({ path: out, fullPage: flags.full === 'true' });
  console.log(`saved ${out}`);
} finally {
  await browser.close();
}
