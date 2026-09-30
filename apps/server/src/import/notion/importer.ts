// Import part of a Notion export through the API (in-process via `app.inject`), so
// every server invariant holds: the page-block tree, value sort keys, search.

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { orderBetween } from '@papier/core';
import { textToValue } from '@papier/core/props';
import { planDatabase, type DatabasePlan } from './database.ts';
import { parseNotionDate } from './dates.ts';
import { inlineText, parseInline, type Inline } from './inline.ts';
import { parseBody, type MdBlock } from './markdown.ts';
import { buildTree, resolveLink, splitTitle, walk, type ExportSource, type PageNode } from './tree.ts';

export type ImportOptions = {
  /** Display paths (ids stripped) of the pages to import with everything under them, e.g. `Dev/Cloudsmiths`.
   *  One inside another becomes its own top-level page; the outer one keeps a link to it. */
  include: string[];
};

export type ImportReport = {
  roots: { path: string; id: string }[];
  counts: { pages: number; databases: number; rows: number; blocks: number; properties: Record<string, number> };
  warnings: string[];
};

/** Upserts per batch request (the route allows 1000; this stays well under the body limit). */
const BATCH = 300;

type Prop = { id: string; name: string; type: string; config: { options?: { id: string; name: string }[] } };

export async function importNotion(app: FastifyInstance, source: ExportSource, opts: ImportOptions): Promise<ImportReport> {
  const tree = buildTree(source);
  const nodes = [...walk(tree)];
  const report: ImportReport = { roots: [], counts: { pages: 0, databases: 0, rows: 0, blocks: 0, properties: {} }, warnings: [] };
  const warn = (msg: string) => report.warnings.push(msg);

  const roots = opts.include.map((p) => {
    const n = nodes.find((x) => x.displayPath === p.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''));
    if (!n) throw new Error(`Not in the export: "${p}"`);
    return n;
  });
  const rootPaths = new Set(roots.map((r) => r.path));

  const api = async <T>(method: 'POST' | 'PATCH' | 'GET', url: string, payload?: object, what = url): Promise<T> => {
    const res = await app.inject({ method, url, payload });
    if (res.statusCode >= 300) throw new Error(`${method} ${url} (${what}) → ${res.statusCode}: ${res.body}`);
    return res.json() as T;
  };

  /** Export path → Papier page id, for everything imported. */
  const ids = new Map<string, string>();
  /** Pages whose content still has to be written, in creation order. */
  const pending: { node: PageNode; id: string; body: string; children: PageNode[] }[] = [];

  const setTitle = async (id: string, title: string, dateHint: string | null, where: string) => {
    const content = titleContent(title, dateHint, (m) => warn(`${where}: ${m}`));
    if (content) await api('PATCH', `/api/pages/${id}`, { titleContent: content }, where);
  };

  // Phase 1: create every page, database and row, so links can point anywhere.
  const create = async (node: PageNode, parentId: string | null): Promise<void> => {
    const { title, body } = splitTitle(source.read(node.path));
    const children = node.children.filter((c) => !rootPaths.has(c.path));

    if (node.csv) {
      const plan = planDatabase(source, node);
      plan.warnings.forEach(warn);
      const db = await api<{ id: string }>('POST', '/api/pages', { title: plainTitle(title), parentId, kind: 'database', block: false }, node.path);
      ids.set(node.path, db.id);
      await setTitle(db.id, title, null, node.displayPath);
      report.counts.databases++;
      await createDatabase(db.id, plan);
      return;
    }

    const page = await api<{ id: string }>('POST', '/api/pages', { title: plainTitle(title), parentId, block: false }, node.path);
    ids.set(node.path, page.id);
    await setTitle(page.id, title, null, node.displayPath);
    report.counts.pages++;
    pending.push({ node, id: page.id, body, children });
    for (const c of children) await create(c, page.id);
  };

  const createDatabase = async (dbId: string, plan: DatabasePlan) => {
    const props = new Map<string, Prop>();
    for (const c of plan.columns) {
      const config = c.options.length ? { options: c.options.map((name) => ({ name })) } : {};
      const p = await api<Prop>('POST', `/api/databases/${dbId}/properties`, { name: c.name.slice(0, 100) || 'Untitled', type: c.type, config }, plan.title);
      props.set(c.name, p);
      report.counts.properties[c.type] = (report.counts.properties[c.type] ?? 0) + 1;
    }

    for (const r of plan.rows) {
      const values: Record<string, unknown> = {};
      let dateHint: string | null = null;
      let dates = 0;
      for (const [name, text] of r.values) {
        const p = props.get(name)!;
        const v = p.type === 'date' ? parseNotionDate(text) : textToValue(p as Parameters<typeof textToValue>[0], text);
        if (v === null) {
          if (text.trim()) warn(`${r.node?.displayPath ?? r.title}: "${name}" value "${text}" doesn't fit ${p.type}`);
          continue;
        }
        values[p.id] = v;
        if (p.type === 'date') {
          dateHint = v as string;
          dates++;
        }
      }
      const where = r.node?.displayPath ?? `${plan.title}/${r.title}`;
      const row = await api<{ id: string }>('POST', `/api/databases/${dbId}/rows`, { title: plainTitle(r.title), props: values }, where);
      await setTitle(row.id, r.title, dates === 1 ? dateHint : null, where);
      report.counts.rows++;
      if (!r.node) continue;
      ids.set(r.node.path, row.id);
      const children = r.node.children.filter((c) => !rootPaths.has(c.path));
      pending.push({ node: r.node, id: row.id, body: r.body, children });
      for (const c of children) await create(c, row.id);
    }

    const { views } = await api<{ views: { id: string; config: object }[] }>('GET', `/api/databases/${dbId}`);
    const sorts = plan.sorts.map((s) => ({ propId: s.column === null ? 'title' : props.get(s.column)!.id, dir: s.dir }));
    if (sorts.length && views[0]) await api('PATCH', `/api/databases/${dbId}/views/${views[0].id}`, { config: { ...views[0].config, sorts } }, plan.title);
  };

  for (const r of roots) {
    await create(r, null);
    report.roots.push({ path: r.displayPath, id: ids.get(r.path)! });
  }

  // Phase 2: page content. Links to imported pages become page blocks; sub-pages the
  // body never linked to are appended, so each child keeps its owning block.
  for (const p of pending) {
    const blocks = parseBody(p.body, (m) => warn(`${p.node.displayPath}: ${m}`));
    const linked = new Set<string>();
    for (const b of blocks) {
      if (b.type !== 'page') continue;
      const target = resolveLink(p.node.path, b.link!);
      const id = ids.get(target);
      if (id) {
        b.props = { pageId: id };
        linked.add(target);
      } else {
        // Not imported (or a file): keep the link text.
        Object.assign(b, { type: 'paragraph', content: parseInline(b.linkText ?? '') });
        warn(`${p.node.displayPath}: link to "${b.linkText}" isn't imported, kept as text`);
      }
    }
    for (const c of p.children) if (!linked.has(c.path)) blocks.push({ type: 'page', indent: 0, props: { pageId: ids.get(c.path) }, content: [] });
    report.counts.blocks += await writeBlocks(p.id, blocks, (method, url, payload) => api(method, url, payload, p.node.path));
  }

  return report;
}

