import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { DYNAMIC_TODAY, plainText, validateValue, ViewConfig, type PropValue } from '@papier/core';
import { OWNING_BLOCKS } from './pageTree.ts';
import { properties, views, writeValue, type Tx } from './props.ts';
import { indexBlocks, indexTitle } from './search.ts';
import { blocks, dbProperties, dbViews, pageProps, pages } from './schema.ts';

/**
 * Deep copy of a page: its content, the sub-pages its content owns (page and
 * database blocks), and for a database its properties, views, rows and row
 * templates. One engine behind Duplicate, Save as template and Use template.
 *
 * Dynamic dates (DYNAMIC_TODAY) in titles, content and values resolve to
 * `today` — unless the copy is itself a template, which keeps them dynamic.
 */

/** Past these, a copy is refused: it would hold the (single, small) server too long. */
export const MAX_PAGES = 2000;
export const MAX_BLOCKS = 50_000;

export class TooBig extends Error {}

type Target = {
  parentId: string | null;
  orderKey: string;
  isTemplate: boolean;
  /** Old → new property ids, when copying into a copy of the source's database. */
  propMap?: Map<string, string>;
};
type Ctx = { tx: Tx; today: string; pages: number; blocks: number; now: number };
type Copied = { id: string; views: Map<string, string> };

export function duplicatePage(tx: Tx, sourceId: string, target: Target, today: string): string {
  const ctx: Ctx = { tx, today, pages: 0, blocks: 0, now: Date.now() };
  return copyPage(ctx, sourceId, target).id;
}

