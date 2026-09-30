import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { DYNAMIC_TODAY, plainText, validateValue, ViewConfig, type PropValue } from '@papier/core';
import { OWNING_BLOCKS } from './pageTree.ts';
import { properties, views, writeValue, type Prop, type Tx } from './props.ts';
import { indexBlocks, indexTitle } from './search.ts';
import { automations, blocks, dbProperties, dbViews, pageProps, pages, propertyLinks } from './schema.ts';
import { dueAt } from './automations.ts';

/**
 * Deep copy of a page: its content, the sub-pages its content owns (page and
 * database blocks), and for a database its properties, views, rows and row
 * templates. One engine behind Duplicate, Save as template and Use template.
 *
 * Dynamic dates (DYNAMIC_TODAY) in titles, content and values resolve to
 * `today` — unless the copy is itself a template, which keeps them dynamic.
 *
 * Relations are fixed up once everything is copied: configs and links that
 * point inside the copy follow it, ones that point outside stay (a row made from
 * a template keeps its project). A copied relation whose twin stays behind
 * becomes one-way, so the outside database doesn't gain the copy's links.
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
type Ctx = {
  tx: Tx;
  today: string;
  pages: number;
  blocks: number;
  now: number;
  /** Old → new, across the whole copy. */
  pageMap: Map<string, string>;
  propMap: Map<string, string>;
  /** Copied relation and rollup properties, by old id (configs are fixed up at the end). */
  linked: Map<string, Prop>;
  /** Copied button blocks (new ids): their actions are remapped at the end. */
  buttons: string[];
  /** Copied automations (new ids): triggers and actions are remapped at the end. */
  automations: string[];
};
type Copied = { id: string; views: Map<string, string> };

export function duplicatePage(tx: Tx, sourceId: string, target: Target, today: string): string {
  const ctx: Ctx = { tx, today, pages: 0, blocks: 0, now: Date.now(), pageMap: new Map(), propMap: new Map(), linked: new Map(), buttons: [], automations: [] };
  const id = copyPage(ctx, sourceId, target).id;
  fixRelationConfigs(ctx);
  fixButtonBlocks(ctx);
  fixAutomations(ctx);
  copyLinks(ctx);
  return id;
}

function copyPage(ctx: Ctx, sourceId: string, target: Target): Copied {
  const { tx } = ctx;
  const src = tx.select().from(pages).where(eq(pages.id, sourceId)).get();
  if (!src) throw new Error(`Page ${sourceId} not found`);
  if (++ctx.pages > MAX_PAGES) throw new TooBig(`Too big to copy (over ${MAX_PAGES} pages)`);

  const id = randomUUID();
  ctx.pageMap.set(sourceId, id);
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
      appearance: src.appearance,
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
    ctx.propMap.set(p.id, newId);
    if (p.type === 'relation' || p.type === 'rollup' || p.type === 'button') ctx.linked.set(p.id, p);
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
      dateBy: c.dateBy && mapProp(c.dateBy),
      template: c.template && (pageMap.get(c.template) ?? null),
    };
    const newId = randomUUID();
    viewMap.set(v.id, newId);
    tx.insert(dbViews).values({ id: newId, databaseId: toId, name: v.name, type: v.type, config, orderKey: v.order, createdAt: ctx.now }).run();
  }
  // Automations come along (on, as they were); what they point at is remapped at the end.
  for (const a of tx.select().from(automations).where(eq(automations.databaseId, fromId)).orderBy(asc(automations.orderKey)).all()) {
    const id = randomUUID();
    tx.insert(automations).values({ ...a, id, databaseId: toId, nextRunAt: null, lastRunAt: null, lastError: null, createdAt: ctx.now }).run();
    ctx.automations.push(id);
  }
  return viewMap;
}

/** Point copied relations, rollups and buttons at the copies of what they referred to, when those were copied too. */
function fixRelationConfigs(ctx: Ctx) {
  const map = (id: string | null | undefined) => (id ? (ctx.propMap.get(id) ?? id) : id);
  for (const [oldId, p] of ctx.linked) {
    const c = p.config;
    const config =
      p.type === 'button'
        ? { ...c, actions: remapActions(ctx, c.actions) }
        : p.type === 'relation'
        ? {
            ...c,
            databaseId: c.databaseId ? (ctx.pageMap.get(c.databaseId) ?? c.databaseId) : c.databaseId,
            // A twin left behind: the copy is one-way (and owns its links, see copyLinks).
            reverseId: c.reverseId ? (ctx.propMap.get(c.reverseId) ?? null) : c.reverseId,
            reverseOf: c.reverseOf ? (ctx.propMap.get(c.reverseOf) ?? null) : c.reverseOf,
          }
        : { ...c, relationId: map(c.relationId), targetPropId: map(c.targetPropId) };
    ctx.tx.update(dbProperties).set({ config }).where(eq(dbProperties.id, ctx.propMap.get(oldId)!)).run();
  }
}

