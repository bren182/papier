import { sql } from 'drizzle-orm';
import type { Db } from './index.ts';

export type Crumb = { id: string; title: string; titleContent: unknown[] | null; icon: string | null };
type Row = Omit<Crumb, 'titleContent'> & { title_content: string | null; archived_at: number | null; depth: number };

/**
 * A page and its ancestors, root first — or null when the page is missing or it
 * (or any ancestor) is in the trash.
 */
export function liveLineage(db: Db, pageId: string): Crumb[] | null {
  const rows = db.all<Row>(sql`
    with recursive lineage(id, parent_id, title, title_content, icon, archived_at, depth) as (
      select id, parent_id, title, title_content, icon, archived_at, 0 from pages where id = ${pageId}
      union all
      select p.id, p.parent_id, p.title, p.title_content, p.icon, p.archived_at, l.depth + 1
      from pages p join lineage l on p.id = l.parent_id
    )
    select id, title, title_content, icon, archived_at, depth from lineage order by depth desc
  `);
  if (rows.length === 0 || rows.some((p) => p.archived_at !== null)) return null;
  return rows.map(({ id, title, title_content, icon }) => ({
    id,
    title,
    titleContent: title_content === null ? null : (JSON.parse(title_content) as unknown[]),
    icon,
  }));
}
