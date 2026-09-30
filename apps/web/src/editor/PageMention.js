import { mergeAttributes, Node } from '@tiptap/core';
import { titleOf } from './PageBlock.js';

/**
 * Inline link to a page: `{ type: 'pageMention', attrs: { pageId } }`, stored as
 * `{ type: 'page', props: { pageId } }`. Shows the page's live icon and title
 * (renames follow); click opens it. Inserted from `[[` or the `@` menu.
 *
 * `watchPage` / `openPage` come from the page block's options (the same page
 * cache); `searchPages` / `recentPages` feed the menus. All optional, so the
 * node works headless.
 * @typedef {{ id: string, title: string, titleContent: import('@papier/core').InlineContent | null, icon: string | null }} PageHit
 * @typedef {{
 *   watchPage: import('./PageBlock.js').PageBlockOptions['watchPage'],
 *   openPage: ((pageId: string) => void) | null,
 *   searchPages: ((query: string) => Promise<PageHit[]>) | null,
 *   recentPages: (() => PageHit[]) | null,
 * }} PageMentionOptions
 */

const PAGE_ICON =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>';

const DATABASE_ICON =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M9.5 9.5v10"/></svg>';

export const PageMention = Node.create({
  name: 'pageMention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  /** @returns {PageMentionOptions} */
  addOptions: () => ({ watchPage: null, openPage: null, searchPages: null, recentPages: null }),

  addAttributes: () => ({
    pageId: {
      default: '',
      parseHTML: (/** @type {HTMLElement} */ el) => el.getAttribute('data-page-id') ?? '',
      renderHTML: (/** @type {Record<string, any>} */ a) => ({ 'data-page-id': a.pageId }),
    },
  }),

  parseHTML: () => [{ tag: 'a.papier-page-link[data-page-id]' }],

  renderHTML: ({ HTMLAttributes }) => ['a', mergeAttributes({ class: 'papier-page-link' }, HTMLAttributes), 'Page'],

  renderText: () => '',

  addNodeView() {
    const { watchPage, openPage } = /** @type {PageMentionOptions} */ (this.options);
    return ({ node }) => {
      const dom = document.createElement('a');
      dom.className = 'papier-page-link';
      dom.contentEditable = 'false';
      const icon = document.createElement('span');
      icon.className = 'papier-page-link-icon';
      const label = document.createElement('span');
      label.className = 'papier-page-link-title';
      dom.append(icon, label);

      /** @type {string | null} */ let watching = null;
      let unwatch = () => {};
      /** @param {import('./PageBlock.js').PageInfo | undefined} page */
      const drawPage = (page) => {
        label.textContent = page === undefined ? '…' : page === null ? 'Deleted page' : titleOf(page) || 'Untitled';
        dom.classList.toggle('is-missing', page === null);
        if (page?.icon) icon.textContent = page.icon;
        else icon.innerHTML = page?.kind === 'database' ? DATABASE_ICON : PAGE_ICON;
      };
      /** @param {import('@tiptap/pm/model').Node} n */
      const draw = (n) => {
        dom.dataset.pageId = n.attrs.pageId;
        if (n.attrs.pageId === watching) return;
        unwatch();
        watching = n.attrs.pageId;
        drawPage(watchPage ? undefined : { title: '', titleContent: null });
        if (watchPage && watching) unwatch = watchPage(watching, drawPage);
      };
      draw(node);

      dom.addEventListener('click', (e) => {
        if (e.button !== 0 || !watching || !openPage) return;
        e.preventDefault();
        openPage(watching);
      });

      return {
        dom,
        update: (n) => {
          if (n.type.name !== 'pageMention') return false;
          draw(n);
          return true;
        },
        ignoreMutation: () => true,
        destroy: () => unwatch(),
      };
    };
  },
});

/** The page-link options of an editor (null when it has none, e.g. titles). @param {import('@tiptap/core').Editor} editor */
export const pageMentionOptions = (editor) =>
  /** @type {PageMentionOptions | undefined} */ (editor.extensionManager.extensions.find((e) => e.name === 'pageMention')?.options) ?? null;
