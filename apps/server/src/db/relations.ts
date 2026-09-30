import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  FormulaError,
  InvalidValue,
  orderBetween,
  ROLLUP_TARGET_TYPES,
  rollupFns,
  rollupResultType,
  TITLE_PROP,
  valueToText,
  type PropertyDef,
  type PropValue,
} from '@papier/core';
import type { Db } from './index.ts';
import { liveLineage } from './lineage.ts';
import { compileFormula, formulaValue } from './formula.ts';
import { properties, type Conn, type Prop } from './props.ts';
import { pageProps, pages, propertyLinks } from './schema.ts';

/**
 * Relations and rollups — the one place that knows how links are stored.
 *
 * A relation's links live in `property_links`, each stored once under the
 * property that owns it (`page_id` → `target_id`). A two-way relation's twin in
 * the target database has `config.reverseOf` and reads the same rows backwards.
 * Pages are never hard-deleted, so links to trashed pages stay and are filtered
 * here on every read: a link counts when its target is a live, non-template row.
 */

/** A page as a relation cell shows it. */
export type Ref = { title: string; titleContent: unknown[] | null; icon: string | null };

/** The link rows a relation reads: its own, or its twin's read backwards. */
export function linkSide(prop: PropertyDef) {
  const reverseOf = prop.config.reverseOf;
  return reverseOf
    ? { owner: reverseOf, mine: sql.raw('target_id'), theirs: sql.raw('page_id'), forward: false }
    : { owner: prop.id, mine: sql.raw('page_id'), theirs: sql.raw('target_id'), forward: true };
}

/** `t` (the linked page) is a live row, not a template. Its database's liveness is checked separately. */
const LIVE_TARGET = sql`t.archived_at is null and t.is_template = 0`;

/**
 * Per-request reads: which target databases are live, their properties, and the
 * SQL for relation predicates and rollups. Cached, since a query asks per property.
 */
export class Relations {
  private live = new Map<string, boolean>();
  private schemas = new Map<string, Map<string, Prop>>();
  private conn: Conn;
  private tzOffset: number;

  constructor(conn: Conn, tzOffset = 0) {
    this.conn = conn;
    this.tzOffset = tzOffset;
  }

  /** The relation's target database, when it is set and live. */
  targetDb(prop: PropertyDef): string | null {
    const id = prop.type === 'relation' ? prop.config.databaseId : null;
    if (!id) return null;
    let ok = this.live.get(id);
    if (ok === undefined) {
      const row = this.conn.select({ kind: pages.kind }).from(pages).where(eq(pages.id, id)).get();
      ok = row?.kind === 'database' && liveLineage(this.conn as Db, id) !== null;
      this.live.set(id, ok);
    }
    return ok ? id : null;
  }

  /** A database's properties by id. */
  schema(databaseId: string) {
    let s = this.schemas.get(databaseId);
    if (!s) this.schemas.set(databaseId, (s = new Map(properties(this.conn, databaseId).map((p) => [p.id, p]))));
    return s;
  }

  /** `from … where` over one row's live links (`t` is the linked page, `l` the link). */
  private links(prop: PropertyDef, rowId: SQL) {
    const { owner, mine, theirs } = linkSide(prop);
    return sql`from property_links l join pages t on t.id = l.${theirs} where l.prop_id = ${owner} and l.${mine} = ${rowId} and ${LIVE_TARGET}`;
  }

  /** Order of a cell's links: the owner's order, or when they were made (read backwards). */
  private linkOrder(prop: PropertyDef) {
    return linkSide(prop).forward ? sql`l.order_key, l.target_id` : sql`l.created_at, l.page_id`;
  }

  /** Predicate: the row links to `targetId` (or to anything, when omitted). */
  hasLink(prop: PropertyDef, rowId: SQL, targetId?: string): SQL {
    if (!this.targetDb(prop)) return sql`0`;
    const extra = targetId === undefined ? sql`` : sql` and t.id = ${targetId}`;
    return sql`exists (select 1 ${this.links(prop, rowId)}${extra})`;
  }

