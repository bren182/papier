import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.ts';
import { parseCsv } from './csv.ts';
import { inferColumn } from './database.ts';
import { parseNotionDate } from './dates.ts';
import { importNotion, titleContent } from './importer.ts';
import { parseInline } from './inline.ts';
import { parseBody } from './markdown.ts';
import type { ExportSource } from './tree.ts';

// Synthetic fixtures only — never the user's export.

const t = (text: string, styles = {}) => ({ type: 'text', text, styles });

describe('csv', () => {
  it('reads quoted commas, quotes, newlines and a BOM', () => {
    expect(parseCsv('﻿Name,Note\r\nA,"x, ""y""\nz"\r\nB,\r\n\r\n')).toEqual([
      ['Name', 'Note'],
      ['A', 'x, "y"\nz'],
      ['B', ''],
    ]);
  });
});

describe('dates', () => {
  it('parses Notion date text', () => {
    expect(parseNotionDate('June 20, 1995')).toBe('1995-06-20');
    expect(parseNotionDate('June 20, 2026 6:00 (GMT+2)')).toBe('2026-06-20');
    expect(parseNotionDate('March 3, 2026 9:30 AM → March 4, 2026')).toBe('2026-03-03');
    expect(parseNotionDate('2025-09-11')).toBe('2025-09-11');
    expect(parseNotionDate('February 30, 2026')).toBeNull();
    expect(parseNotionDate('soon')).toBeNull();
  });
});

describe('inline', () => {
  it('parses marks, links and date mentions', () => {
    expect(parseInline('a **b** *i* ~~s~~ `c` [site](https://x.io) @April 1, 2026 end')).toEqual([
      t('a '),
      t('b', { bold: true }),
      t(' '),
      t('i', { italic: true }),
      t(' '),
      t('s', { strike: true }),
      t(' '),
      t('c', { code: true }),
      t(' '),
      { type: 'link', href: 'https://x.io', content: [t('site')] },
      t(' '),
      { type: 'date', props: { date: '2026-04-01' } },
      t(' end'),
    ]);
  });

  it('leaves lone delimiters, snake_case and local links as text', () => {
    expect(parseInline('2 * 3 and snake_case_name')).toEqual([t('2 * 3 and snake_case_name')]);
    expect(parseInline('see [Notes](Notes%20abc.md)')).toEqual([t('see Notes')]);
    expect(parseInline('**open')).toEqual([t('**open')]);
  });
});

describe('markdown', () => {
  it('turns a body into flat blocks with indents', () => {
    const md = [
      '## Plan',
      '',
      '- one',
      '    - nested **bold**',
      '        1. deep',
      '- [x] done',
      '- [ ] todo \\',
      'more',
      '',
      'para line',
      'second line',
      '',
      '> quoted',
      '',
      '---',
      '',
      '```jsx',
      'const a = 1;',
      '```',
      '',
      '[Child](Page/Child%20abc.md)',
    ].join('\n');
    const blocks = parseBody(md).map(({ type, indent, props, content, link }) => ({ type, indent, props, text: content.map((n) => (n.type === 'text' ? n.text : '')).join(''), link }));
    expect(blocks).toEqual([
      { type: 'heading', indent: 0, props: { level: 2 }, text: 'Plan', link: undefined },
      { type: 'bulleted_list', indent: 0, props: {}, text: 'one', link: undefined },
      { type: 'bulleted_list', indent: 1, props: {}, text: 'nested bold', link: undefined },
      { type: 'numbered_list', indent: 2, props: {}, text: 'deep', link: undefined },
      { type: 'todo', indent: 0, props: { checked: true }, text: 'done', link: undefined },
      { type: 'todo', indent: 0, props: {}, text: 'todo\nmore', link: undefined },
      { type: 'paragraph', indent: 0, props: {}, text: 'para line\nsecond line', link: undefined },
      { type: 'quote', indent: 0, props: {}, text: 'quoted', link: undefined },
      { type: 'divider', indent: 0, props: {}, text: '', link: undefined },
      { type: 'code', indent: 0, props: { language: 'jsx' }, text: 'const a = 1;', link: undefined },
      { type: 'page', indent: 0, props: {}, text: '', link: 'Page/Child%20abc.md' },
    ]);
  });

  it('clamps indents to one deeper than the previous block', () => {
    expect(parseBody('            - too deep\n- top').map((b) => b.indent)).toEqual([0, 0]);
    expect(parseBody('- a\n            - b').map((b) => b.indent)).toEqual([0, 1]);
  });
});

