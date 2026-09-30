import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gt, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';
import {
  coerceValue,
  COMPUTED_TYPES,
  DatabaseQuery,
  FILTER_OPS,
  InvalidValue,
  orderBetween,
  PageConvert,
  PropertyCreate,
  PropertyUpdate,
  PropsPatch,
  RowCreate,
  RowMove,
  splitNames,
  TITLE_PROP,
  validateValue,
  valueToText,
  VALUELESS_OPS,
  ViewConfig,
  ViewCreate,
  ViewUpdate,
  type Filter,
  type PropValue,
  type Sort,
} from '@papier/core';
import type { Db } from '../db/index.ts';
import { duplicatePage, TooBig } from '../db/duplicate.ts';
import { liveLineage } from '../db/lineage.ts';
import { properties, propFields, views, viewFields, writeValue, type Conn, type Prop, type Tx } from '../db/props.ts';
import { indexTitle } from '../db/search.ts';
import { blocks, dbProperties, dbViews, pageProps, pages } from '../db/schema.ts';
import { rowDatabase } from './pages.ts';

type Option = { id: string; name: string };

/** Thrown inside a transaction to roll it back with a 400. */
class BadRequest extends Error {}

/**
 * The views a new database starts with: a table — or, for a board, a Status
 * select (Todo / Doing / Done) with a board grouped by it, then the table.
 */
export function createDefaultView(db: Conn, databaseId: string, layout: 'table' | 'board' = 'table') {
  const now = Date.now();
  const first = orderBetween(null, null);
  let tableKey = first;
  if (layout === 'board') {
    const statusId = randomUUID();
    const options = ['Todo', 'Doing', 'Done'].map((name) => ({ id: randomUUID().slice(0, 8), name }));
    db.insert(dbProperties).values({ id: statusId, databaseId, name: 'Status', type: 'select', config: { options }, orderKey: first, createdAt: now }).run();
    db.insert(dbViews)
      .values({ id: randomUUID(), databaseId, name: 'Board', type: 'board', config: ViewConfig.parse({ groupBy: statusId }), orderKey: first, createdAt: now })
      .run();
    tableKey = orderBetween(first, null);
  }
  db.insert(dbViews)
    .values({ id: randomUUID(), databaseId, name: 'Table', type: 'table', config: ViewConfig.parse({}), orderKey: tableKey, createdAt: now })
    .run();
}

/** Give new select options ids; keep at most 500. */
function withOptionIds(options: { id?: string; name: string }[] | undefined): Option[] | undefined {
  return options?.slice(0, 500).map((o) => ({ id: o.id ?? randomUUID().slice(0, 8), name: o.name }));
}

/**
 * Order key for an item placed before/after a sibling (default: last), among
 * rows matched by `scope`. Shared by properties, views and rows.
 */
function placeKey(
  db: Conn,
  table: typeof pages | typeof dbProperties | typeof dbViews,
  scope: SQL | undefined,
  { beforeId, afterId }: { beforeId?: string; afterId?: string },
) {
  const col = table.orderKey;
  const key = (where: SQL | undefined, dir: 'asc' | 'desc') =>
    db.select({ k: col }).from(table).where(and(scope, where)).orderBy(dir === 'asc' ? asc(col) : desc(col)).limit(1).get()?.k ?? null;
  const refId = beforeId ?? afterId;
  if (!refId) return orderBetween(key(undefined, 'desc'), null);
  const ref = key(eq(table.id, refId), 'asc');
  if (ref === null) throw new BadRequest('Sibling not found');
  return beforeId ? orderBetween(key(lt(col, ref), 'desc'), ref) : orderBetween(ref, key(gt(col, ref), 'asc'));
}

/** Validate and write a set of values for one row. */
function writeValues(db: Conn, pageId: string, props: Prop[], values: Record<string, unknown>, { template = false } = {}) {
  const byId = new Map(props.map((p) => [p.id, p]));
  for (const [propId, raw] of Object.entries(values)) {
    const prop = byId.get(propId);
    if (!prop) throw new BadRequest(`Unknown property ${propId}`);
    try {
      writeValue(db, pageId, prop, validateValue(prop, raw, { template }));
    } catch (err) {
      if (err instanceof InvalidValue) throw new BadRequest(err.message);
      throw err;
    }
  }
}