  /** The linked pages' titles, comma-separated (a relation in a formula). */
  titles(prop: PropertyDef, rowId: SQL): SQL {
    if (!this.targetDb(prop)) return sql`null`;
    return sql`(select group_concat(x.title, ', ') from (select t.title ${this.links(prop, rowId)} order by ${this.linkOrder(prop)}) x)`;
  }

  /** The first linked page's title, lowercased (for sorting). */
  firstTitle(prop: PropertyDef, rowId: SQL): SQL {
    if (!this.targetDb(prop)) return sql`null`;
    return sql`(select lower(t.title) ${this.links(prop, rowId)} order by ${this.linkOrder(prop)} limit 1)`;
  }

  /**
   * A rollup as a scalar SQL expression over one row's links, and what it
   * produces — or null while it isn't (validly) configured.
   */
  rollup(rollup: PropertyDef, props: Map<string, PropertyDef>, rowId: SQL) {
    const resolved = this.rollupParts(rollup, props);
    if (!resolved) return null;
    const { relation, target, targetType, fn } = resolved;
    const valueJoin = target ? sql` left join page_props tv on tv.page_id = t.id and tv.prop_id = ${target.id}` : sql``;
    const { owner, mine, theirs } = linkSide(relation);
    const from = sql`from property_links l join pages t on t.id = l.${theirs}${valueJoin} where l.prop_id = ${owner} and l.${mine} = ${rowId} and ${LIVE_TARGET}`;

    // The aggregated value: indexed columns, so every function is plain SQL.
    const day = (col: string) => sql`date(t.${sql.raw(col)} / 1000 - ${this.tzOffset * 60}, 'unixepoch')`;
    const val =
      targetType === 'title' ? sql`nullif(t.title, '')`
      : targetType === 'created_time' ? day('created_at')
      : targetType === 'edited_time' ? day('updated_at')
      : targetType === 'number' || targetType === 'checkbox' ? sql`tv.sort_num`
      : targetType === 'multi_select' ? sql`tv.value`
      : sql`tv.sort_text`;
    const whenAny = (e: SQL) => sql`case when count(*) = 0 then null else ${e} end`;
    const aggs: Record<string, SQL> = {
      count: sql`count(*)`,
      count_values: sql`count(${val})`,
      count_unique: sql`count(distinct ${val})`,
      count_empty: sql`count(*) - count(${val})`,
      percent_empty: whenAny(sql`(count(*) - count(${val})) * 1.0 / count(*)`),
      sum: sql`coalesce(sum(${val}), 0)`,
      avg: sql`avg(${val})`,
      min: sql`min(${val})`,
      max: sql`max(${val})`,
      range: sql`max(${val}) - min(${val})`,
      earliest: sql`min(${val})`,
      latest: sql`max(${val})`,
      checked: sql`coalesce(sum(${val}), 0)`,
      percent_checked: whenAny(sql`coalesce(sum(${val}), 0) * 1.0 / count(*)`),
    };
    const result = rollupResultType(fn);
    if (result === 'list') {
      // Raw values in link order; rollupValues turns them into display text.
      const raw = targetType === 'title' || targetType === 'created_time' || targetType === 'edited_time' ? val : sql`json(tv.value)`;
      return {
        result,
        target,
        expr: sql`(select json_group_array(x.v) from (select ${raw} as v ${from} order by ${this.linkOrder(relation)}) x where x.v is not null)`,
        // "Is empty" for a list: nothing to show.
        empty: sql`(select count(${val}) ${from}) = 0`,
      };
    }
    return { result, target, expr: sql`(select ${aggs[fn]!} ${from})`, empty: null };
  }

