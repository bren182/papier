import { mergeAttributes, Node } from '@tiptap/core';
import { formatDateLong, formatDateMention } from './dates.js';

/**
 * Inline reminder mention: `{ type: 'remind', attrs: { date: 'YYYY-MM-DD' } }`.
 * Stored as `{ type: 'remind', props: { date } }` in block content; rendered as
 * a bell + relative date chip, like a date node but visually distinct.
 */
export const RemindNode = Node.create({
  name: 'remind',
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

  parseHTML: () => [{ tag: 'time.papier-remind[datetime]' }],

  renderHTML: ({ node, HTMLAttributes }) => [
    'time',
    mergeAttributes({ class: 'papier-remind', title: formatDateLong(node.attrs.date) }, HTMLAttributes),
    `🔔 ${formatDateMention(node.attrs.date)}`,
  ],

  renderText: ({ node }) => `@remind ${formatDateMention(node.attrs.date)}`,

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('time');
      dom.className = 'papier-remind';
      dom.contentEditable = 'false';
      /** @param {import('@tiptap/pm/model').Node} n */
      const draw = (n) => {
        dom.dateTime = n.attrs.date;
        dom.title = formatDateLong(n.attrs.date);
        dom.replaceChildren(
          Object.assign(document.createElement('span'), { textContent: '🔔 ', className: 'papier-remind-bell' }),
          formatDateMention(n.attrs.date),
        );
      };
      draw(node);
      return {
        dom,
        update: (n) => {
          if (n.type.name !== 'remind') return false;
          draw(n);
          return true;
        },
      };
    };
  },
});
