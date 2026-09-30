import { sql, type SQL } from 'drizzle-orm';
import { checkFormula, FormulaError, parseFormula, propFormulaType, unitOf, type Expr, type FormulaType, type PropertyDef } from '@papier/core';
import { properties, type Conn, type Prop } from './props.ts';
import { localToday } from './query.ts';
import type { Relations } from './relations.ts';
import { dbProperties } from './schema.ts';
import { eq } from 'drizzle-orm';

/**
 * Formulas → SQL. The AST (parsed and type-checked by @papier/core formula.js)
 * compiles to one scalar SQL expression over a row, so formula values sort
 * and filter in SQL like any column. Safety: every literal is a bound
 * parameter, operators and functions map to fixed SQL templates, and property
 * references become subqueries by id — no formula text reaches SQL.
 */

export type FormulaContext = {
  /** The database's properties. */
  props: PropertyDef[];
  rel: Relations;
  tzOffset: number;
  /** The row, as SQL: `p.id` inside a query, or a bound id. */
  rowId: SQL;
};

/** Formulas can reference formulas this deep. */
const MAX_DEPTH = 8;

/** The property a `prop("…")` means: exact name first, then ignoring case; "Name"/"Title" is the title. */
function findProp(props: PropertyDef[], name: string): PropertyDef | 'title' | undefined {
  const exact = props.find((p) => p.name === name) ?? props.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (exact) return exact;
  return ['name', 'title'].includes(name.toLowerCase()) ? 'title' : undefined;
}

/**
 * The formula type of a property by name, following formulas into their own
 * expressions (cycles are errors). undefined: no such property; null: unusable.
 */
function typeResolver(props: PropertyDef[], visiting: Set<string>) {
  const resolve = (name: string): FormulaType | null | undefined => {
    const p = findProp(props, name);
    if (p === undefined) return undefined;
    if (p === 'title') return 'text';
    if (p.type !== 'formula') return propFormulaType(p);
    if (visiting.has(p.id)) throw new FormulaError(`“${p.name}” refers back to itself`, 0);
    if (visiting.size >= MAX_DEPTH) throw new FormulaError('Formulas refer to each other too deeply', 0);
    const inner = new Set(visiting).add(p.id);
    return checkFormula(parseFormula(p.config.expression ?? ''), typeResolver(props, inner));
  };
  return resolve;
}

/** Parse and type-check a formula for a database. Throws FormulaError. */
export function formulaType(src: string, props: PropertyDef[], self?: string): FormulaType {
  return checkFormula(parseFormula(src), typeResolver(props, new Set(self ? [self] : [])));
}

/** Compile a formula to SQL (and its type). Throws FormulaError. */
export function compileFormula(src: string, ctx: FormulaContext, visiting: Set<string> = new Set()): { sql: SQL; type: FormulaType } {
  const ast = parseFormula(src);
  const type = checkFormula(ast, typeResolver(ctx.props, visiting));
  return { sql: compile(ast, ctx, visiting), type };
}

/** SQL for a property's value, as its formula type. */
function propSql(p: PropertyDef | 'title', ctx: FormulaContext, visiting: Set<string>): SQL {
  const row = ctx.rowId;
  if (p === 'title') return sql`(select nullif(title, '') from pages where id = ${row})`;
  const stored = (col: string) => sql`(select ${sql.raw(col)} from page_props where page_id = ${row} and prop_id = ${p.id})`;
  switch (p.type) {
    case 'text':
    case 'url':
      return stored(`json_extract(value, '$')`);
    case 'number':
      return stored('sort_num');
    case 'checkbox':
      return sql`(coalesce(${stored('sort_num')}, 0) = 1)`;
    case 'date':
      return stored('sort_text');
    case 'select': {
      const options = p.config.options ?? [];
      if (!options.length) return sql`null`;
      const names = sql.join(options.map((o) => sql`when ${o.id} then ${o.name}`), sql` `);
      return sql`(select case json_extract(value, '$') ${names} end from page_props where page_id = ${row} and prop_id = ${p.id})`;
    }
    case 'multi_select': {
      const options = p.config.options ?? [];
      if (!options.length) return sql`null`;
      const names = sql.join(options.map((o) => sql`when ${o.id} then ${o.name}`), sql` `);
      return sql`(select group_concat(case j.value ${names} end, ', ') from page_props pp, json_each(pp.value) j where pp.page_id = ${row} and pp.prop_id = ${p.id})`;
    }
    case 'created_time':
    case 'edited_time': {
      const col = sql.raw(p.type === 'created_time' ? 'created_at' : 'updated_at');
      return sql`(select date(${col} / 1000 - ${ctx.tzOffset * 60}, 'unixepoch') from pages where id = ${row})`;
    }
    case 'relation':
      return ctx.rel.titles(p, row);
    case 'rollup': {
      const r = ctx.rel.rollup(p, new Map(ctx.props.map((x) => [x.id, x])), row);
      return r ? r.expr : sql`null`;
    }
    case 'formula': {
      if (visiting.has(p.id)) throw new FormulaError(`“${p.name}” refers back to itself`, 0);
      return compileFormula(p.config.expression ?? '', ctx, new Set(visiting).add(p.id)).sql;
    }
    default:
      return sql`null`;
  }
}

