import { createReactInlineContentSpec } from '@blocknote/react';
import { dateSuggestions, formatDateMention } from './dates.js';

/**
 * Inline date, inserted from the `@` menu. Stored as
 * `{ type: 'date', props: { date: 'YYYY-MM-DD' } }` in a block's content.
 */
export const DateMention = createReactInlineContentSpec(
  {
    type: 'date',
    propSchema: { date: { default: '' } },
    content: 'none',
  },
  {
    render: ({ inlineContent }) => (
      <time className="papier-date" dateTime={inlineContent.props.date}>
        <span aria-hidden="true">@</span>
        {formatDateMention(inlineContent.props.date)}
      </time>
    ),
  },
);

/**
 * `@` menu items for the typed query.
 * @param {{ insertInlineContent: (content: any[]) => void }} editor
 * @param {string} query
 */
export async function getDateMenuItems(editor, query) {
  return dateSuggestions(query).map(({ title, date, subtext }) => ({
    title,
    subtext,
    group: 'Date',
    onItemClick: () => editor.insertInlineContent([{ type: 'date', props: { date } }, ' ']),
  }));
}