describe('titles', () => {
  it('keeps date mentions and resolves relative ones from the row date', () => {
    expect(titleContent('@April 1, 2026 Standup', null)).toEqual([{ type: 'date', props: { date: '2026-04-01' } }, t(' Standup')]);
    expect(titleContent('@Last Monday', '2026-09-21')).toEqual([{ type: 'date', props: { date: '2026-09-21' } }]);
    expect(titleContent('@Today', null)).toBeNull();
    expect(titleContent('Plain **title**', null)).toBeNull();
  });
});

describe('column types', () => {
  it('infers types from values', () => {
    expect(inferColumn('D', ['June 20, 1995', '', 'May 1, 2020 6:00 (GMT+2)']).type).toBe('date');
    expect(inferColumn('N', ['1', '2.5', '']).type).toBe('number');
    expect(inferColumn('C', ['Yes', 'No']).type).toBe('checkbox');
    expect(inferColumn('U', ['https://a.io']).type).toBe('url');
    expect(inferColumn('S', ['Done', 'Not started', 'Done', 'In progress'])).toEqual({ name: 'S', type: 'select', options: ['Not started', 'In progress', 'Done'] });
    expect(inferColumn('M', ['red, blue', 'red'])).toEqual({ name: 'M', type: 'multi_select', options: ['red', 'blue'] });
    expect(inferColumn('T', ['alpha', 'beta']).type).toBe('text');
    expect(inferColumn('E', ['', '']).type).toBe('text');
  });
});

// ---------------------------------------------------------------------------

let app: ReturnType<typeof buildApp>;
beforeEach(() => {
  app = buildApp({ logger: false });
});
afterEach(async () => {
  await app.close();
});

const ID = (n: number) => n.toString(16).padStart(32, '0');

/** A tiny export: Work (a page) holding Meetings (a database) and Ideas (moved to the root), and People. */
function fixture(): ExportSource {
  const files: Record<string, string> = {
    [`Export-x/Work ${ID(1)}.md`]: `# Work\n\n[Meetings](Work/Meetings%20${ID(2)}.md)\n\nIntro text\n\n[Ideas](Work/Ideas%20${ID(3)}.md)\n`,
    [`Export-x/Work/Meetings ${ID(2)}.md`]: `# Meetings\n\n[Meetings](Meetings%20${ID(2)}_all.csv)\n\nsort: \nDate: descending\n`,
    [`Export-x/Work/Meetings ${ID(2)}_all.csv`]: '﻿Title,Date,Type\n"@April 1, 2026 Standup","April 1, 2026",Standup\n"@April 2, 2026 ","April 2, 2026",Standup\nNo page,"April 3, 2026",Demo\n',
    [`Export-x/Work/Meetings/@April 1, 2026 Standup ${ID(4)}.md`]: '# @April 1, 2026 Standup\n\nDate: April 1, 2026\nType: Standup\n\n- Alex: shipped zebra\n    - next: tests\n',
    [`Export-x/Work/Meetings/@Last Thursday ${ID(5)}.md`]: '# @Last Thursday\n\nDate: April 2, 2026\nType: Standup\n\nMe: notes\n',
    [`Export-x/Work/Ideas ${ID(3)}.md`]: '# Ideas\n\nA page moved to the root.\n',
    [`Export-x/People ${ID(6)}.md`]: `# People\n\n[People](People%20${ID(6)}_all.csv)\n\nsort: \nNext: ascending\n`,
    [`Export-x/People ${ID(6)}_all.csv`]: 'Name,Born\nAnn,"March 5, 1990"\nBob,"December 1, 1985"\n',
    [`Export-x/People/Ann ${ID(7)}.md`]: '# Ann\n\nBorn: March 5, 1990\nNext: March 5, 2027\n',
    [`Export-x/People/Bob ${ID(8)}.md`]: '# Bob\n\nBorn: December 1, 1985\nNext: December 1, 2026\n\n- gin\n',
  };
  return { files: () => Object.keys(files), read: (p) => files[p]! };
}