/** A value as text (numbers without a trailing ".0", booleans as true/false). */
function asText(e: SQL, type: FormulaType): SQL {
  if (type === 'boolean') return sql`(case when ${e} is null then null when ${e} then 'true' else 'false' end)`;
  if (type === 'number') return sql`(case when ${e} = cast(${e} as integer) then cast(cast(${e} as integer) as text) else cast(${e} as text) end)`;
  return e;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** A date moved by whole months, clamped to the end of the month (as shiftDate in core). */
function addMonths(d: SQL, months: SQL): SQL {
  const target = sql`date(${d}, 'start of month', printf('%+d months', ${months}))`;
  const lastDay = sql`cast(strftime('%d', date(${d}, 'start of month', printf('%+d months', ${months} + 1), '-1 day')) as integer)`;
  return sql`date(${target}, printf('+%d days', min(cast(strftime('%d', ${d}) as integer), ${lastDay}) - 1))`;
}

function compile(e: Expr, ctx: FormulaContext, visiting: Set<string>): SQL {
  const c = (x: Expr) => compile(x, ctx, visiting);
  const typeOf = (x: Expr) => checkFormula(x, typeResolver(ctx.props, visiting));
  switch (e.k) {
    case 'num':
      return sql`${e.v}`;
    case 'str':
      return sql`${e.v}`;
    case 'bool':
      return sql.raw(e.v ? '1' : '0');
    case 'prop': {
      const p = findProp(ctx.props, e.name);
      if (p === undefined) throw new FormulaError(`There's no property called “${e.name}”`, e.pos);
      return propSql(p, ctx, visiting);
    }
    case 'un':
      return e.op === '-' ? sql`(- ${c(e.a)})` : sql`(not ${c(e.a)})`;
    case 'bin': {
      const [a, b] = [c(e.a), c(e.b)];
      switch (e.op) {
        case 'and':
          return sql`(${a} and ${b})`;
        case 'or':
          return sql`(${a} or ${b})`;
        case '==':
          return sql`(${a} is ${b})`;
        case '!=':
          return sql`(${a} is not ${b})`;
        case '<':
        case '>':
        case '<=':
        case '>=':
          return sql`(${a} ${sql.raw(e.op)} ${b})`;
        case '+': {
          const [ta, tb] = [typeOf(e.a), typeOf(e.b)];
          if (ta === 'text' || tb === 'text') return sql`(coalesce(${asText(a, ta)}, '') || coalesce(${asText(b, tb)}, ''))`;
          return sql`(${a} + ${b})`;
        }
        case '-':
          return sql`(${a} - ${b})`;
        case '*':
          return sql`(${a} * ${b})`;
        case '/':
          // Real division (7 / 2 = 3.5); dividing by zero is empty.
          return sql`(${a} * 1.0 / nullif(${b}, 0))`;
        case '%':
          return sql`(${a} % nullif(${b}, 0))`;
      }
      throw new FormulaError(`Unknown operator ${e.op}`, e.pos);
    }
    case 'call': {
      const args = e.args.map(c);
      const arg = (i: number) => args[i] ?? sql`null`;
      const lit = (i: number) => {
        const a = e.args[i];
        return a?.k === 'str' ? a.v : '';
      };
      switch (e.name) {
        case 'if':
          return sql`(case when ${arg(0)} then ${arg(1)} else ${arg(2)} end)`;
        case 'empty':
          return sql`(${arg(0)} is null or ${arg(0)} = '')`;
        case 'concat':
          return sql`(${sql.join(
            e.args.map((a, i) => sql`coalesce(${asText(arg(i), typeOf(a))}, '')`),
            sql` || `,
          )})`;
        case 'length':
          return sql`length(${arg(0)})`;
        case 'lower':
          return sql`lower(${arg(0)})`;
        case 'upper':
          return sql`upper(${arg(0)})`;
        case 'contains':
          // Empty text contains nothing: false, not empty.
          return sql`coalesce(instr(lower(${arg(0)}), lower(${arg(1)})) > 0, 0)`;
        case 'replace':
          return sql`replace(${arg(0)}, ${arg(1)}, ${arg(2)})`;
        case 'format':
          return asText(arg(0), typeOf(/** as given */ e.args[0]!));
        case 'round':
          return e.args.length > 1 ? sql`round(${arg(0)}, ${arg(1)})` : sql`round(${arg(0)})`;
        case 'floor':
          return sql`(case when ${arg(0)} < cast(${arg(0)} as integer) then cast(${arg(0)} as integer) - 1 else cast(${arg(0)} as integer) end)`;
        case 'ceil':
          return sql`(case when ${arg(0)} > cast(${arg(0)} as integer) then cast(${arg(0)} as integer) + 1 else cast(${arg(0)} as integer) end)`;
        case 'abs':
          return sql`abs(${arg(0)})`;
        case 'min':
          return sql`min(${sql.join(args, sql`, `)})`;
        case 'max':
          return sql`max(${sql.join(args, sql`, `)})`;
        case 'toNumber':
          return sql`cast(${arg(0)} as real)`;
        case 'today':
          return sql`${localToday(ctx.tzOffset)}`;
        case 'dateAdd':
        case 'dateSubtract': {
          const n = e.name === 'dateSubtract' ? sql`(- ${arg(1)})` : arg(1);
          const unit = unitOf(lit(2));
          if (unit === 'days') return sql`date(${arg(0)}, printf('%+d days', ${n}))`;
          if (unit === 'weeks') return sql`date(${arg(0)}, printf('%+d days', ${n} * 7))`;
          return addMonths(arg(0), unit === 'years' ? sql`(${n} * 12)` : n);
        }
        case 'dateBetween': {
          const [a, b] = [arg(0), arg(1)];
          const unit = unitOf(lit(2));
          if (unit === 'days') return sql`cast(julianday(${a}) - julianday(${b}) as integer)`;
          if (unit === 'weeks') return sql`cast((julianday(${a}) - julianday(${b})) / 7 as integer)`;
          const part = (d: SQL, f: string) => sql`cast(strftime(${f}, ${d}) as integer)`;
          const raw = sql`((${part(a, '%Y')} - ${part(b, '%Y')}) * 12 + ${part(a, '%m')} - ${part(b, '%m')})`;
          // A month only counts once its day has come round.
          const months = sql`(${raw} - (case when ${raw} > 0 and ${part(a, '%d')} < ${part(b, '%d')} then 1 when ${raw} < 0 and ${part(a, '%d')} > ${part(b, '%d')} then -1 else 0 end))`;
          return unit === 'years' ? sql`(${months} / 12)` : months;
        }
        case 'year':
          return sql`cast(strftime('%Y', ${arg(0)}) as integer)`;
        case 'month':
          return sql`cast(strftime('%m', ${arg(0)}) as integer)`;
        case 'day':
          return sql`cast(strftime('%d', ${arg(0)}) as integer)`;
        case 'weekday':
          return sql`((cast(strftime('%w', ${arg(0)}) as integer) + 6) % 7 + 1)`;
        case 'formatDate': {
          const d = arg(0);
          const pieces = (lit(1).match(/YYYY|MMMM|MMM|MM|M|DD|D|dddd|ddd|[^YMDd]+|./g) ?? []).map((tok) => {
            switch (tok) {
              case 'YYYY':
                return sql`strftime('%Y', ${d})`;
              case 'MM':
                return sql`strftime('%m', ${d})`;
              case 'M':
                return sql`cast(cast(strftime('%m', ${d}) as integer) as text)`;
              case 'DD':
                return sql`strftime('%d', ${d})`;
              case 'D':
                return sql`cast(cast(strftime('%d', ${d}) as integer) as text)`;
              case 'MMM':
              case 'MMMM':
                return sql`(case strftime('%m', ${d}) ${sql.join(MONTHS.map((m, i) => sql`when ${String(i + 1).padStart(2, '0')} then ${tok === 'MMM' ? m.slice(0, 3) : m}`), sql` `)} end)`;
              case 'ddd':
              case 'dddd':
                return sql`(case strftime('%w', ${d}) ${sql.join(DAYS.map((n, i) => sql`when ${String(i)} then ${tok === 'ddd' ? n.slice(0, 3) : n}`), sql` `)} end)`;
              default:
                return sql`${tok}`;
            }
          });
          return sql`(case when ${d} is null then null else ${pieces.length ? sql.join(pieces, sql` || `) : sql`''`} end)`;
        }
        case 'nextAnniversary': {
          const d = arg(0);
          const today = localToday(ctx.tzOffset);
          const year = today.slice(0, 4);
          const thisYear = sql`(${year} || substr(${d}, 5, 6))`;
          return sql`(case when ${d} is null then null when ${thisYear} >= ${today} then date(${thisYear}) else date((${String(Number(year) + 1)} || substr(${d}, 5, 6))) end)`;
        }
      }
      throw new FormulaError(`There's no function called “${e.name}”`, e.pos);
    }
  }
}

/** A formula's SQL result as a JS value of its type (booleans come back as 0/1). */
export function formulaValue(type: FormulaType, raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;
  if (type === 'boolean') return Boolean(raw);
  if (type === 'number') return typeof raw === 'number' ? raw : Number(raw);
  return String(raw);
}

/**
 * Keep each formula's `resultType` right after the database's properties
 * changed (a renamed or retyped property can change or break it).
 */
export function refreshFormulaTypes(conn: Conn, databaseId: string) {
  const props: Prop[] = properties(conn, databaseId);
  for (const p of props) {
    if (p.type !== 'formula') continue;
    let resultType: FormulaType | null = null;
    try {
      resultType = formulaType(p.config.expression ?? '', props, p.id);
    } catch (err) {
      if (!(err instanceof FormulaError)) throw err;
    }
    if (p.config.resultType !== resultType) {
      conn.update(dbProperties).set({ config: { ...p.config, resultType } }).where(eq(dbProperties.id, p.id)).run();
    }
  }
}
