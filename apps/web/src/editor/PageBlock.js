import { mergeAttributes, Node } from '@tiptap/core';
import { formatDateMention } from './dates.js';

/**
 * A sub-page (or a link to another page) inside the content:
 * `{ type: 'pageBlock', attrs: { id, indent, pageId } }`. Shows the page's live
 * title; click opens it. Deleting the block trashes the sub-page and undo
 * restores it — the server keeps that invariant (see apps/server/src/db/pageTree.ts).
 *
 * The page data comes from outside the editor through options, so the node
 * works headless (tests) too.
 */

/** @typedef {{ title: string, titleContent: import('@papier/core').InlineContent | null, kind?: string } | null} PageInfo  null = deleted / missing */
/**
 * @typedef {{
 *   watchPage: ((pageId: string, onChange: (page: PageInfo | undefined) => void) => () => void) | null,
 *   openPage: ((pageId: string) => void) | null,
 *   createPage: ((kind?: 'page' | 'database', title?: string) => Promise<string>) | null,
 *   saveContent?: ((pageId: string, rows: import('@papier/core').Block[]) => Promise<unknown>) | null,
 * }} PageBlockOptions
 */

/** Plain title text, dates shown the way the rest of the app shows them. @param {NonNullable<PageInfo>} page */
function titleOf(page) {
  if (!page.titleContent?.length) return page.title;
  return page.titleContent
    .map((n) => (n.type === 'date' ? formatDateMention(String(/** @type {any} */ (n.props)?.date ?? '')) : typeof n.text === 'string' ? n.text : ''))
    .join('');
}

const PAGE_ICON =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>';

const DATABASE_ICON =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M9.5 9.5v10"/></svg>';

export const PageBlock = Node.create({
  name: 'pageBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  /** @returns {PageBlockOptions} */
  addOptions: () => ({ watchPage: null, openPage: null, createPage: null }),

  addAttributes: () => ({
    id: {
      default: null,
      keepOnSplit: false,
      parseHTML: (/** @type {HTMLElement} */ el) => el.getAttribute('data-id'),
      renderHTML: (/** @type {Record<string, any>} */ a) => (a.id ? { 'data-id': a.id } : {}),
    },
    indent: {
      default: 0,
      parseHTML: (/** @type {HTMLElement} */ el) => Number(el.getAttribute('data-indent')) || 0,
      renderHTML: (/** @type {Record<string, any>} */ a) => ({ 'data-indent': a.indent, style: `--indent:${a.indent}` }),
    },
    pageId: {
      default: null,
      parseHTML: (/** @type {HTMLElement} */ el) => el.getAttribute('data-page-id'),
      renderHTML: (/** @type {Record<string, any>} */ a) => (a.pageId ? { 'data-page-id': a.pageId } : {}),
    },
  }),

  parseHTML: () => [{ tag: 'div.pb[data-type="pageBlock"]' }],

  renderHTML: ({ HTMLAttributes }) => [
    'div',
    mergeAttributes({ class: 'pb', 'data-type': 'pageBlock' }, HTMLAttributes),
    ['div', { class: 'pb-c pb-page' }, 'Page'],
  ],

  renderText: () => '',

  addNodeView() {
    const { watchPage, openPage } = /** @type {PageBlockOptions} */ (this.options);
    return ({ node }) => {
      const dom = document.createElement('div');
      dom.className = 'pb';
      dom.dataset.type = 'pageBlock';
      const inner = document.createElement('div');
      inner.className = 'pb-c pb-page';
      inner.contentEditable = 'false';
      inner.innerHTML = PAGE_ICON;
      let isDatabase = false;
      const label = document.createElement('span');
      label.className = 'pb-page-title';
      inner.append(label);
      dom.append(inner);

      /** @type {string | null} */ let watching = null;
      let unwatch = () => {};
      /** @param {PageInfo | undefined} page */
      const drawTitle = (page) => {
        const text = page === undefined ? '' : page === null ? 'Deleted page' : titleOf(page) || 'Untitled';
        label.textContent = text;
        label.classList.toggle('is-muted', !page || !titleOf(page));
        // A full-page database shows a table icon.
        if (Boolean(page?.kind === 'database') !== isDatabase) {
          isDatabase = !isDatabase;
          /** @type {Element} */ (inner.firstElementChild).outerHTML = isDatabase ? DATABASE_ICON : PAGE_ICON;
        }
      };

      /** @param {import('@tiptap/pm/model').Node} n */
      const draw = (n) => {
        dom.dataset.id = n.attrs.id ?? '';
        dom.dataset.indent = String(n.attrs.indent);
        dom.dataset.pageId = n.attrs.pageId ?? '';
        dom.style.setProperty('--indent', String(n.attrs.indent));
        if (n.attrs.pageId === watching) return;
        unwatch();
        watching = n.attrs.pageId;
        drawTitle(watchPage ? undefined : { title: '', titleContent: null });
        if (watchPage && watching) unwatch = watchPage(watching, drawTitle);
      };
      draw(node);

      // Opening happens on click, not mousedown: mousedown still selects the
      // block (and starts drags from the handle) as for any other atom.
      inner.addEventListener('click', (e) => {
        if (e.button !== 0 || !watching || !openPage) return;
        e.preventDefault();
        openPage(watching);
      });

      return {
        dom,
        update: (n) => {
          if (n.type.name !== 'pageBlock') return false;
          draw(n);
          return true;
        },
        ignoreMutation: () => true,
        destroy: () => unwatch(),
      };
    };
  },
});
