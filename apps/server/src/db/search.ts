import { and, eq, sql } from 'drizzle-orm';
import { HIT_END, HIT_START, plainText, valueToText, type PropertyDef, type PropValue } from '@papier/core';
import type { Db } from './index.ts';
import { pageProps, searchRows } from './schema.ts';

/**
 * Full-text search. The only SQLite-specific module: `search_rows` holds plain
 * text per block (and per page title), `search_fts` (FTS5, see migration
 * 0004) indexes it via triggers. Deleting a block cascades to its row, so
 * only writes need calling in here.
 */

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Writer = Db | Tx;

/** Title rows outrank body rows by this factor (bm25 scores are negative: lower is better). */
const TITLE_WEIGHT = 3;
const BACKFILL_CHUNK = 1000;
/** Best-ranked rows considered per query; see searchPages. */
const CANDIDATES = 1000;

/** Index (or reindex) blocks' text after they were upserted. */
export function indexBlocks(db: Writer, pageId: string, upserts: { id: string; content: unknown[] }[]) {
  for (const b of upserts) {
    const text = plainText(b.content as Parameters<typeof plainText>[0]);
    db.insert(searchRows)
      .values({ pageId, blockId: b.id, text })
      .onConflictDoUpdate({ target: searchRows.blockId, set: { text } })
      .run();
  }
}

/** Index (or reindex) a page's plain title. */
export function indexTitle(db: Writer, pageId: string, title: string) {
  db.insert(searchRows)
    .values({ pageId, text: title })
    .onConflictDoUpdate({ target: searchRows.pageId, targetWhere: sql`block_id is null and prop_id is null`, set: { text: title } })
    .run();
}

/** Property types whose values are searchable (select types by option name). */
const SEARCHED_TYPES = new Set(['text', 'url', 'select', 'multi_select']);

/** Index (or unindex: null, or a type that isn't searched) one row value. */
export function indexValue(db: Writer, pageId: string, prop: PropertyDef, value: PropValue) {
  const text = SEARCHED_TYPES.has(prop.type) ? valueToText(prop, value) : '';
  if (!text) {
    db.delete(searchRows).where(and(eq(searchRows.pageId, pageId), eq(searchRows.propId, prop.id))).run();
    return;
  }
  db.insert(searchRows)
    .values({ pageId, propId: prop.id, text })
    .onConflictDoUpdate({ target: [searchRows.pageId, searchRows.propId], targetWhere: sql`prop_id is not null`, set: { text } })
    .run();
}

/** Rebuild a property's search rows (after its type or option names change). */
export function reindexProp(db: Writer, prop: PropertyDef) {
  db.delete(searchRows).where(eq(searchRows.propId, prop.id)).run();
  if (!SEARCHED_TYPES.has(prop.type)) return;
  for (const row of db.select({ pageId: pageProps.pageId, value: pageProps.value }).from(pageProps).where(eq(pageProps.propId, prop.id)).all()) {
    indexValue(db, row.pageId, prop, row.value as PropValue);
  }
}

/**
 * Index blocks that have no search row yet (a database from before search, or
 * rows written outside the API). One indexed pass when there's nothing to do.
 * @returns how many blocks and property values were indexed
 */
export function backfillSearch(db: Db) {
  let total = 0;
  for (;;) {
    const rows = db.all<{ id: string; page_id: string; content: string }>(sql`
      select b.id, b.page_id, b.content from blocks b
      where not exists (select 1 from search_rows s where s.block_id = b.id)
      limit ${BACKFILL_CHUNK}
    `);
    if (rows.length === 0) break;
    db.transaction((tx) => {
      for (const r of rows) indexBlocks(tx, r.page_id, [{ id: r.id, content: JSON.parse(r.content) }]);
    });
    total += rows.length;
  }
  return total + backfillValues(db);
}

/** Index searchable property values that have no search row yet (from before value search). */
function backfillValues(db: Db) {
  let total = 0;
  // A value can have no text (and so still no row afterwards): walk by rowid rather than re-asking.
  let after = 0;
  for (;;) {
    const rows = db.all<{ rid: number; page_id: string; value: string; id: string; name: string; type: string; config: string }>(sql`
      select v.rowid as rid, v.page_id, v.value, d.id, d.name, d.type, d.config from page_props v
      join db_properties d on d.id = v.prop_id
      where v.rowid > ${after}
        and d.type in (${sql.join([...SEARCHED_TYPES].map((t) => sql`${t}`), sql`, `)})
        and not exists (select 1 from search_rows s where s.page_id = v.page_id and s.prop_id = v.prop_id)
      order by v.rowid
      limit ${BACKFILL_CHUNK}
    `);
    if (rows.length === 0) return total;
    db.transaction((tx) => {
      for (const r of rows) {
        const prop = { id: r.id, name: r.name, type: r.type, config: JSON.parse(r.config) };
        indexValue(tx, r.page_id, prop, JSON.parse(r.value));
      }
    });
    total += rows.length;
    after = rows[rows.length - 1]!.rid;
  }
}

