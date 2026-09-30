import { sql } from 'drizzle-orm';
import type { Db } from './index.ts';

export type Crumb = { id: string; title: string; icon: string | null };
type Row = Crumb & { archived_at: number | null; depth: number };

/**
 * A page and its ancestors, root first — or null when the page is missing or it
 * (or any ancestor) is in the trash.
 */
export function liveLineage(db: Db, pageId: string): Crumb[] | null {
  const rows = db.all<Row>(sql`
    with recursive lineage(id, parent_id, title, icon, archived_at, depth) as (
      select id, parent_id, title, icon, archived_at, 0 from pages where id = ${pageId}
      union all
      select p.id, p.parent_id, p.title, p.icon, p.archived_at, l.depth + 1
      from pages p join lineage l on p.id = l.parent_id
    )
    select id, title, icon, archived_at, depth from lineage order by depth desc
  `);
  if (rows.length === 0 || rows.some((p) => p.archived_at !== null)) return null;
  return rows.map(({ id, title, icon }) => ({ id, title, icon }));
}