/**
 * Re-derive every stored value of a property after its type or options change:
 * `convert` maps the old value to the new one (null drops it).
 */
function rewriteValues(db: Conn, prop: Prop, convert: (v: PropValue) => PropValue) {
  const rows = db.select({ pageId: pageProps.pageId, value: pageProps.value }).from(pageProps).where(eq(pageProps.propId, prop.id)).all();
  for (const row of rows) {
    const next = convert(row.value as PropValue);
    if (next !== row.value) writeValue(db, row.pageId, prop, next);
  }
}

// ---------------------------------------------------------------------------
// Query building. Every property referenced by a filter/sort gets one left
// join on page_props (alias v0, v1, …); predicates run on the indexed
// sort_text / sort_num columns, multi-select on json_each(value).

type Ctx = { props: Map<string, Prop>; joins: Map<string, string>; tzOffset: number };

function alias(ctx: Ctx, propId: string) {
  let a = ctx.joins.get(propId);
  if (!a) ctx.joins.set(propId, (a = `v${ctx.joins.size}`));
  return sql.raw(a);
}

/** Local calendar date of a page timestamp column. */
const dayOf = (col: 'created_at' | 'updated_at', tzOffset: number) =>
  sql`date(p.${sql.raw(col)} / 1000 - ${tzOffset * 60}, 'unixepoch')`;