/**
 * User input → an FTS5 query that can't be read as FTS syntax: every
 * whitespace-separated word becomes a quoted prefix term, all required.
 * Null when there's nothing to search for.
 */
export function toFtsQuery(q: string): string | null {
  const terms = q
    .split(/\s+/)
    // Tokenizer separators alone ("-", "…") would make an empty phrase.
    .filter((t) => /[\p{L}\p{N}]/u.test(t))
    .slice(0, 16)
    .map((t) => `"${t.replaceAll('"', '""')}"*`);
  return terms.length ? terms.join(' ') : null;
}

export type SearchHit = {
  pageId: string;
  title: string;
  titleContent: unknown[] | null;
  icon: string | null;
  /** Null when the page's title (or a property value) was the best match. */
  blockId: string | null;
  /** The property whose value matched best (database rows), or null. */
  field: string | null;
  /** Plain text with HIT_START / HIT_END around matched terms. */
  snippet: string;
};

type HitRow = Omit<SearchHit, 'titleContent' | 'snippet'> & { rowid: number; titleContent: string | null };

/**
 * Pages matching `q`, best first, one hit per page (its best-matching block or
 * title). Trashed pages and everything under them are left out.
 *
 * Only the best CANDIDATES rows (by FTS rank) are grouped into pages, and
 * snippets are built only for the page of results returned: both are costly
 * per row, and a common word can match half the workspace. So a very deep
 * scroll through a huge result set ends early; a narrower query finds the rest.
 */
export function searchPages(db: Db, q: string, { limit, offset, workspaceId = null }: { limit: number; offset: number; workspaceId?: string | null }) {
  const match = toFtsQuery(q);
  if (!match) return { items: [] as SearchHit[], nextOffset: null };

  // One extra row tells whether there's a next page.
  const rows = db.all<HitRow>(sql`
    with recursive dead(id) as (
      select id from pages where archived_at is not null or is_template = 1
      union
      select p.id from pages p join dead d on p.parent_id = d.id
    ),
    top as (
      select rowid, rank from search_fts where search_fts match ${match} order by rank limit ${CANDIDATES}
    ),
    hits as (
      select s.id, s.page_id, s.block_id, s.prop_id,
        top.rank * (case when s.block_id is null and s.prop_id is null then ${TITLE_WEIGHT} else 1 end) as score
      from top join search_rows s on s.id = top.rowid
      where s.page_id not in (select id from dead)
    ),
    ranked as (
      select *, row_number() over (partition by page_id order by score) as n from hits
    )
    select r.id as rowid, r.page_id as pageId, r.block_id as blockId, d.name as field,
      p.title as title, p.title_content as titleContent, p.icon as icon
    from ranked r join pages p on p.id = r.page_id left join db_properties d on d.id = r.prop_id
    where r.n = 1 ${workspaceId ? sql`and p.workspace_id = ${workspaceId}` : sql``}
    order by r.score, p.id
    limit ${limit + 1} offset ${offset}
  `);

  const shown = rows.slice(0, limit);
  const snippets = new Map(
    shown.length
      ? db
          .all<{ rowid: number; snippet: string }>(sql`
            select rowid, snippet(search_fts, 0, ${HIT_START}, ${HIT_END}, '…', 12) as snippet
            from search_fts
            where search_fts match ${match} and rowid in (${sql.join(shown.map((r) => sql`${r.rowid}`), sql`, `)})
          `)
          .map((r) => [r.rowid, r.snippet])
      : [],
  );

  const items = shown.map(
    ({ rowid, titleContent, ...r }): SearchHit => ({
      ...r,
      titleContent: titleContent === null ? null : (JSON.parse(titleContent) as unknown[]),
      snippet: snippets.get(rowid) ?? '',
    }),
  );
  return { items, nextOffset: rows.length > limit ? offset + limit : null };
}
