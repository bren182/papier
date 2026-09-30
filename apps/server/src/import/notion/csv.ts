// A small RFC 4180 reader: quoted fields may hold commas, quotes ("") and newlines.

/** Parse CSV text into rows of fields (a leading BOM is dropped, trailing blank lines too). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  while (rows.length && rows[rows.length - 1]!.every((f) => f === '')) rows.pop();
  return rows;
}

/** CSV text → header + records keyed by column name. */
export function readCsv(text: string): { columns: string[]; records: Record<string, string>[] } {
  const [header = [], ...body] = parseCsv(text);
  const columns = header.map((h) => h.trim());
  return { columns, records: body.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i] ?? '']))) };
}