const likeEscape = (s: string) => `%${s.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

function typeOf(ctx: Ctx, propId: string) {
  return propId === TITLE_PROP ? 'title' : ctx.props.get(propId)?.type;
}

/** SQL predicate for one filter, or null to ignore it (unknown property, no value yet). */
function filterSql(ctx: Ctx, f: Filter): SQL | null {
  const type = typeOf(ctx, f.propId);
  if (!type || !FILTER_OPS[type]?.includes(f.op)) return null;
  const v = f.value;
  if (!VALUELESS_OPS.has(f.op) && (v === undefined || v === null || v === '')) return null;

  if (type === 'created_time' || type === 'edited_time') {
    const day = dayOf(type === 'created_time' ? 'created_at' : 'updated_at', ctx.tzOffset);
    return compareDate(day, f.op, String(v));
  }

  if (type === 'title' || type === 'text' || type === 'url') {
    const col = type === 'title' ? sql`nullif(lower(p.title), '')` : sql`${alias(ctx, f.propId)}.sort_text`;
    const text = String(v ?? '');
    switch (f.op) {
      case 'contains': return sql`${col} like ${likeEscape(text)} escape '\\'`;
      case 'not_contains': return sql`coalesce(${col}, '') not like ${likeEscape(text)} escape '\\'`;
      case 'is': return sql`${col} = ${text.toLowerCase()}`;
      case 'is_not': return sql`coalesce(${col}, '') <> ${text.toLowerCase()}`;
      case 'is_empty': return sql`${col} is null`;
      case 'is_not_empty': return sql`${col} is not null`;
    }
    return null;
  }

  const a = alias(ctx, f.propId);
  if (f.op === 'is_empty') return sql`${a}.page_id is null`;
  if (f.op === 'is_not_empty') return sql`${a}.page_id is not null`;

  switch (type) {
    case 'number': {
      const n = Number(v);
      if (!Number.isFinite(n)) return null;
      const col = sql`${a}.sort_num`;
      const ops: Record<string, SQL> = {
        '=': sql`${col} = ${n}`,
        '!=': sql`(${col} is null or ${col} <> ${n})`,
        '>': sql`${col} > ${n}`,
        '<': sql`${col} < ${n}`,
        '>=': sql`${col} >= ${n}`,
        '<=': sql`${col} <= ${n}`,
      };
      return ops[f.op] ?? null;
    }
    case 'select':
      return f.op === 'is' ? sql`${a}.sort_text = ${String(v)}` : sql`(${a}.sort_text is null or ${a}.sort_text <> ${String(v)})`;
    case 'multi_select': {
      const has = sql`exists (select 1 from json_each(${a}.value) where json_each.value = ${String(v)})`;
      return f.op === 'contains' ? has : sql`not ${has}`;
    }
    case 'date':
      return compareDate(sql`${a}.sort_text`, f.op, String(v));
    case 'checkbox':
      return v === true || v === 'true' ? sql`${a}.sort_num = 1` : sql`${a}.sort_num is null`;
  }
  return null;
}

function compareDate(col: SQL, op: string, day: string): SQL | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const ops: Record<string, SQL> = {
    is: sql`${col} = ${day}`,
    before: sql`${col} < ${day}`,
    after: sql`${col} > ${day}`,
    on_or_before: sql`${col} <= ${day}`,
    on_or_after: sql`${col} >= ${day}`,
  };
  return ops[op] ?? null;
}

/** ORDER BY terms for one sort; empty values always last. */
function sortSql(ctx: Ctx, s: Sort): SQL[] {
  const dir = sql.raw(s.dir === 'desc' ? 'desc' : 'asc');
  const type = typeOf(ctx, s.propId);
  if (!type) return [];
  if (type === 'date' && s.dir === 'upcoming') {
    // Month-day of the value ('MM-DD'): today's and later ones first, then those that wrap into next year.
    const md = sql`substr(${alias(ctx, s.propId)}.sort_text, 6, 5)`;
    const today = new Date(Date.now() - ctx.tzOffset * 60_000).toISOString().slice(5, 10);
    return [sql`${md} is null`, sql`${md} < ${today}`, md];
  }
  if (type === 'title') return [sql`p.title = ''`, sql`lower(p.title) ${dir}`];
  if (type === 'created_time') return [sql`p.created_at ${dir}`];
  if (type === 'edited_time') return [sql`p.updated_at ${dir}`];
  const a = alias(ctx, s.propId);
  if (type === 'select' || type === 'multi_select') {
    // Option order, not alphabetical (like Notion).
    const options = (ctx.props.get(s.propId)?.config.options ?? []) as Option[];
    if (!options.length) return [];
    const key = type === 'select' ? sql`${a}.sort_text` : sql`json_extract(${a}.value, '$[0]')`;
    const rank = sql`case ${key} ${sql.join(options.map((o, i) => sql`when ${o.id} then ${i}`), sql` `)} end`;
    return [sql`${rank} is null`, sql`${rank} ${dir}`];
  }
  const col = type === 'number' || type === 'checkbox' ? sql`${a}.sort_num` : sql`${a}.sort_text`;
  // An unchecked box is "no value", but sorts as false rather than last.
  if (type === 'checkbox') return [sql`coalesce(${col}, 0) ${dir}`];
  return [sql`${col} is null`, sql`${col} ${dir}`];
}

// ---------------------------------------------------------------------------

export function databaseRoutes(app: FastifyInstance, db: Db) {
  /** A live database page, or null. */
  const liveDatabase = (id: string) => {
    const row = db.select({ kind: pages.kind }).from(pages).where(and(eq(pages.id, id), isNull(pages.archivedAt))).get();
    return row?.kind === 'database' && liveLineage(db, id) ? id : null;
  };

  /** Run a write; BadRequest becomes a 400. */
  const write = <T>(reply: import('fastify').FastifyReply, fn: (tx: Tx) => T) => {
    try {
      return db.transaction(fn);
    } catch (err) {
      if (err instanceof BadRequest || err instanceof TooBig) {
        reply.code(400).send({ error: err.message });
        return undefined;
      }
      throw err;
    }
  };

  app.get<{ Params: { id: string } }>('/api/databases/:id', async (req, reply) => {
    const id = liveDatabase(req.params.id);
    if (!id) return reply.code(404).send({ error: 'Database not found' });
    // Row templates, for "New ▾".
    const templates = db
      .select({ id: pages.id, title: pages.title, titleContent: pages.titleContent, icon: pages.icon })
      .from(pages)
      .where(and(eq(pages.parentId, id), eq(pages.isTemplate, true), isNull(pages.archivedAt)))
      .orderBy(asc(pages.orderKey))
      .all();
    return { id, properties: properties(db, id), views: views(db, id), templates };
  });

  /**
   * Turn a new, empty page into a database (Notion's "start as a table/board").
   * Refused once it has content or sub-pages, and for rows.
   */
  app.post<{ Params: { id: string } }>('/api/pages/:id/convert', async (req, reply) => {
    const { layout } = PageConvert.parse(req.body ?? {});
    const id = req.params.id;
    const page = db.select({ kind: pages.kind }).from(pages).where(and(eq(pages.id, id), isNull(pages.archivedAt))).get();
    if (!page || !liveLineage(db, id)) return reply.code(404).send({ error: 'Page not found' });
    if (page.kind === 'database') return reply.code(400).send({ error: 'Already a database' });
    if (rowDatabase(db, id)) return reply.code(400).send({ error: 'A row can’t become a database' });
    const hasChild = db.select({ id: pages.id }).from(pages).where(and(eq(pages.parentId, id), isNull(pages.archivedAt))).limit(1).get();
    const content = db.select({ type: blocks.type, content: blocks.content }).from(blocks).where(eq(blocks.pageId, id)).all();
    const empty = content.every((b) => b.type === 'paragraph' && b.content.every((n) => !n.text));
    if (hasChild || !empty) return reply.code(400).send({ error: 'Only an empty page can become a database' });

    db.transaction((tx) => {
      tx.delete(blocks).where(eq(blocks.pageId, id)).run();
      tx.update(pages).set({ kind: 'database', updatedAt: Date.now() }).where(eq(pages.id, id)).run();
      createDefaultView(tx, id, layout);
    });
    return { id, kind: 'database' };
  });

  // --- properties ---

  app.post<{ Params: { id: string } }>('/api/databases/:id/properties', async (req, reply) => {
    const input = PropertyCreate.parse(req.body ?? {});
    const id = liveDatabase(req.params.id);
    if (!id) return reply.code(404).send({ error: 'Database not found' });
    const propId = randomUUID();
    const done = write(reply, (tx) => {
      const scope = eq(dbProperties.databaseId, id);
      const orderKey = placeKey(tx, dbProperties, scope, { afterId: input.afterId });
      const config = { ...input.config, options: withOptionIds(input.config.options) };
      tx.insert(dbProperties)
        .values({ id: propId, databaseId: id, name: input.name, type: input.type, config: stripUndefined(config), orderKey, createdAt: Date.now() })
        .run();
      return true;
    });
    if (!done) return reply;
    return reply.code(201).send(db.select(propFields).from(dbProperties).where(eq(dbProperties.id, propId)).get());
  });

  app.patch<{ Params: { id: string; propId: string } }>('/api/databases/:id/properties/:propId', async (req, reply) => {
    const input = PropertyUpdate.parse(req.body ?? {});
    const id = liveDatabase(req.params.id);
    const old = id && (db.select(propFields).from(dbProperties).where(and(eq(dbProperties.id, req.params.propId), eq(dbProperties.databaseId, id))).get() as Prop | undefined);
    if (!id || !old) return reply.code(404).send({ error: 'Property not found' });

    const done = write(reply, (tx) => {
      const patch: Partial<typeof dbProperties.$inferInsert> = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.beforeId || input.afterId) {
        const scope = and(eq(dbProperties.databaseId, id), sql`${dbProperties.id} <> ${old.id}`);
        patch.orderKey = placeKey(tx, dbProperties, scope, input);
      }

      const type = input.type ?? old.type;
      let config = { ...old.config, ...input.config, options: withOptionIds(input.config?.options ?? old.config.options) };
      const next: Prop = { ...old, type, config };

      if (type !== old.type) {
        // Text → select: every distinct value becomes an option.
        if ((type === 'select' || type === 'multi_select') && old.type !== 'select' && old.type !== 'multi_select') {
          const known = new Set((config.options ?? []).map((o) => o.name.toLowerCase()));
          const added: Option[] = [];
          for (const row of tx.select({ value: pageProps.value }).from(pageProps).where(eq(pageProps.propId, old.id)).all()) {
            const text = valueToText(old, row.value as PropValue);
            for (const name of type === 'multi_select' ? splitNames(text) : [text.trim()]) {
              if (name && !known.has(name.toLowerCase()) && added.length + known.size < 500) {
                known.add(name.toLowerCase());
                added.push({ id: randomUUID().slice(0, 8), name: name.slice(0, 100) });
              }
            }
          }
          config = { ...config, options: [...(config.options ?? []), ...added] };
          next.config = config;
        }
        if (COMPUTED_TYPES.has(type)) {
          tx.delete(pageProps).where(eq(pageProps.propId, old.id)).run();
        } else {
          rewriteValues(tx, next, (v) => coerceValue(old, next, v));
        }
      } else if (input.config?.options && (type === 'select' || type === 'multi_select')) {
        // Removed options disappear from values.
        rewriteValues(tx, next, (v) => {
          const ids = new Set((config.options ?? []).map((o) => o.id));
          if (type === 'select') return ids.has(v as string) ? v : null;
          const kept = (v as string[]).filter((o) => ids.has(o));
          return kept.length === (v as string[]).length ? v : kept.length ? kept : null;
        });
      }

      patch.type = type;
      patch.config = stripUndefined(config);
      tx.update(dbProperties).set(patch).where(eq(dbProperties.id, old.id)).run();
      if (type !== old.type) scrubViews(tx, id, old.id, { keepDisplay: true });
      return true;
    });
    if (!done) return reply;
    return db.select(propFields).from(dbProperties).where(eq(dbProperties.id, old.id)).get();
  });

  app.delete<{ Params: { id: string; propId: string } }>('/api/databases/:id/properties/:propId', async (req, reply) => {
    const id = liveDatabase(req.params.id);
    if (!id) return reply.code(404).send({ error: 'Database not found' });
    const deleted = db.transaction((tx) => {
      // Values go with it (on delete cascade).
      const row = tx.delete(dbProperties).where(and(eq(dbProperties.id, req.params.propId), eq(dbProperties.databaseId, id))).returning({ id: dbProperties.id }).get();
      if (row) scrubViews(tx, id, row.id, { keepDisplay: false });
      return row;
    });
    if (!deleted) return reply.code(404).send({ error: 'Property not found' });
    return reply.code(204).send();
  });

  // --- views ---

  app.post<{ Params: { id: string } }>('/api/databases/:id/views', async (req, reply) => {
    const input = ViewCreate.parse(req.body ?? {});
    const id = liveDatabase(req.params.id);
    if (!id) return reply.code(404).send({ error: 'Database not found' });
    const viewId = randomUUID();
    db.transaction((tx) => {
      const orderKey = placeKey(tx, dbViews, eq(dbViews.databaseId, id), {});
      tx.insert(dbViews).values({ id: viewId, databaseId: id, ...input, orderKey, createdAt: Date.now() }).run();
    });
    return reply.code(201).send(db.select(viewFields).from(dbViews).where(eq(dbViews.id, viewId)).get());
  });

  app.patch<{ Params: { id: string; viewId: string } }>('/api/databases/:id/views/:viewId', async (req, reply) => {
    const { beforeId, afterId, ...patch } = ViewUpdate.parse(req.body ?? {});
    const id = liveDatabase(req.params.id);
    const viewId = req.params.viewId;
    const exists = id && db.select({ id: dbViews.id }).from(dbViews).where(and(eq(dbViews.id, viewId), eq(dbViews.databaseId, id))).get();
    if (!id || !exists) return reply.code(404).send({ error: 'View not found' });
    const done = write(reply, (tx) => {
      const orderKey = beforeId || afterId
        ? placeKey(tx, dbViews, and(eq(dbViews.databaseId, id), sql`${dbViews.id} <> ${viewId}`), { beforeId, afterId })
        : undefined;
      tx.update(dbViews).set(stripUndefined({ ...patch, orderKey })).where(eq(dbViews.id, viewId)).run();
      return true;
    });
    if (!done) return reply;
    return db.select(viewFields).from(dbViews).where(eq(dbViews.id, viewId)).get();
  });

  app.delete<{ Params: { id: string; viewId: string } }>('/api/databases/:id/views/:viewId', async (req, reply) => {
    const id = liveDatabase(req.params.id);
    if (!id) return reply.code(404).send({ error: 'Database not found' });
    if (views(db, id).length <= 1) return reply.code(400).send({ error: 'A database needs at least one view' });
    const row = db.delete(dbViews).where(and(eq(dbViews.id, req.params.viewId), eq(dbViews.databaseId, id))).returning({ id: dbViews.id }).get();
    if (!row) return reply.code(404).send({ error: 'View not found' });
    return reply.code(204).send();
  });

  // --- rows ---

  /**
   * One page of rows, filtered and sorted in SQL. Sorts/filters come from the
   * view unless given; with neither, rows are in manual order (order_key).
   */
  app.post<{ Params: { id: string } }>('/api/databases/:id/query', async (req, reply) => {
    const q = DatabaseQuery.parse(req.body ?? {});
    const id = liveDatabase(req.params.id);
    if (!id) return reply.code(404).send({ error: 'Database not found' });

    let sorts = q.sorts;
    let filters = q.filters;
    if (q.viewId) {
      const view = db.select({ config: dbViews.config }).from(dbViews).where(and(eq(dbViews.id, q.viewId), eq(dbViews.databaseId, id))).get();
      if (!view) return reply.code(404).send({ error: 'View not found' });
      const config = ViewConfig.parse(view.config);
      sorts ??= config.sorts;
      filters ??= config.filters;
    }

    const props = properties(db, id);
    const ctx: Ctx = { props: new Map(props.map((p) => [p.id, p])), joins: new Map(), tzOffset: q.tzOffset };
    const where: SQL[] = [sql`p.parent_id = ${id}`, sql`p.archived_at is null`, sql`p.is_template = 0`];
    for (const f of filters ?? []) {
      const pred = filterSql(ctx, f);
      if (pred) where.push(pred);
    }
    if (q.group) {
      const prop = ctx.props.get(q.group.propId);
      if (!prop) return reply.code(400).send({ error: 'Unknown group property' });
      const a = alias(ctx, prop.id);
      if (q.group.value === null) where.push(sql`${a}.page_id is null`);
      else if (prop.type === 'multi_select') where.push(sql`exists (select 1 from json_each(${a}.value) where json_each.value = ${q.group.value})`);
      else where.push(sql`${a}.sort_text = ${q.group.value}`);
    }
    const order = (sorts ?? []).flatMap((s) => sortSql(ctx, s));
    order.push(sql`p.order_key`);

    const joins = sql.join(
      [...ctx.joins].map(([propId, a]) => sql`left join page_props ${sql.raw(a)} on ${sql.raw(a)}.page_id = p.id and ${sql.raw(a)}.prop_id = ${propId}`),
      sql` `,
    );
    const from = sql`from pages p ${joins} where ${sql.join(where, sql` and `)}`;

    const total = db.get<{ n: number }>(sql`select count(*) as n ${from}`)?.n ?? 0;
    const rows = db.all<{ id: string; title: string; title_content: string | null; icon: string | null; order_key: string; created_at: number; updated_at: number }>(
      sql`select p.id, p.title, p.title_content, p.icon, p.order_key, p.created_at, p.updated_at ${from} order by ${sql.join(order, sql`, `)} limit ${q.limit} offset ${q.offset}`,
    );

    const values = new Map<string, Record<string, unknown>>(rows.map((r) => [r.id, {}]));
    if (rows.length) {
      const found = db.select({ pageId: pageProps.pageId, propId: pageProps.propId, value: pageProps.value }).from(pageProps).where(inArray(pageProps.pageId, [...values.keys()])).all();
      for (const v of found) values.get(v.pageId)![v.propId] = v.value;
    }

    return {
      total,
      rows: rows.map((r) => ({
        id: r.id,
        title: r.title,
        titleContent: r.title_content === null ? null : JSON.parse(r.title_content),
        icon: r.icon,
        order: r.order_key,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        props: values.get(r.id),
      })),
    };
  });

  app.post<{ Params: { id: string } }>('/api/databases/:id/rows', async (req, reply) => {
    const input = RowCreate.parse(req.body ?? {});
    const id = liveDatabase(req.params.id);
    if (!id) return reply.code(404).send({ error: 'Database not found' });
    if (input.templateId) {
      const t = db.select({ parentId: pages.parentId, isTemplate: pages.isTemplate, archivedAt: pages.archivedAt }).from(pages).where(eq(pages.id, input.templateId)).get();
      if (!t || t.parentId !== id || !t.isTemplate || t.archivedAt !== null) return reply.code(400).send({ error: 'Not a template of this database' });
      if (!input.today) return reply.code(400).send({ error: 'today is required with a template' });
    }
    let rowId: string = randomUUID();
    const done = write(reply, (tx) => {
      const now = Date.now();
      const orderKey = placeKey(tx, pages, and(eq(pages.parentId, id), isNull(pages.archivedAt)), input);
      if (input.templateId) {
        // A copy of the template (values, content, sub-pages); given values and title win.
        rowId = duplicatePage(tx, input.templateId, { parentId: id, orderKey, isTemplate: false }, input.today as string);
        if (input.title) {
          tx.update(pages).set({ title: input.title, titleContent: null }).where(eq(pages.id, rowId)).run();
          indexTitle(tx, rowId, input.title);
        }
      } else {
        tx.insert(pages).values({ id: rowId, parentId: id, title: input.title, orderKey, createdAt: now, updatedAt: now }).run();
        indexTitle(tx, rowId, input.title);
      }
      writeValues(tx, rowId, properties(tx, id), input.props);
      return true;
    });
    if (!done) return reply;
    return reply.code(201).send(rowById(db, rowId));
  });

  /** A new, empty row template; the client opens it to fill in. */
  app.post<{ Params: { id: string } }>('/api/databases/:id/templates', async (req, reply) => {
    const id = liveDatabase(req.params.id);
    if (!id) return reply.code(404).send({ error: 'Database not found' });
    const templateId = randomUUID();
    db.transaction((tx) => {
      const now = Date.now();
      const orderKey = placeKey(tx, pages, and(eq(pages.parentId, id), isNull(pages.archivedAt)), {});
      tx.insert(pages).values({ id: templateId, parentId: id, isTemplate: true, title: '', orderKey, createdAt: now, updatedAt: now }).run();
      indexTitle(tx, templateId, '');
    });
    return reply.code(201).send(rowById(db, templateId));
  });

  /** Manual reorder (board cards, table rows) within the database. */
  app.post<{ Params: { id: string; rowId: string } }>('/api/databases/:id/rows/:rowId/move', async (req, reply) => {
    const input = RowMove.parse(req.body ?? {});
    const id = liveDatabase(req.params.id);
    const rowId = req.params.rowId;
    if (!id || rowDatabase(db, rowId)?.id !== id) return reply.code(404).send({ error: 'Row not found' });
    const done = write(reply, (tx) => {
      const orderKey = placeKey(tx, pages, and(eq(pages.parentId, id), isNull(pages.archivedAt), sql`${pages.id} <> ${rowId}`), input);
      tx.update(pages).set({ orderKey }).where(eq(pages.id, rowId)).run();
      return true;
    });
    if (!done) return reply;
    return rowById(db, rowId);
  });

  /** Set a row's property values (null clears one). */
  app.patch<{ Params: { id: string } }>('/api/pages/:id/props', async (req, reply) => {
    const input = PropsPatch.parse(req.body ?? {});
    const pageId = req.params.id;
    const database = rowDatabase(db, pageId);
    if (!database || !liveLineage(db, pageId)) return reply.code(404).send({ error: 'Row not found' });
    const template = db.select({ t: pages.isTemplate }).from(pages).where(eq(pages.id, pageId)).get()?.t ?? false;
    const done = write(reply, (tx) => {
      writeValues(tx, pageId, properties(tx, database.id), input, { template });
      tx.update(pages).set({ updatedAt: Date.now() }).where(eq(pages.id, pageId)).run();
      return true;
    });
    if (!done) return reply;
    return rowById(db, pageId);
  });
}

/** One row as the query route returns it. */
function rowById(db: Db, id: string) {
  const page = db
    .select({ id: pages.id, title: pages.title, titleContent: pages.titleContent, icon: pages.icon, order: pages.orderKey, createdAt: pages.createdAt, updatedAt: pages.updatedAt })
    .from(pages)
    .where(eq(pages.id, id))
    .get();
  const props = Object.fromEntries(
    db.select({ propId: pageProps.propId, value: pageProps.value }).from(pageProps).where(eq(pageProps.pageId, id)).all().map((v) => [v.propId, v.value]),
  );
  return { ...page, props };
}

/**
 * Drop a property from the database's views: from sorts and filters when its
 * type changed (they no longer fit), and from everything when it is deleted.
 */
function scrubViews(db: Conn, databaseId: string, propId: string, { keepDisplay }: { keepDisplay: boolean }) {
  for (const view of views(db, databaseId)) {
    const c = ViewConfig.parse(view.config);
    const next = {
      ...c,
      sorts: c.sorts.filter((s) => s.propId !== propId),
      filters: c.filters.filter((f) => f.propId !== propId),
      ...(keepDisplay
        ? {}
        : {
            hidden: c.hidden.filter((p) => p !== propId),
            propOrder: c.propOrder.filter((p) => p !== propId),
            widths: Object.fromEntries(Object.entries(c.widths).filter(([p]) => p !== propId)),
          }),
    };
    if (next.groupBy === propId && !keepDisplay) next.groupBy = null;
    db.update(dbViews).set({ config: next }).where(eq(dbViews.id, view.id)).run();
  }
}

function stripUndefined<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}
