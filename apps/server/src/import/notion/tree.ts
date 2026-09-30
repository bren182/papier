// The page tree of a Notion markdown/CSV export.
//
// `Parent/Name <32 hex>.md` is a page; its sub-pages live in the folder `Parent/Name/`
// (`Parent/Name 1a2b-9f0e/` when a sibling has the same name). A sibling
// `Name <hex>_all.csv` makes the page a database whose rows are the folder's pages.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Where an export's files come from — a folder today, an uploaded zip later. */
export type ExportSource = {
  /** All file paths, relative, `/`-separated. */
  files(): string[];
  read(path: string): string;
};

export function dirSource(root: string): ExportSource {
  return {
    files: () =>
      (readdirSync(root, { recursive: true }) as string[])
        .map((p) => p.replace(/\\/g, '/'))
        .filter((p) => statSync(join(root, p)).isFile()),
    read: (p) => readFileSync(join(root, p), 'utf8'),
  };
}

export type PageNode = {
  /** The page's `.md` path in the export. */
  path: string;
  /** Notion's page id (the hex in the file name). */
  notionId: string;
  /** Display path with ids stripped, e.g. `Dev/Cloudsmiths` — what `--include` matches. */
  displayPath: string;
  /** The database's CSV, when the page is one. */
  csv: string | null;
  children: PageNode[];
};

const PAGE_FILE = /^(.*) ([0-9a-f]{32})\.md$/;
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/** Build the tree; returns the top-level pages (the export root may be one wrapper folder). */
export function buildTree(source: ExportSource): PageNode[] {
  const files = source.files();
  const all = new Set(files);
  const mdByDir = new Map<string, string[]>();
  for (const f of files) {
    if (!PAGE_FILE.test(baseOf(f))) continue;
    const d = dirOf(f);
    mdByDir.set(d, [...(mdByDir.get(d) ?? []), f]);
  }

  const node = (path: string, parentDisplay: string): PageNode => {
    const [, name = '', id = ''] = PAGE_FILE.exec(baseOf(path)) ?? [];
    const dir = dirOf(path);
    const prefix = dir ? `${dir}/` : '';
    const displayPath = parentDisplay ? `${parentDisplay}/${name}` : name;
    const csv = [`${prefix}${name} ${id}_all.csv`, `${prefix}${name} ${id}.csv`].find((c) => all.has(c)) ?? null;
    // Children: the disambiguated folder (`Name 1a2b-9f0e`) first, then the plain one.
    const folder = [`${prefix}${name} ${id.slice(0, 4)}-${id.slice(-4)}`, `${prefix}${name}`].find((d) => mdByDir.has(d));
    const kids = folder ? mdByDir.get(folder)! : [];
    return { path, notionId: id, displayPath, csv, children: kids.sort().map((k) => node(k, displayPath)) };
  };

  // The shallowest folder with pages is the workspace root (exports wrap it in `Export-…/`).
  const rootDir = [...mdByDir.keys()].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))[0];
  return rootDir === undefined ? [] : mdByDir.get(rootDir)!.sort().map((p) => node(p, ''));
}

const depth = (d: string) => (d ? d.split('/').length : 0);

/** Every node, depth-first. */
export function* walk(nodes: PageNode[]): Generator<PageNode> {
  for (const n of nodes) {
    yield n;
    yield* walk(n.children);
  }
}

/** Resolve a relative, URL-encoded link from the page at `from` to an export path. */
export function resolveLink(from: string, href: string): string {
  let target: string;
  try {
    target = decodeURIComponent(href.split('#')[0]!);
  } catch {
    target = href;
  }
  const parts = dirOf(from) ? dirOf(from).split('/') : [];
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

/** Split a page file into its title (the H1) and the rest. */
export function splitTitle(md: string): { title: string; body: string } {
  const text = md.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = /^# (.*)\n?/.exec(text);
  return m ? { title: m[1]!.trim(), body: text.slice(m[0].length) } : { title: '', body: text };
}