function copyPage(ctx: Ctx, sourceId: string, target: Target): Copied {
  const { tx } = ctx;
  const src = tx.select().from(pages).where(eq(pages.id, sourceId)).get();
  if (!src) throw new Error(`Page ${sourceId} not found`);
  if (++ctx.pages > MAX_PAGES) throw new TooBig(`Too big to copy (over ${MAX_PAGES} pages)`);

  const id = randomUUID();
  // Dates stay dynamic in a template and anything inside one.
  const resolve = !target.isTemplate && !(target.parentId && isTemplateTree(tx, target.parentId));
  const titleContent = src.titleContent && resolve ? resolveDates(src.titleContent, ctx.today) : src.titleContent;
  const title = titleContent && titleContent !== src.titleContent ? plainText(titleContent as never).slice(0, 500) : src.title;
  tx.insert(pages)
    .values({
      id,
      parentId: target.parentId,
      title,
      titleContent,
      icon: src.icon,
      kind: src.kind,
      isTemplate: target.isTemplate,
      orderKey: target.orderKey,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    .run();
  indexTitle(tx, id, title);

  copyValues(ctx, src.id, id, target, resolve);
  const viewMap = src.kind === 'database' ? copyDatabase(ctx, src.id, id) : new Map<string, string>();
  copyBlocks(ctx, src.id, id, resolve);
  return { id, views: viewMap };
}

/** A row's (or row template's) values, into the same database or a copy of it. */
function copyValues(ctx: Ctx, fromId: string, toId: string, target: Target, resolve: boolean) {
  if (!target.parentId) return;
  const parent = ctx.tx.select({ kind: pages.kind }).from(pages).where(eq(pages.id, target.parentId)).get();
  if (parent?.kind !== 'database') return;
  const props = new Map(properties(ctx.tx, target.parentId).map((p) => [p.id, p]));
  for (const v of ctx.tx.select().from(pageProps).where(eq(pageProps.pageId, fromId)).all()) {
    const prop = props.get(target.propMap?.get(v.propId) ?? v.propId);
    if (!prop) continue;
    const value = resolve && v.value === DYNAMIC_TODAY ? ctx.today : (v.value as PropValue);
    writeValue(ctx.tx, toId, prop, validateValue(prop, value, { template: !resolve }));
  }
}

/** Properties, rows (and row templates), then views — whose configs point at both. */
function copyDatabase(ctx: Ctx, fromId: string, toId: string): Map<string, string> {
  const { tx } = ctx;
  const propMap = new Map<string, string>();
  for (const p of properties(tx, fromId)) {
    const newId = randomUUID();
    propMap.set(p.id, newId);
    tx.insert(dbProperties).values({ id: newId, databaseId: toId, name: p.name, type: p.type, config: p.config, orderKey: p.order, createdAt: ctx.now }).run();
  }

  const pageMap = new Map<string, string>();
  const rows = tx
    .select({ id: pages.id, orderKey: pages.orderKey, isTemplate: pages.isTemplate })
    .from(pages)
    .where(and(eq(pages.parentId, fromId), isNull(pages.archivedAt)))
    .orderBy(asc(pages.orderKey))
    .all();
  for (const r of rows) {
    pageMap.set(r.id, copyPage(ctx, r.id, { parentId: toId, orderKey: r.orderKey, isTemplate: r.isTemplate, propMap }).id);
  }

  const viewMap = new Map<string, string>();
  const mapProp = (p: string) => propMap.get(p) ?? p; // 'title' and friends stay
  for (const v of views(tx, fromId)) {
    const c = ViewConfig.parse(v.config);
    const config = {
      ...c,
      sorts: c.sorts.map((s) => ({ ...s, propId: mapProp(s.propId) })),
      filters: c.filters.map((f) => ({ ...f, propId: mapProp(f.propId) })),
      hidden: c.hidden.map(mapProp),
      propOrder: c.propOrder.map(mapProp),
      widths: Object.fromEntries(Object.entries(c.widths).map(([p, w]) => [mapProp(p), w])),
      groupBy: c.groupBy && mapProp(c.groupBy),
      template: c.template && (pageMap.get(c.template) ?? null),
    };
    const newId = randomUUID();
    viewMap.set(v.id, newId);
    tx.insert(dbViews).values({ id: newId, databaseId: toId, name: v.name, type: v.type, config, orderKey: v.order, createdAt: ctx.now }).run();
  }
  return viewMap;
}

/**
 * The page's blocks with fresh ids (ids are unique across pages). Blocks that
 * own a child page get a copy of that child; links to other pages stay links.
 */
function copyBlocks(ctx: Ctx, fromId: string, toId: string, resolve: boolean) {
  const { tx } = ctx;
  const rows = tx.select().from(blocks).where(eq(blocks.pageId, fromId)).all();
  if (!rows.length) return;
  ctx.blocks += rows.length;
  if (ctx.blocks > MAX_BLOCKS) throw new TooBig(`Too big to copy (over ${MAX_BLOCKS} blocks)`);

  const ids = new Map(rows.map((b) => [b.id, randomUUID()]));
  const out = rows.map((b) => {
    let props = b.props;
    const ownedId = OWNING_BLOCKS.includes(b.type) ? (props.pageId as string | undefined) : undefined;
    if (ownedId) {
      const child = tx.select({ parentId: pages.parentId, archivedAt: pages.archivedAt, orderKey: pages.orderKey }).from(pages).where(eq(pages.id, ownedId)).get();
      if (child && child.parentId === fromId && child.archivedAt === null) {
        const copy = copyPage(ctx, ownedId, { parentId: toId, orderKey: child.orderKey, isTemplate: false });
        const viewId = typeof props.viewId === 'string' ? copy.views.get(props.viewId) : undefined;
        props = { ...props, pageId: copy.id, ...(viewId ? { viewId } : {}) };
      }
    }
    return {
      id: ids.get(b.id)!,
      pageId: toId,
      parentId: b.parentId ? (ids.get(b.parentId) ?? null) : null,
      type: b.type,
      orderKey: b.orderKey,
      props,
      content: resolve ? resolveDates(b.content, ctx.today) : b.content,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    };
  });
  // Parents before children, so the self-reference holds at every insert.
  const byParent = new Map<string | null, typeof out>();
  for (const b of out) byParent.set(b.parentId, [...(byParent.get(b.parentId) ?? []), b]);
  const ordered: typeof out = [];
  const walk = (parent: string | null) => {
    for (const b of byParent.get(parent) ?? []) {
      ordered.push(b);
      walk(b.id);
    }
  };
  walk(null);
  for (const b of ordered) tx.insert(blocks).values(b).run();
  indexBlocks(tx, toId, ordered);
}

/** Whether a page is a template or lies under one (its dates stay dynamic). */
function isTemplateTree(tx: Tx, pageId: string): boolean {
  let id: string | null = pageId;
  for (let depth = 0; id && depth < 100; depth++) {
    const row: { parentId: string | null; isTemplate: boolean } | undefined = tx
      .select({ parentId: pages.parentId, isTemplate: pages.isTemplate })
      .from(pages)
      .where(eq(pages.id, id))
      .get();
    if (!row) return false;
    if (row.isTemplate) return true;
    id = row.parentId;
  }
  return false;
}

/** Replace DYNAMIC_TODAY in inline date mentions (recursing into links). */
function resolveDates<T extends Record<string, unknown>>(content: T[], today: string): T[] {
  return content.map((node) => {
    const props = node.props as { date?: unknown } | undefined;
    if (node.type === 'date' && props?.date === DYNAMIC_TODAY) return { ...node, props: { ...props, date: today } };
    if (Array.isArray(node.content)) return { ...node, content: resolveDates(node.content as T[], today) };
    return node;
  });
}
