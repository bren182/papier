import { mergeAttributes, Node } from '@tiptap/core';
import { formatDateLong, formatDateMention } from './dates.js';

/**
 * Inline date mention: `{ type: 'date', attrs: { date: 'YYYY-MM-DD' } }`.
 * Always rendered relative to today ("Today", "2 days ago"), so it stays true
 * as time passes; the exact date is in the tooltip.
 */
export const DateNode = Node.create({
  name: 'date',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes: () => ({
    date: {
      default: '',
      parseHTML: (/** @type {HTMLElement} */ el) => el.getAttribute('datetime') ?? '',
      renderHTML: (/** @type {Record<string, any>} */ a) => ({ datetime: a.date }),
    },
  }),

  parseHTML: () => [{ tag: 'time.papier-date[datetime]' }],

  renderHTML: ({ node, HTMLAttributes }) => [
    'time',
    mergeAttributes({ class: 'papier-date', title: formatDateLong(node.attrs.date) }, HTMLAttributes),
    `@${formatDateMention(node.attrs.date)}`,
  ],

  renderText: ({ node }) => `@${formatDateMention(node.attrs.date)}`,

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('time');
      dom.className = 'papier-date';
      dom.contentEditable = 'false';
      /** @param {import('@tiptap/pm/model').Node} n */
      const draw = (n) => {
        dom.dateTime = n.attrs.date;
        dom.title = formatDateLong(n.attrs.date);
        dom.replaceChildren(Object.assign(document.createElement('span'), { textContent: '@', className: 'papier-date-at' }), formatDateMention(n.attrs.date));
      };
      draw(node);
      return {
        dom,
        update: (n) => {
          if (n.type.name !== 'date') return false;
          draw(n);
          return true;
        },
      };
    };
  },
});
