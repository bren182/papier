import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import {
  coerceValue,
  COMPUTED_TYPES,
  DatabaseQuery,
  InvalidValue,
  orderBetween,
  PageConvert,
  PropertyCreate,
  PropertyUpdate,
  PropsPatch,
  RowCreate,
  RowMove,
  RowsDelete,
  RowsPatch,
  RowsTransfer,
  splitNames,
  valueToText,
  ViewConfig,
  ViewCreate,
  ViewUpdate,
  type PropertyDef,
  type PropValue,
} from '@papier/core';
import type { Db } from '../db/index.ts';
import { TooBig } from '../db/duplicate.ts';
import { liveLineage } from '../db/lineage.ts';
import { properties, propFields, views, viewFields, writeValue, type Conn, type Prop, type Tx } from '../db/props.ts';
import { firePropsChanged, fireRowAdded } from '../db/automations.ts';
import { refreshFormulaTypes } from '../db/formula.ts';
import { alias, filterSql, likeEscape, queryCtx, rowsFrom, sortSql } from '../db/query.ts';
import { handOverLinks, Relations, rowValues } from '../db/relations.ts';
import { createRow, placeKey, writeValues } from '../db/rows.ts';
import { mapProperties, setManyRows, transferRows, trashRows } from '../db/transfer.ts';
import { indexTitle, reindexProp } from '../db/search.ts';
import { blocks, dbProperties, dbViews, pageProps, pages, propertyLinks } from '../db/schema.ts';
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
      if (err instanceof BadRequest || err instanceof InvalidValue || err instanceof TooBig) {
        reply.code(400).send({ error: err.message });
        return undefined;
      }
      throw err;
    }
  };

  /** Live databases by title, for choosing a relation's target. Templates and trashed ones are left out. */
  app.get<{ Querystring: { q?: string; limit?: string } }>('/api/databases', async (req) => {
    const q = String(req.query.q ?? '').trim().slice(0, 200);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const rows = db.all<{ id: string; title: string; title_content: string | null; icon: string | null }>(sql`
      with recursive dead(id) as (
        select id from pages where archived_at is not null or is_template = 1
        union
        select p.id from pages p join dead d on p.parent_id = d.id
      )
      select id, title, title_content, icon from pages
      where kind = 'database' and id not in (select id from dead)
        ${q ? sql`and lower(title) like ${likeEscape(q)} escape '\\'` : sql``}
        ${req.workspaceId ? sql`and workspace_id = ${req.workspaceId}` : sql``}
      order by title = '', lower(title), id
      limit ${limit}
    `);
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      titleContent: r.title_content === null ? null : JSON.parse(r.title_content),
      icon: r.icon,
      // Where it lives ("Cloudsmiths › Standups"), to tell same-named databases apart.
      path: (liveLineage(db, r.id) ?? []).slice(0, -1).map((c) => c.title || 'Untitled'),
    }));
  });

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
      const { twoWay, reverseId: _r, reverseOf: _o, ...rest } = input.config;
      const config = stripUndefined({ ...rest, options: withOptionIds(input.config.options) });
      if (input.type === 'relation') checkTarget(tx, config.databaseId);
      tx.insert(dbProperties).values({ id: propId, databaseId: id, name: input.name, type: input.type, config, orderKey, createdAt: Date.now() }).run();
      // Two-way unless asked otherwise: the target database gets the twin.
      if (input.type === 'relation' && config.databaseId && twoWay !== false) {
        addTwin(tx, id, { id: propId, name: input.name, type: input.type, config, order: orderKey });
      }
      refreshFormulaTypes(tx, id);
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
      const { twoWay, reverseId: _r, reverseOf: _o, ...given } = input.config ?? {};
      let config = { ...old.config, ...given, options: withOptionIds(input.config?.options ?? old.config.options) };
      const next: Prop = { ...old, type, config };

      // Relations: re-targeting or changing type away unlinks; twoWay adds or drops the twin.
      const wasRelation = old.type === 'relation';
      const retarget = type === 'relation' && (config.databaseId ?? null) !== (wasRelation ? (old.config.databaseId ?? null) : null);
      if (wasRelation && (type !== 'relation' || retarget)) {
        if (old.config.reverseOf && type === 'relation') throw new BadRequest('Change this relation from its other side');
        unlink(tx, old);
        config = { ...config, reverseId: null, reverseOf: null };
      }
      if (type === 'relation') {
        if (retarget) checkTarget(tx, config.databaseId);
        if (!config.reverseOf) {
          if (twoWay === false && config.reverseId) {
            dropTwin(tx, config.reverseId);
            config = { ...config, reverseId: null };
          } else if (!config.reverseId && config.databaseId && (twoWay === true || (retarget && twoWay !== false))) {
            config = { ...config, reverseId: addTwin(tx, id, { ...next, name: input.name ?? old.name, config }) };
          }
        }
      }
      next.config = config;

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
        if (COMPUTED_TYPES.has(type) || type === 'relation') {
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
      if (type !== old.type || input.config?.options) reindexProp(tx, { ...next, type, config });
      // Formulas name properties: follow a rename, and re-derive what they compute.
      if (input.name !== undefined && input.name !== old.name) renameInFormulas(tx, id, old.name, input.name);
      refreshFormulaTypes(tx, id);
      return true;
    });
    if (!done) return reply;
    return db.select(propFields).from(dbProperties).where(eq(dbProperties.id, old.id)).get();
  });

  app.delete<{ Params: { id: string; propId: string } }>('/api/databases/:id/properties/:propId', async (req, reply) => {
    const id = liveDatabase(req.params.id);
    if (!id) return reply.code(404).send({ error: 'Database not found' });
    const deleted = db.transaction((tx) => {
      const prop = tx.select(propFields).from(dbProperties).where(and(eq(dbProperties.id, req.params.propId), eq(dbProperties.databaseId, id))).get() as Prop | undefined;
      if (!prop) return false;
      if (prop.type === 'relation') {
        const { reverseId, reverseOf } = prop.config;
        if (reverseId) {
          // The twin takes over the links (read the other way round) and becomes one-way.
          handOverLinks(tx, prop.id, reverseId);
          setConfig(tx, reverseId, (c) => ({ ...c, reverseOf: null, reverseId: null }));
        }
        if (reverseOf) setConfig(tx, reverseOf, (c) => ({ ...c, reverseId: null }));
      }
      deleteProp(tx, id, prop.id);
      refreshFormulaTypes(tx, id);
      return true;
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

    const ctx = queryCtx(db, id, q.tzOffset);
    const props = [...ctx.props.values()];
    const where: SQL[] = [];
    for (const f of filters ?? []) {
      const pred = filterSql(ctx, f);
      if (pred) where.push(pred);
    }
    if (q.group) {
      // One board column / table group: rows whose value is `value` (null: no value).
      const prop = ctx.props.get(q.group.propId);
      if (!prop) return reply.code(400).send({ error: 'Unknown group property' });
      const value = q.group.value;
      if (prop.type === 'relation') {
        // Grouped by linked row: rows linking to it (null: linking to nothing).
        const has = ctx.rel.hasLink(prop, sql`p.id`, value ?? undefined);
        where.push(value === null ? sql`not ${has}` : has);
      } else {
        const a = alias(ctx, prop.id);
        if (value === null) where.push(sql`${a}.page_id is null`);
        else if (prop.type === 'multi_select') where.push(sql`exists (select 1 from json_each(${a}.value) where json_each.value = ${value})`);
        else if (prop.type === 'checkbox') where.push(sql`${a}.sort_num = 1`);
        else where.push(sql`${a}.sort_text = ${value}`);
      }
    }
    const order = (sorts ?? []).flatMap((s) => sortSql(ctx, s));
    order.push(sql`p.order_key`);

    const from = rowsFrom(ctx, id, where);

    const total = db.get<{ n: number }>(sql`select count(*) as n ${from}`)?.n ?? 0;
    const rows = db.all<{ id: string; title: string; title_content: string | null; icon: string | null; order_key: string; created_at: number; updated_at: number }>(
      sql`select p.id, p.title, p.title_content, p.icon, p.order_key, p.created_at, p.updated_at ${from} order by ${sql.join(order, sql`, `)} limit ${q.limit} offset ${q.offset}`,
    );

    const values = new Map<string, Record<string, unknown>>(rows.map((r) => [r.id, {}]));
    if (rows.length) {
      const found = db.select({ pageId: pageProps.pageId, propId: pageProps.propId, value: pageProps.value }).from(pageProps).where(inArray(pageProps.pageId, [...values.keys()])).all();
      for (const v of found) values.get(v.pageId)![v.propId] = v.value;
    }
    const computed = ctx.rel.values(props, [...values.keys()]);
    for (const [rowId, v] of computed.values) Object.assign(values.get(rowId)!, v);

    return {
      total,
      /** Title and icon of every row a relation cell links to. */
      refs: computed.refs,
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
    const rowId = write(reply, (tx) => {
      const rowId = createRow(tx, id, input, input.today);
      fireRowAdded(tx, id, rowId);
      return rowId;
    });
    if (!rowId) return reply;
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

  // --- many rows at once ---

  /** The same values on many rows (fill down, bulk "set property"). */
  app.patch<{ Params: { id: string } }>('/api/databases/:id/rows/props', async (req, reply) => {
    const input = RowsPatch.parse(req.body ?? {});
    const id = liveDatabase(req.params.id);
    if (!id) return reply.code(404).send({ error: 'Database not found' });
    const rows = write(reply, (tx) => setManyRows(tx, id, input.rowIds, input.values));
    if (!rows) return reply;
    return { rows };
  });

  app.post<{ Params: { id: string } }>('/api/databases/:id/rows/delete', async (req, reply) => {
    const input = RowsDelete.parse(req.body ?? {});
    const id = liveDatabase(req.params.id);
    if (!id) return reply.code(404).send({ error: 'Database not found' });
    return { rows: db.transaction((tx) => trashRows(tx, id, input.rowIds)) };
  });

  /** How this database's properties would land in another one (the move/copy dialog's preview). */
  app.get<{ Params: { id: string }; Querystring: { targetId?: string } }>('/api/databases/:id/transfer-preview', async (req, reply) => {
    const id = liveDatabase(req.params.id);
    const target = liveDatabase(String(req.query.targetId ?? ''));
    if (!id || !target) return reply.code(404).send({ error: 'Database not found' });
    const { pairs: _pairs, ...mapping } = mapProperties(properties(db, id), properties(db, target));
    return mapping;
  });

  /** Move or copy rows to another database; values follow property names. */
  app.post<{ Params: { id: string } }>('/api/databases/:id/rows/transfer', async (req, reply) => {
    const input = RowsTransfer.parse(req.body ?? {});
    const id = liveDatabase(req.params.id);
    const target = liveDatabase(input.targetId);
    if (!id || !target) return reply.code(404).send({ error: 'Database not found' });
    const result = write(reply, (tx) => transferRows(tx, { ...input, sourceId: id, targetId: target }));
    if (!result) return reply;
    return result;
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
      const before = rowValues(tx, pageId).props;
      writeValues(tx, pageId, properties(tx, database.id), input, { template });
      tx.update(pages).set({ updatedAt: Date.now() }).where(eq(pages.id, pageId)).run();
      // Automations watch real changes to real rows (not templates, not no-op writes).
      if (!template) {
        const after = rowValues(tx, pageId).props;
        const changed = Object.keys(input).filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null));
        firePropsChanged(tx, database.id, pageId, changed);
      }
      return true;
    });
    if (!done) return reply;
    return rowById(db, pageId);
  });
}

