/**
 * Bundles the Fastify server (TypeScript → CJS), copies drizzle migrations
 * and the built web UI into apps/desktop/dist/ for packaging.
 *
 * Run via: node scripts/bundle-server.mjs
 * Expects: apps/web/dist/ to already exist (run pnpm --filter @papier/web build first).
 */

import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..', '..');
const outDir = join(__dirname, '..', 'dist');

mkdirSync(outDir, { recursive: true });

// 1. Bundle the server.  Entry: app.ts (exports buildApp).
//    better-sqlite3 is a native addon — keep it external so electron-rebuild can target it.
console.log('Bundling server…');
await build({
  entryPoints: [join(repoRoot, 'apps', 'server', 'src', 'app.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: join(outDir, 'server.cjs'),
  external: ['better-sqlite3'],
  logLevel: 'warning',
});

// 2. Copy drizzle migrations alongside the bundle so PAPIER_MIGRATIONS_DIR resolves.
console.log('Copying migrations…');
cpSync(
  join(repoRoot, 'apps', 'server', 'drizzle'),
  join(outDir, 'drizzle'),
  { recursive: true }
);

// 3. Copy the pre-built web UI.
console.log('Copying web build…');
cpSync(
  join(repoRoot, 'apps', 'web', 'dist'),
  join(outDir, 'web'),
  { recursive: true }
);

console.log('Done — dist/ is ready for electron-builder.');