/** Flat blocks → stored rows (parent from indent, fractional order per parent), posted in batches. */
async function writeBlocks(pageId: string, blocks: MdBlock[], api: (method: 'POST', url: string, payload: object) => Promise<unknown>) {
  const parents: string[] = [];
  const lastOrder = new Map<string | null, string | null>();
  const upserts = blocks.map((b) => {
    const parentId = b.indent > 0 ? (parents[b.indent - 1] ?? null) : null;
    const order = orderBetween(lastOrder.get(parentId) ?? null, null);
    lastOrder.set(parentId, order);
    const id = randomUUID();
    parents.length = b.indent;
    parents[b.indent] = id;
    return { id, type: b.type, parentId, order, props: b.props, content: b.content };
  });
  for (let i = 0; i < upserts.length; i += BATCH) {
    await api('POST', `/api/pages/${pageId}/blocks/batch`, { upserts: upserts.slice(i, i + BATCH) });
  }
  return upserts.length;
}

const RELATIVE_MENTION = /@(Today|Yesterday|Tomorrow|(?:Last|Next|This) (?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/;

/**
 * Title inline content when the title holds a date mention, else null (a plain title).
 * Relative mentions (`@Last Monday`) were rendered at export time; a row's own date
 * (`dateHint`) stands in for them.
 */
export function titleContent(title: string, dateHint: string | null, warn: (m: string) => void = () => {}): Inline[] | null {
  const rel = RELATIVE_MENTION.exec(title);
  let relDate: string | null = null;
  if (rel) {
    if (dateHint) relDate = dateHint;
    else warn(`relative date "${rel[0]}" in the title kept as text`);
  }
  // Titles have no marks or links: flatten to plain runs around the dates.
  const out: Inline[] = [];
  const pushText = (text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last?.type === 'text') last.text += text;
    else out.push({ type: 'text', text, styles: {} });
  };
  const parts = relDate ? [title.slice(0, rel!.index), null, title.slice(rel!.index + rel![0].length)] : [title];
  for (const part of parts) {
    if (part === null) {
      out.push({ type: 'date', props: { date: relDate! } });
      continue;
    }
    for (const n of parseInline(part)) {
      if (n.type === 'date') out.push(n);
      else pushText(n.type === 'text' ? n.text : inlineText(n.content));
    }
  }
  return out.some((n) => n.type === 'date') ? out : null;
}

/** The plain title sent on create (a date-bearing title is replaced by its content right after). */
const plainTitle = (title: string) => inlineText(parseInline(title)).slice(0, 500);