/** One row as the query route returns it. */
export function rowById(db: Db, id: string) {
  const page = db
    .select({ id: pages.id, title: pages.title, titleContent: pages.titleContent, icon: pages.icon, order: pages.orderKey, createdAt: pages.createdAt, updatedAt: pages.updatedAt })
    .from(pages)
    .where(eq(pages.id, id))
    .get();
  const { props, refs } = rowValues(db, id);
  return { ...page, props, refs };
}

// ---------------------------------------------------------------------------
// Relation pairs. The owning side keeps `reverseId` (its twin), the twin keeps
// `reverseOf`; links are stored once, under the owner (db/relations.ts).

/** A relation may only point at a live database (or nowhere yet). */
function checkTarget(tx: Conn, databaseId: string | null | undefined) {
  if (!databaseId) return;
  if (!new Relations(tx).targetDb({ id: '', name: '', type: 'relation', config: { databaseId } })) throw new BadRequest('Relation target is not a database');
}

/**
 * Give a relation its twin in the target database (named after this one) and
 * point the pair at each other. Returns the twin's id.
 */
function addTwin(tx: Tx, databaseId: string, prop: Prop): string {
  const target = prop.config.databaseId!;
  const source = tx.select({ title: pages.title }).from(pages).where(eq(pages.id, databaseId)).get();
  const base = (target === databaseId ? `${prop.name} (reverse)` : source?.title.trim() || 'Related').slice(0, 90);
  const taken = new Set(properties(tx, target).map((p) => p.name.toLowerCase()));
  let name = base;
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base} ${i}`;
  const twinId = randomUUID();
  tx.insert(dbProperties)
    .values({
      id: twinId,
      databaseId: target,
      name,
      type: 'relation',
      config: { databaseId, reverseOf: prop.id },
      orderKey: placeKey(tx, dbProperties, eq(dbProperties.databaseId, target), {}),
      createdAt: Date.now(),
    })
    .run();
  setConfig(tx, prop.id, (c) => ({ ...c, reverseId: twinId }));
  return twinId;
}

/** A relation stops being one: an owner drops its links and twin, a twin just detaches. */
function unlink(tx: Tx, prop: Prop) {
  const { reverseId, reverseOf } = prop.config;
  if (reverseOf) setConfig(tx, reverseOf, (c) => ({ ...c, reverseId: null }));
  else {
    tx.delete(propertyLinks).where(eq(propertyLinks.propId, prop.id)).run();
    if (reverseId) dropTwin(tx, reverseId);
  }
  scrubRollups(tx, prop.id);
}

/** Delete a relation's twin (its links belong to the owner and go with it). */
function dropTwin(tx: Tx, twinId: string) {
  const twin = tx.select({ databaseId: dbProperties.databaseId }).from(dbProperties).where(eq(dbProperties.id, twinId)).get();
  if (twin) deleteProp(tx, twin.databaseId, twinId);
}

/** Delete a property and scrub what refers to it. Values, links and search rows cascade. */
function deleteProp(tx: Tx, databaseId: string, propId: string) {
  tx.delete(dbProperties).where(eq(dbProperties.id, propId)).run();
  scrubViews(tx, databaseId, propId, { keepDisplay: false });
  scrubRollups(tx, propId);
}

/** `prop("Old")` → `prop("New")` in the database's formulas, after a rename. */
function renameInFormulas(tx: Tx, databaseId: string, from: string, to: string) {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`prop\\(\\s*["'“]${escaped}["'”]\\s*\\)`, 'g');
  const quoted = `prop("${to.replace(/"/g, '\\"')}")`;
  for (const p of properties(tx, databaseId)) {
    if (p.type !== 'formula' || !p.config.expression) continue;
    const expression = p.config.expression.replace(pattern, () => quoted);
    if (expression !== p.config.expression) setConfig(tx, p.id, (c) => ({ ...c, expression }));
  }
}

/** Rollups over a property that is gone (or no longer a relation) lose that part of their config. */
function scrubRollups(tx: Tx, propId: string) {
  const rows = tx.all<{ id: string }>(sql`
    select id from db_properties where type = 'rollup'
      and (json_extract(config, '$.relationId') = ${propId} or json_extract(config, '$.targetPropId') = ${propId})
  `);
  for (const r of rows) {
    setConfig(tx, r.id, (c) => (c.relationId === propId ? { ...c, relationId: null, targetPropId: null } : { ...c, targetPropId: null }));
  }
}

function setConfig(tx: Tx, propId: string, fn: (c: PropertyDef['config']) => PropertyDef['config']) {
  const row = tx.select({ config: dbProperties.config }).from(dbProperties).where(eq(dbProperties.id, propId)).get();
  if (row) tx.update(dbProperties).set({ config: fn(row.config as PropertyDef['config']) }).where(eq(dbProperties.id, propId)).run();
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
    if (next.dateBy === propId && !keepDisplay) next.dateBy = null;
    db.update(dbViews).set({ config: next }).where(eq(dbViews.id, view.id)).run();
  }
}

function stripUndefined<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}
