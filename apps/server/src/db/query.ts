import { sql, type SQL } from 'drizzle-orm';
import { DYNAMIC_TODAY, filterOps, TITLE_PROP, VALUELESS_OPS, type Filter, type Sort } from '@papier/core';
import { properties, type Conn, type Prop } from './props.ts';

type Option = { id: string; name: string };
import { Relations } from './relations.ts';

// Query building. Every property referenced by a filter/sort gets one left
// join on page_props (alias v0, v1, …); predicates run on the indexed
// sort_text / sort_num columns, multi-select on json_each(value). Relations and
// rollups are correlated subqueries over property_links (db/relations.ts).

export type Ctx = { props: Map<string, Prop>; joins: Map<string, string>; tzOffset: number; rel: Relations };

export function alias(ctx: Ctx, propId: string) {
  let a = ctx.joins.get(propId);
  if (!a) ctx.joins.set(propId, (a = `v${ctx.joins.size}`));
  return sql.raw(a);
}

/** Local calendar date of a page timestamp column. */
const dayOf = (col: 'created_at' | 'updated_at', tzOffset: number) =>
  sql`date(p.${sql.raw(col)} / 1000 - ${tzOffset * 60}, 'unixepoch')`;

export const likeEscape = (s: string) => `%${s.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

function typeOf(ctx: Ctx, propId: string) {
  return propId === TITLE_PROP ? 'title' : ctx.props.get(propId)?.type;
}

/** SQL predicate for one filter, or null to ignore it (unknown property, no value yet). */
export function filterSql(ctx: Ctx, f: Filter): SQL | null {
  const type = typeOf(ctx, f.propId);
  const prop = ctx.props.get(f.propId);
  if (!type || !filterOps(prop ?? { type }).includes(f.op)) return null;
  // Date filters may say "today" (DYNAMIC_TODAY): the viewer's today, when the query runs.
  const v = f.value === DYNAMIC_TODAY ? localToday(ctx.tzOffset) : f.value;
  if (!VALUELESS_OPS.has(f.op) && (v === undefined || v === null || v === '')) return null;

  if (type === 'relation') {
    const has = ctx.rel.hasLink(prop!, sql`p.id`, VALUELESS_OPS.has(f.op) ? undefined : String(v));
    return f.op === 'contains' || f.op === 'is_not_empty' ? has : sql`not ${has}`;
  }

  if (type === 'rollup') {
    const r = ctx.rel.rollup(prop!, ctx.props, sql`p.id`);
    if (!r) return null;
    if (r.empty) return f.op === 'is_empty' ? r.empty : sql`not ${r.empty}`;
    if (f.op === 'is_empty') return sql`${r.expr} is null`;
    if (f.op === 'is_not_empty') return sql`${r.expr} is not null`;
    if (r.result === 'date') return compareDate(r.expr, f.op, String(v));
    // Percentages are stored 0–1 and filtered as shown (0–100).
    return compareNum(r.result === 'percent' ? sql`${r.expr} * 100` : r.expr, f.op, Number(v));
  }

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
    case 'number':
      return compareNum(sql`${a}.sort_num`, f.op, Number(v));
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

function compareNum(col: SQL, op: string, n: number): SQL | null {
  if (!Number.isFinite(n)) return null;
  const ops: Record<string, SQL> = {
    '=': sql`${col} = ${n}`,
    '!=': sql`(${col} is null or ${col} <> ${n})`,
    '>': sql`${col} > ${n}`,
    '<': sql`${col} < ${n}`,
    '>=': sql`${col} >= ${n}`,
    '<=': sql`${col} <= ${n}`,
  };
  return ops[op] ?? null;
}

/** YYYY-MM-DD in the viewer's timezone (`Date#getTimezoneOffset()` minutes). */
export const localToday = (tzOffset: number, now = Date.now()) => new Date(now - tzOffset * 60_000).toISOString().slice(0, 10);

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
export function sortSql(ctx: Ctx, s: Sort): SQL[] {
  const dir = sql.raw(s.dir === 'desc' ? 'desc' : 'asc');
  const type = typeOf(ctx, s.propId);
  if (!type) return [];
  if (type === 'date' && s.dir === 'upcoming') {
    // Month-day of the value ('MM-DD'): today's and later ones first, then those that wrap into next year.
    const md = sql`substr(${alias(ctx, s.propId)}.sort_text, 6, 5)`;
    const today = localToday(ctx.tzOffset).slice(5);
    return [sql`${md} is null`, sql`${md} < ${today}`, md];
  }
  if (type === 'title') return [sql`p.title = ''`, sql`lower(p.title) ${dir}`];
  if (type === 'created_time') return [sql`p.created_at ${dir}`];
  if (type === 'edited_time') return [sql`p.updated_at ${dir}`];
  if (type === 'relation') {
    // By the first linked row's title, like Notion.
    const first = ctx.rel.firstTitle(ctx.props.get(s.propId)!, sql`p.id`);
    return [sql`${first} is null`, sql`${first} ${dir}`];
  }
  if (type === 'rollup') {
    const r = ctx.rel.rollup(ctx.props.get(s.propId)!, ctx.props, sql`p.id`);
    if (!r || r.result === 'list') return [];
    return [sql`${r.expr} is null`, sql`${r.expr} ${dir}`];
  }
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


/** A query context over one database's properties. */
export function queryCtx(conn: Conn, databaseId: string, tzOffset = 0): Ctx {
  return { props: new Map(properties(conn, databaseId).map((p) => [p.id, p])), joins: new Map(), tzOffset, rel: new Relations(conn, tzOffset) };
}

/** `from pages p <joins> where …`: the database's live rows, narrowed by `where` (built with `ctx`). */
export function rowsFrom(ctx: Ctx, databaseId: string, where: SQL[]) {
  const joins = sql.join(
    [...ctx.joins].map(([propId, a]) => sql`left join page_props ${sql.raw(a)} on ${sql.raw(a)}.page_id = p.id and ${sql.raw(a)}.prop_id = ${propId}`),
    sql` `,
  );
  const all = [sql`p.parent_id = ${databaseId}`, sql`p.archived_at is null`, sql`p.is_template = 0`, ...where];
  return sql`from pages p ${joins} where ${sql.join(all, sql` and `)}`;
}

/**
 * Ids of the database's rows that pass every filter (in manual order), or just
 * whether `rowId` does. Filters that don't apply (unknown property, no value) pass.
 */
export function matchingRows(conn: Conn, databaseId: string, filters: Filter[], { tzOffset = 0, rowId, limit = 500 }: { tzOffset?: number; rowId?: string; limit?: number } = {}) {
  const ctx = queryCtx(conn, databaseId, tzOffset);
  const where = filters.flatMap((f) => filterSql(ctx, f) ?? []);
  if (rowId) where.push(sql`p.id = ${rowId}`);
  return conn.all<{ id: string }>(sql`select p.id ${rowsFrom(ctx, databaseId, where)} order by p.order_key limit ${limit}`).map((r) => r.id);
}