const get = async <T>(url: string, method: 'GET' | 'POST' = 'GET', payload?: object) => (await app.inject({ method, url, payload })).json() as T;
type Blk = { type: string; parentId: string | null; props: Record<string, unknown>; content: { text?: string }[] };
const blocksOf = (id: string) => get<Blk[]>(`/api/pages/${id}/blocks`);

describe('importNotion', () => {
  it('imports pages, databases, rows, values, sorts and content', async () => {
    const report = await importNotion(app, fixture(), { include: ['Work', 'Work/Ideas', 'People'] });
    expect(report.roots.map((r) => r.path)).toEqual(['Work', 'Work/Ideas', 'People']);
    expect(report.counts).toMatchObject({ pages: 2, databases: 2, rows: 5 });
    expect(report.warnings).toEqual(expect.arrayContaining(['People: dropped computed properties Next', 'Meetings: 1 rows only in the CSV (no page content)']));

    // Roots in the sidebar; Ideas is a root, and Work keeps a link to it.
    const root = await get<{ id: string; title: string }[]>('/api/pages');
    expect(root.map((p) => p.title).sort()).toEqual(['Ideas', 'People', 'Work']);
    const [work, ideas, people] = report.roots.map((r) => r.id);
    const workBlocks = await blocksOf(work!);
    expect(workBlocks.map((b) => b.type)).toEqual(['page', 'paragraph', 'page']);
    expect(workBlocks[2]!.props.pageId).toBe(ideas);

    // Meetings: types, values, relative title resolved, sort kept.
    const meetingsId = workBlocks[0]!.props.pageId as string;
    const schema = await get<{ properties: { id: string; name: string; type: string }[]; views: { id: string; config: { sorts: unknown[] } }[] }>(`/api/databases/${meetingsId}`);
    expect(schema.properties.map((p) => [p.name, p.type])).toEqual([['Date', 'date'], ['Type', 'select']]);
    const date = schema.properties[0]!.id;
    expect(schema.views[0]!.config.sorts).toEqual([{ propId: date, dir: 'desc' }]);
    const rows = await get<{ rows: { id: string; title: string; titleContent: unknown[] | null; props: Record<string, unknown> }[] }>(`/api/databases/${meetingsId}/query`, 'POST', { viewId: schema.views[0]!.id });
    expect(rows.rows.map((r) => r.props[date])).toEqual(['2026-04-03', '2026-04-02', '2026-04-01']);
    expect(rows.rows[1]!.titleContent).toEqual([{ type: 'date', props: { date: '2026-04-02' } }]);
    const standup = rows.rows[2]!;
    expect(standup.titleContent).toEqual([{ type: 'date', props: { date: '2026-04-01' } }, t(' Standup')]);
    const notes = await blocksOf(standup.id);
    const top = notes.find((b) => b.parentId === null)!;
    expect(notes.map((b) => b.type)).toEqual(['bulleted_list', 'bulleted_list']);
    expect(notes.find((b) => b !== top)!.parentId).toBe((top as Blk & { id: string }).id);

    // People: the "next birthday" formula sort becomes an upcoming sort on the date.
    const pSchema = await get<{ properties: { id: string }[]; views: { config: { sorts: unknown[] } }[] }>(`/api/databases/${people}`);
    expect(pSchema.views[0]!.config.sorts).toEqual([{ propId: pSchema.properties[0]!.id, dir: 'upcoming' }]);

    // Content is searchable.
    const hits = await get<{ items: { page: { id: string } }[] }>('/api/search?q=zebra');
    expect(hits.items.map((h) => h.page.id)).toEqual([standup.id]);
  });

  it('refuses paths that are not in the export', async () => {
    await expect(importNotion(app, fixture(), { include: ['Nope'] })).rejects.toThrow('Not in the export');
  });
});
