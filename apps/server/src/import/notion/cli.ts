// pnpm --filter @papier/server import:notion <exportDir> --db <file> --include <path>… [--dry-run]
//
// Imports the included pages (display paths, ids stripped, e.g. "Dev/Cloudsmiths")
// into the Papier database at --db. --dry-run imports into memory and only reports.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildApp } from '../../app.ts';
import { importNotion } from './importer.ts';
import { dirSource } from './tree.ts';

const USAGE = 'usage: import:notion <exportDir> (--db <file> | --dry-run) --include <path> [--include <path>…] [--yes-dev-db]';

// pnpm runs scripts from the package folder; paths are relative to where it was invoked.
const cwd = process.env.INIT_CWD ?? process.cwd();
const args = process.argv.slice(2);
const include: string[] = [];
let exportDir: string | null = null;
let dbPath: string | null = null;
let dryRun = false;
let devDbOk = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a === '--include') include.push(args[++i] ?? '');
  else if (a === '--db') dbPath = resolve(cwd, args[++i] ?? '');
  else if (a === '--dry-run') dryRun = true;
  else if (a === '--yes-dev-db') devDbOk = true;
  else if (!a.startsWith('--') && !exportDir) exportDir = resolve(cwd, a);
  else fail(`unknown argument ${a}`);
}
if (!exportDir || !existsSync(exportDir)) fail(exportDir ? `no such folder: ${exportDir}` : 'missing <exportDir>');
if (!include.length) fail('nothing to import: pass --include');
if (!dryRun && !dbPath) fail('pass --db <file> (a scratch database) or --dry-run');
const devDb = resolve(import.meta.dirname, '../../../data/papier.db');
if (!dryRun && dbPath === devDb && !devDbOk) fail(`${dbPath} is the dev database; pass --yes-dev-db if that's really the target (stop \`pnpm dev\` first)`);

const app = buildApp({ dbPath: dryRun ? ':memory:' : dbPath!, logger: false });
try {
  const report = await importNotion(app, dirSource(exportDir), { include });
  const { counts } = report;
  console.log(dryRun ? 'Dry run (nothing written):' : `Imported into ${dbPath}:`);
  for (const r of report.roots) console.log(`  ${r.path}  →  ?p=${r.id}`);
  console.log(`  ${counts.pages} pages, ${counts.databases} databases, ${counts.rows} rows, ${counts.blocks} blocks`);
  console.log(`  properties: ${Object.entries(counts.properties).map(([t, n]) => `${n} ${t}`).join(', ') || 'none'}`);
  if (report.warnings.length) {
    console.log(`\n${report.warnings.length} warnings:`);
    for (const w of report.warnings) console.log(`  - ${w}`);
  }
} finally {
  await app.close();
}

function fail(msg: string): never {
  console.error(`${msg}\n${USAGE}`);
  process.exit(1);
}