/** Copied automations watch and act on the copies of the properties, databases and rows they name. */
function fixAutomations(ctx: Ctx) {
  const prop = (id: unknown) => (typeof id === 'string' ? (ctx.propMap.get(id) ?? id) : id);
  for (const id of ctx.automations) {
    const a = ctx.tx.select().from(automations).where(eq(automations.id, id)).get();
    if (!a) continue;
    const t = a.trigger as Record<string, unknown> & { when?: { propId: string } | null; filters?: { propId: string }[] };
    const trigger = {
      ...t,
      ...('propId' in t ? { propId: prop(t.propId) } : {}),
      ...(t.when ? { when: { ...t.when, propId: prop(t.when.propId) } } : {}),
      ...(t.filters ? { filters: t.filters.map((f) => ({ ...f, propId: prop(f.propId) })) } : {}),
    };
    const next = { ...a, trigger, actions: remapActions(ctx, a.actions) as unknown[] };
    // Copies inside a template stay put: the scheduler skips template databases anyway.
    ctx.tx.update(automations).set({ trigger, actions: next.actions, nextRunAt: dueAt(next, ctx.now) }).where(eq(automations.id, id)).run();
  }
}

/** Copied button blocks act on the copies of databases, properties and rows they name. */
function fixButtonBlocks(ctx: Ctx) {
  for (const id of ctx.buttons) {
    const b = ctx.tx.select({ props: blocks.props }).from(blocks).where(eq(blocks.id, id)).get();
    if (b) ctx.tx.update(blocks).set({ props: { ...b.props, actions: remapActions(ctx, b.props.actions) } }).where(eq(blocks.id, id)).run();
  }
}

/**
 * Actions (see @papier/core actions.js) with ids inside the copy swapped for
 * the copies' ids: properties, databases, templates and linked rows.
 * Anything outside the copy stays as it is.
 */
export function remapActions(ctx: Pick<Ctx, 'propMap' | 'pageMap'>, actions: unknown) {
  if (!Array.isArray(actions)) return actions;
  const prop = (id: unknown) => (typeof id === 'string' ? (ctx.propMap.get(id) ?? id) : id);
  const page = (id: unknown) => (typeof id === 'string' ? (ctx.pageMap.get(id) ?? id) : id);
  // Relation values are row ids; select values are option ids (copied as they are).
  const value = (v: unknown) => (Array.isArray(v) ? v.map(page) : v);
  return actions.map((a: Record<string, unknown>) => ({
    ...a,
    ...('propId' in a ? { propId: prop(a.propId) } : {}),
    ...('value' in a ? { value: value(a.value) } : {}),
    ...('rowIds' in a && Array.isArray(a.rowIds) ? { rowIds: a.rowIds.map(page) } : {}),
    ...('databaseId' in a ? { databaseId: page(a.databaseId) } : {}),
    ...('templateId' in a && a.templateId ? { templateId: page(a.templateId) } : {}),
    ...(a.values && typeof a.values === 'object'
      ? { values: Object.fromEntries(Object.entries(a.values).map(([k, v]) => [prop(k) as string, value(v)])) }
      : {}),
  }));
}

/**
 * Links touching a copied page. Under a copied property they follow it; under a
 * twin whose copy became one-way they're turned round to belong to that copy;
 * under a property that wasn't copied (a single row copied) the copy simply
 * gains the same links.
 */
function copyLinks(ctx: Ctx) {
  const { tx, pageMap, propMap } = ctx;
  const old = [...pageMap.keys()];
  const seen = new Set<string>();
  for (let i = 0; i < old.length; i += 400) {
    const chunk = old.slice(i, i + 400);
    const rows = [
      ...tx.select().from(propertyLinks).where(inArray(propertyLinks.pageId, chunk)).all(),
      ...tx.select().from(propertyLinks).where(inArray(propertyLinks.targetId, chunk)).all(),
    ];
    for (const l of rows) {
      const key = `${l.pageId} ${l.propId} ${l.targetId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const twin = [...ctx.linked.values()].find((p) => p.config.reverseOf === l.propId && !propMap.has(l.propId));
      let link: { pageId: string; propId: string; targetId: string } | null = null;
      if (propMap.has(l.propId)) {
        // Its database was copied, so the owning row was too (unless it's in the trash).
        if (pageMap.has(l.pageId)) link = { pageId: pageMap.get(l.pageId)!, propId: propMap.get(l.propId)!, targetId: pageMap.get(l.targetId) ?? l.targetId };
      } else if (twin) {
        if (pageMap.has(l.targetId)) link = { pageId: pageMap.get(l.targetId)!, propId: propMap.get(twin.id)!, targetId: l.pageId };
      } else {
        link = { pageId: pageMap.get(l.pageId) ?? l.pageId, propId: l.propId, targetId: pageMap.get(l.targetId) ?? l.targetId };
      }
      if (link) tx.insert(propertyLinks).values({ ...link, orderKey: l.orderKey, createdAt: ctx.now }).onConflictDoNothing().run();
    }
  }
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
  ctx.buttons.push(...ordered.filter((b) => b.type === 'button').map((b) => b.id));
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
