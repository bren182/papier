// A Notion database (CSV + row pages + view settings) → properties, rows and a sort.

import { splitNames } from '@papier/core/props';
import { readCsv } from './csv.ts';
import { monthDay, parseNotionDate } from './dates.ts';
import { splitTitle, type ExportSource, type PageNode } from './tree.ts';

export type ColumnType = 'text' | 'number' | 'select' | 'multi_select' | 'date' | 'checkbox' | 'url';
export type Column = { name: string; type: ColumnType; options: string[] };
/** `node` is null for a row that only exists in the CSV. */
export type RowPlan = { node: PageNode | null; title: string; values: Map<string, string>; body: string };
export type SortPlan = { column: string | null; dir: 'asc' | 'desc' | 'upcoming' };

export type DatabasePlan = {
  title: string;
  /** Properties in CSV order, the title column excluded. */
  columns: Column[];
  rows: RowPlan[];
  /** `column` null = the title. */
  sorts: SortPlan[];
  warnings: string[];
};

/** Status-like option sets keep their natural order, not first-seen. */
const NATURAL_ORDERS = [['not started', 'todo', 'to do', 'in progress', 'doing', 'blocked', 'review', 'done', 'complete', 'completed', 'archived']];

const MAX_SELECT_OPTIONS = 20;

export function planDatabase(source: ExportSource, node: PageNode): DatabasePlan {
  const warnings: string[] = [];
  const { title, body: dbBody } = splitTitle(source.read(node.path));
  const { columns: header, records } = readCsv(source.read(node.csv!));
  const titleColumn = header[0] ?? 'Name';
  const columnNames = header.slice(1);
  const known = new Set(columnNames);

  // Row pages: title from the H1, values from the leading `Key: value` block.
  const parsed = node.children.map((child) => {
    const { title: rowTitle, body } = splitTitle(source.read(child.path));
    return { node: child, title: rowTitle, ...leadingProps(body) };
  });

  // Keys that aren't CSV columns but head most rows are computed (formulas, rollups…).
  const extraCount = new Map<string, number>();
  for (const r of parsed) for (const [k] of r.props) if (!known.has(k)) extraCount.set(k, (extraCount.get(k) ?? 0) + 1);
  const computed = new Set([...extraCount].filter(([, n]) => n >= parsed.length / 2).map(([k]) => k));
  if (computed.size) warnings.push(`${title}: dropped computed properties ${[...computed].join(', ')}`);

  const rows: RowPlan[] = [];
  const extras = new Map<RowPlan, Map<string, string>>();
  for (const r of parsed) {
    // The block counts as properties only up to the first line that isn't one.
    const values = new Map<string, string>();
    const extra = new Map<string, string>();
    let taken = 0;
    for (const [k, v] of r.props) {
      if (known.has(k)) values.set(k, v);
      else if (computed.has(k)) extra.set(k, v);
      else break;
      taken++;
    }
    const body = taken === r.props.length ? r.rest : r.lines.slice(taken).join('\n') + '\n' + r.rest;
    const row = { node: r.node, title: r.title, values, body };
    rows.push(row);
    extras.set(row, extra);
  }
  // Notion writes no page for a row without content: those only exist in the CSV.
  // Pair pages with records by title, then (titles with relative dates differ) by values.
  const unmatched = new Set(records);
  const sameValues = (row: RowPlan, rec: Record<string, string>) =>
    row.values.size > 0 && [...row.values].every(([k, v]) => (rec[k] ?? '').trim() === v) && columnNames.every((k) => row.values.has(k) || !(rec[k] ?? '').trim());
  const loose: RowPlan[] = [];
  for (const row of rows) {
    const rec = [...unmatched].find((r) => (r[titleColumn] ?? '').trim() === row.title && sameValues(row, r)) ?? [...unmatched].find((r) => (r[titleColumn] ?? '').trim() === row.title);
    if (rec) unmatched.delete(rec);
    else loose.push(row);
  }
  let pageOnly = 0;
  for (const row of loose) {
    const candidates = [...unmatched].filter((r) => sameValues(row, r));
    if (candidates.length === 1) unmatched.delete(candidates[0]!);
    else pageOnly++;
  }
  if (unmatched.size) warnings.push(`${title}: ${unmatched.size} rows only in the CSV (no page content)`);
  for (const rec of records) {
    if (!unmatched.has(rec)) continue;
    const values = new Map(columnNames.filter((k) => (rec[k] ?? '').trim()).map((k) => [k, rec[k]!.trim()]));
    rows.push({ node: null, title: (rec[titleColumn] ?? '').trim(), values, body: '' });
  }
  if (pageOnly > 0) warnings.push(`${title}: ${pageOnly} row pages not in the CSV (imported anyway)`);

  // Types from the values; option order from the CSV (the view's order).
  const columns = columnNames.map((name) => inferColumn(name, records.map((r) => r[name] ?? '')));

  const sorts: SortPlan[] = [];
  for (const [prop, dir] of viewSorts(dbBody)) {
    if (prop === titleColumn) sorts.push({ column: null, dir });
    else if (known.has(prop)) sorts.push({ column: prop, dir });
    else {
      const date = computed.has(prop) ? anniversaryOf(prop, columns, rows, extras) : null;
      if (date) sorts.push({ column: date, dir: 'upcoming' });
      else warnings.push(`${title}: dropped the sort on "${prop}"`);
    }
  }

  return { title, columns, rows, sorts, warnings };
}