  private rollupParts(rollup: PropertyDef, props: Map<string, PropertyDef>) {
    const { relationId, targetPropId, fn } = rollup.config;
    const relation = relationId ? props.get(relationId) : undefined;
    if (!relation || relation.type !== 'relation' || !fn || !targetPropId) return null;
    const targetDbId = this.targetDb(relation);
    if (!targetDbId) return null;
    const target = targetPropId === TITLE_PROP ? null : this.schema(targetDbId).get(targetPropId);
    if (target === undefined) return null;
    const targetType = target ? target.type : TITLE_PROP;
    if (!ROLLUP_TARGET_TYPES.has(targetType) || !rollupFns(targetType).includes(fn)) return null;
    return { relation, target, targetType, fn };
  }

  /**
   * Relation and rollup values of some rows of one database, plus a title
   * lookup for every linked page. Other values come from `page_props`.
   */
  values(props: PropertyDef[], pageIds: string[]) {
    const values = new Map<string, Record<string, unknown>>(pageIds.map((id) => [id, {}]));
    const refs: Record<string, Ref> = {};
    if (!pageIds.length) return { values, refs };
    const ids = sql.join(pageIds.map((id) => sql`${id}`), sql`, `);

    for (const prop of props) {
      if (prop.type !== 'relation' || !this.targetDb(prop)) continue;
      const { owner, mine, theirs } = linkSide(prop);
      const rows = this.conn.all<{ row: string; id: string; title: string; title_content: string | null; icon: string | null }>(sql`
        select l.${mine} as row, t.id, t.title, t.title_content, t.icon
        from property_links l join pages t on t.id = l.${theirs}
        where l.prop_id = ${owner} and l.${mine} in (${ids}) and ${LIVE_TARGET}
        order by l.${mine}, ${this.linkOrder(prop)}
      `);
      for (const r of rows) {
        const cell = values.get(r.row)!;
        ((cell[prop.id] ??= []) as string[]).push(r.id);
        refs[r.id] ??= { title: r.title, titleContent: r.title_content === null ? null : JSON.parse(r.title_content), icon: r.icon };
      }
    }

    const byId = new Map(props.map((p) => [p.id, p]));
    // Rollups and formulas: one computed column each, in one query over the rows.
    const computed: { prop: PropertyDef; expr: SQL; read: (v: unknown) => unknown }[] = [];
    for (const p of props) {
      if (p.type === 'rollup') {
        const r = this.rollup(p, byId, sql`p.id`);
        if (r) computed.push({ prop: p, expr: r.expr, read: (v) => (r.result === 'list' ? listText(r.target, JSON.parse(v as string)) : v) });
      } else if (p.type === 'formula') {
        try {
          const f = compileFormula(p.config.expression ?? '', { props, rel: this, tzOffset: this.tzOffset, rowId: sql`p.id` }, new Set([p.id]));
          computed.push({ prop: p, expr: f.sql, read: (v) => formulaValue(f.type, v) });
        } catch (err) {
          if (!(err instanceof FormulaError)) throw err; // an invalid formula just shows nothing
        }
      }
    }
    if (computed.length) {
      const cols = sql.join(computed.map((c, i) => sql`${c.expr} as ${sql.raw(`c${i}`)}`), sql`, `);
      const rows = this.conn.all<Record<string, unknown>>(sql`select p.id, ${cols} from pages p where p.id in (${ids})`);
      for (const row of rows) {
        const cell = values.get(row.id as string)!;
        computed.forEach((c, i) => {
          const v = row[`c${i}`];
          if (v === null || v === undefined) return;
          const value = c.read(v);
          if (value !== null && value !== undefined) cell[c.prop.id] = value;
        });
      }
    }
    return { values, refs };
  }
}

/** A `show_original` rollup's raw values as display text. */
function listText(target: PropertyDef | null, raw: unknown[]) {
  const out = raw.map((v) => (target ? valueToText(target, v as PropValue) : String(v))).filter(Boolean);
  return out.length ? out : null;
}

/**
 * Turn a relation's links round to belong to its twin (`page_id` ↔ `target_id`),
 * keeping the order the twin showed them in (when they were made).
 */
