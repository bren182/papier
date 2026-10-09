/**
 * Bundles the Fastify server (TypeScript → CJS), copies drizzle migrations
 * and the built web UI into apps/desktop/dist/ for packaging.
 *
 * Run via: node scripts/bundle-server.mjs
 * Expects: apps/web/dist/ to already exist (run pnpm --filter @papier/web build first).
 */

import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'fs';
import { createRequire } from 'node:module';
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

// Resolver for better-sqlite3's own dependency tree (used below for node-addon-api and bindings).
const bsq3Require = createRequire(join(bsq3Src, 'package.json'));
const bsq3Pkg = JSON.parse(readFileSync(join(bsq3Src, 'package.json'), 'utf8'));

// better-sqlite3 v12 uses the `bindings` npm package at runtime to locate the compiled
// .node binary. `bindings` in turn needs `file-uri-to-path`. Copy both so the require
// chain resolves inside the packaged app.
if (bsq3Pkg.dependencies?.bindings) {
  const bindingsSrc = dirname(bsq3Require.resolve('bindings/package.json'));
  console.log(`Copying bindings from ${bindingsSrc}…`);
  cpSync(bindingsSrc, join(outDir, 'node_modules', 'bindings'), { recursive: true });
  // bindings depends on file-uri-to-path; resolve from bindings' own dep tree.
  const bindingsRequire = createRequire(join(bindingsSrc, 'package.json'));
  try {
    const furiSrc = dirname(bindingsRequire.resolve('file-uri-to-path/package.json'));
    console.log(`Copying file-uri-to-path from ${furiSrc}…`);
    cpSync(furiSrc, join(outDir, 'node_modules', 'file-uri-to-path'), { recursive: true });
  } catch {
    console.log('file-uri-to-path not found in bindings deps — skipping.');
  }
}

// 5. Rebuild better-sqlite3 from source for Electron's embedded Node version.
//
//    Why not use the prebuild? better-sqlite3 v12 ships prebuildify prebuilds at
//    prebuilds/<platform>-<arch>.node, but electron-builder's extraFiles excludes
//    prebuilds/** from the packaged app. We delete the prebuilds copy so
//    @electron/rebuild is forced to compile from source, writing the binary to
//    build/Release/better_sqlite3.node which IS packaged.
//
//    Why copy node-addon-api? binding.gyp may reference it for NAPI modules (v13+).
//    For v12 (NAN-based) it is not needed and is skipped.
//
//    @electron/rebuild also needs a package.json at buildPath listing the target
//    module as a dependency.

// Remove prebuildify prebuilds so @electron/rebuild doesn't treat them as "done".
rmSync(join(outDir, 'node_modules', 'better-sqlite3', 'prebuilds'), { recursive: true, force: true });

// Copy node-addon-api if better-sqlite3 depends on it (v13+); v12 and below use NAN instead.
let copiedNaapi = false;
try {
  const naapiSrc = dirname(bsq3Require.resolve('node-addon-api/package.json'));
  console.log(`Copying node-addon-api from ${naapiSrc}…`);
  cpSync(naapiSrc, join(outDir, 'node_modules', 'node-addon-api'), { recursive: true });
  copiedNaapi = true;
} catch {
  console.log('node-addon-api not found in better-sqlite3 deps — skipping (not needed for this version).');
}

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

// Remove node-addon-api if we copied it — build-time only, not needed at runtime.
if (copiedNaapi) {
  rmSync(join(outDir, 'node_modules', 'node-addon-api'), { recursive: true, force: true });
}

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
