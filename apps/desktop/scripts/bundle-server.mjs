/**
 * Bundles the Fastify server (TypeScript → CJS), copies drizzle migrations
 * and the built web UI into apps/desktop/dist/ for packaging.
 *
 * Run via: node scripts/bundle-server.mjs
 * Expects: apps/web/dist/ to already exist (run pnpm --filter @papier/web build first).
 */

import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { rebuild } from '@electron/rebuild';

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

// 4. Copy better-sqlite3 alongside the bundle so `require('better-sqlite3')` resolves
//    at runtime without relying on electron-builder to follow pnpm symlinks.
//    realpathSync resolves the pnpm content-store symlink to actual files.
console.log('Copying better-sqlite3…');
const bsq3Src = realpathSync(join(repoRoot, 'apps', 'desktop', 'node_modules', 'better-sqlite3'));
cpSync(bsq3Src, join(outDir, 'node_modules', 'better-sqlite3'), { recursive: true });

// 5. Rebuild better-sqlite3 from source for Electron's embedded Node version.
//    better-sqlite3 v13 ships prebuildify prebuilds at prebuilds/<platform>-<arch>.node.
//    @electron/rebuild detects these via findPrebuildifyModule() and skips compilation,
//    but electron-builder's extraFiles excludes prebuilds/** from the packaged app.
//    Deleting the prebuilds/ copy forces @electron/rebuild to compile from source,
//    putting the binary at build/Release/better_sqlite3.node which IS packaged.
//
//    @electron/rebuild needs a package.json at buildPath and requires the target
//    module to appear in its dependencies to be included in prodDeps.
import { rmSync } from 'node:fs';
rmSync(join(outDir, 'node_modules', 'better-sqlite3', 'prebuilds'), { recursive: true, force: true });

writeFileSync(
  join(outDir, 'package.json'),
  JSON.stringify({
    name: 'papier-desktop-bundle',
    version: '0.0.0',
    private: true,
    dependencies: { 'better-sqlite3': '*' },
  })
);
const electronPkg = JSON.parse(
  readFileSync(join(__dirname, '..', 'node_modules', 'electron', 'package.json'), 'utf8')
);
const electronVersion = electronPkg.version;
console.log(`Rebuilding better-sqlite3 for Electron ${electronVersion}…`);
await rebuild({
  buildPath: outDir,
  electronVersion,
  onlyModules: ['better-sqlite3'],
  force: true,
  debug: false,
});

// Verify that compilation produced an Electron-compatible binary.
// prebuilds/ are excluded from extraFiles, so getBinding() falls through to
// build/Release/better_sqlite3.node.  Fail the build now if it was not created.
const builtNode = join(outDir, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
if (!existsSync(builtNode)) {
  throw new Error(`@electron/rebuild did not produce ${builtNode} — check that Visual Studio (Windows) or g++ (Linux) is installed`);
}
const builtSize = statSync(builtNode).size;
console.log(`better_sqlite3.node: ${(builtSize / 1024).toFixed(0)} KB — Electron-compatible binary ready.`);

console.log('Done — dist/ is ready for electron-builder.');