export function handOverLinks(tx: Conn, fromId: string, toId: string) {
  const rows = tx.select().from(propertyLinks).where(eq(propertyLinks.propId, fromId)).orderBy(propertyLinks.targetId, propertyLinks.createdAt, propertyLinks.pageId).all();
  tx.delete(propertyLinks).where(eq(propertyLinks.propId, fromId)).run();
  let cell: string | null = null;
  let key: string | null = null;
  for (const l of rows) {
    if (l.targetId !== cell) [cell, key] = [l.targetId, null];
    key = orderBetween(key, null);
    tx.insert(propertyLinks).values({ pageId: l.targetId, propId: toId, targetId: l.pageId, orderKey: key, createdAt: l.createdAt }).run();
  }
}

/**
 * Set one row's links for a relation to exactly `ids` (null clears). Only live
 * links are replaced: links to trashed rows stay, for when they're restored.
 * New links go after the existing ones, in the order given.
 */
export function writeLinks(tx: Conn, pageId: string, prop: PropertyDef, ids: string[] | null) {
  const rel = new Relations(tx);
  const targetDb = rel.targetDb(prop);
  if (!targetDb) throw new InvalidValue(`"${prop.name}" isn't linked to a database yet`);
  const wanted = ids ?? [];
  if (wanted.length) {
    const found = tx
      .select({ id: pages.id })
      .from(pages)
      .where(and(inArray(pages.id, wanted), eq(pages.parentId, targetDb), sql`${pages.archivedAt} is null`, eq(pages.isTemplate, false)))
      .all();
    if (found.length !== wanted.length) throw new InvalidValue(`"${prop.name}" can only link to rows of its database`);
  }

  const { owner, forward } = linkSide(prop);
  // Stored as (page_id → target_id) under the owner; from the reverse side this row is the target.
  const key = (other: string) => (forward ? { pageId, targetId: other } : { pageId: other, targetId: pageId });
  const current = new Set(rel.values([prop], [pageId]).values.get(pageId)?.[prop.id] as string[] | undefined);
  const want = new Set(wanted);

  for (const other of current) {
    if (want.has(other)) continue;
    const k = key(other);
    tx.delete(propertyLinks).where(and(eq(propertyLinks.propId, owner), eq(propertyLinks.pageId, k.pageId), eq(propertyLinks.targetId, k.targetId))).run();
  }
  const now = Date.now();
  for (const other of wanted) {
    if (current.has(other)) continue;
    const k = key(other);
    const last = tx
      .select({ k: propertyLinks.orderKey })
      .from(propertyLinks)
      .where(and(eq(propertyLinks.propId, owner), eq(propertyLinks.pageId, k.pageId)))
      .orderBy(sql`${propertyLinks.orderKey} desc`)
      .limit(1)
      .get();
    tx.insert(propertyLinks)
      .values({ ...k, propId: owner, orderKey: orderBetween(last?.k ?? null, null), createdAt: now })
      .onConflictDoNothing()
      .run();
  }
}

/**
 * A row's property values — stored ones, relation links and rollups — plus the
 * titles of the rows it links to. Just the stored ones for a page that isn't a row.
 */
export function rowValues(db: Conn, id: string, tzOffset = 0) {
  const props: Record<string, unknown> = Object.fromEntries(
    db.select({ propId: pageProps.propId, value: pageProps.value }).from(pageProps).where(eq(pageProps.pageId, id)).all().map((v) => [v.propId, v.value]),
  );
  const database = db.get<{ id: string }>(sql`select d.id from pages p join pages d on d.id = p.parent_id and d.kind = 'database' where p.id = ${id}`);
  if (!database) return { props, refs: {} as Record<string, Ref> };
  const computed = new Relations(db, tzOffset).values(properties(db, database.id), [id]);
  return { props: { ...props, ...computed.values.get(id) }, refs: computed.refs };
}
