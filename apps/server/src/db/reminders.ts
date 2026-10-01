import { eq, lte } from 'drizzle-orm';
import type { Db } from './index.ts';
import { pages, reminders } from './schema.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Writer = Db | Tx;

type InlineNode = { type: string; props?: Record<string, unknown> };

/**
 * Re-index the @remind nodes in a batch of blocks. Called inside the blocks
 * batch transaction so reminders stay in sync with block edits.
 */
export function indexReminders(db: Writer, pageId: string, upserts: { id: string; content: unknown[] }[]) {
  for (const block of upserts) {
    db.delete(reminders).where(eq(reminders.blockId, block.id)).run();
    const nodes = (block.content as InlineNode[]).filter((n) => n.type === 'remind');
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      const date = String(node.props?.date ?? '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      db.insert(reminders).values({ id: `${block.id}:${i}`, pageId, blockId: block.id, date }).run();
    }
  }
}

/** Reminders due on or before `upToDate` (YYYY-MM-DD), with their page's title and icon. */
export function listReminders(db: Db, upToDate: string) {
  return db
    .select({
      id: reminders.id,
      pageId: reminders.pageId,
      blockId: reminders.blockId,
      date: reminders.date,
      note: reminders.note,
      pageTitle: pages.title,
      pageIcon: pages.icon,
    })
    .from(reminders)
    .leftJoin(pages, eq(reminders.pageId, pages.id))
    .where(lte(reminders.date, upToDate))
    .all();
}