/** The `Key: value` lines right after the title (row properties), and the rest. */
function leadingProps(body: string) {
  const all = body.split('\n');
  let i = 0;
  while (i < all.length && !all[i]!.trim()) i++;
  const lines: string[] = [];
  const props: [string, string][] = [];
  for (; i < all.length; i++) {
    const m = /^([^:\s][^:]{0,99}): (.*)$/.exec(all[i]!);
    if (!m) break;
    lines.push(all[i]!);
    props.push([m[1]!.trim(), m[2]!.trim()]);
  }
  return { props, lines, rest: all.slice(i).join('\n') };
}

/** `sort:` then `Prop: ascending|descending` lines in a database page. */
function viewSorts(body: string): [string, 'asc' | 'desc'][] {
  const out: [string, 'asc' | 'desc'][] = [];
  const lines = body.split('\n');
  const at = lines.findIndex((l) => /^sort:\s*$/.test(l.trim()));
  if (at === -1) return out;
  for (const l of lines.slice(at + 1)) {
    const m = /^(.+): (ascending|descending)$/.exec(l.trim());
    if (!m) break;
    out.push([m[1]!, m[2] === 'descending' ? 'desc' : 'asc']);
  }
  return out;
}

/**
 * A computed column that always falls on the same month and day as a date column
 * (Notion's "next birthday" formulas) sorts like that date's next anniversary.
 */
function anniversaryOf(prop: string, columns: Column[], rows: RowPlan[], extras: Map<RowPlan, Map<string, string>>): string | null {
  for (const c of columns) {
    if (c.type !== 'date') continue;
    let pairs = 0;
    const ok = rows.every((r) => {
      const a = parseNotionDate(extras.get(r)?.get(prop) ?? '');
      const b = parseNotionDate(r.values.get(c.name) ?? '');
      if (!a || !b) return true;
      pairs++;
      return monthDay(a) === monthDay(b);
    });
    if (ok && pairs > 0) return c.name;
  }
  return null;
}

/** Pick a property type from a column's values. */
export function inferColumn(name: string, raw: string[]): Column {
  const vals = raw.map((v) => v.trim()).filter(Boolean);
  const col = (type: ColumnType, options: string[] = []): Column => ({ name, type, options });
  if (!vals.length) return col('text');
  if (vals.every((v) => parseNotionDate(v))) return col('date');
  if (vals.every((v) => /^(yes|no)$/i.test(v))) return col('checkbox');
  if (vals.every((v) => /^-?[\d,]*\.?\d+%?$/.test(v))) return col('number');
  if (vals.every((v) => /^https?:\/\/\S+$/.test(v))) return col('url');

  const short = vals.every((v) => v.length <= 100 && !v.includes('\n'));
  if (short && vals.some((v) => v.includes(','))) {
    const tokens = vals.flatMap(splitNames);
    const distinct = distinctNames(tokens);
    if (tokens.every((t) => t.length <= 40) && distinct.length <= MAX_SELECT_OPTIONS && distinct.length < tokens.length) return col('multi_select', ordered(distinct));
  }
  const distinct = distinctNames(vals);
  if (short && distinct.length <= MAX_SELECT_OPTIONS && distinct.length < vals.length) return col('select', ordered(distinct));
  return col('text');
}

/** First-seen names, case-insensitively unique (option matching ignores case). */
function distinctNames(names: string[]) {
  const seen = new Map<string, string>();
  for (const n of names) if (!seen.has(n.toLowerCase())) seen.set(n.toLowerCase(), n);
  return [...seen.values()];
}

function ordered(names: string[]) {
  for (const order of NATURAL_ORDERS) {
    if (names.every((n) => order.includes(n.toLowerCase()))) return [...names].sort((a, b) => order.indexOf(a.toLowerCase()) - order.indexOf(b.toLowerCase()));
  }
  return names;
}
