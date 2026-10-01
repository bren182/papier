import { mergeAttributes, Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';

/**
 * An image (or GIF) block: `{ type: 'imageBlock', attrs: { id, indent, src, caption, align, animation } }`.
 * Stores `src` as a URL (Giphy CDN, pasted URL, or a future upload path). The
 * `animation` prop is reserved for slidedeck timing (e.g. { delay, duration }).
 *
 * The node view is a React component so the URL and caption inputs are reactive.
 */

/**
 * @typedef {{ src?: string, caption?: string, align?: 'left'|'center'|'right', animation?: unknown }} ImageProps
 * @typedef {{ onSearch?: ((query: string) => Promise<{ url: string, preview: string }[]>) | null }} ImageBlockOptions
 */

export const ImageBlock = Node.create({
  name: 'imageBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  /** @returns {ImageBlockOptions} */
  addOptions: () => ({ onSearch: null }),

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
    src: {
      default: '',
      parseHTML: (/** @type {HTMLElement} */ el) => el.getAttribute('data-src') || '',
      renderHTML: (/** @type {Record<string, any>} */ a) => (a.src ? { 'data-src': a.src } : {}),
    },
    caption: {
      default: '',
      parseHTML: (/** @type {HTMLElement} */ el) => el.getAttribute('data-caption') || '',
      renderHTML: (/** @type {Record<string, any>} */ a) => (a.caption ? { 'data-caption': a.caption } : {}),
    },
    align: {
      default: 'center',
      parseHTML: (/** @type {HTMLElement} */ el) => el.getAttribute('data-align') || 'center',
      renderHTML: (/** @type {Record<string, any>} */ a) => ({ 'data-align': a.align }),
    },
    animation: {
      default: null,
      parseHTML: () => null,
      renderHTML: () => ({}),
    },
  }),

  parseHTML: () => [{ tag: 'div.pb[data-type="imageBlock"]' }],

  renderHTML: ({ HTMLAttributes }) => [
    'div',
    mergeAttributes({ class: 'pb', 'data-type': 'imageBlock' }, HTMLAttributes),
    ['div', { class: 'pb-c' }],
  ],

  addNodeView() {
    return ReactNodeViewRenderer(ImageBlockView);
  },
});

// ── React node view ────────────────────────────────────────────────────────────
// Loaded lazily with the rest of the editor chunk; no top-level import of React
// needed here because ReactNodeViewRenderer wraps it.

import { useCallback, useEffect, useRef, useState } from 'react';
import { NodeViewWrapper } from '@tiptap/react';

/**
 * @param {{ node: import('@tiptap/pm/model').Node, updateAttributes: (attrs: Record<string,any>) => void,
 *   editor: import('@tiptap/core').Editor, selected: boolean }} props
 */
function ImageBlockView({ node, updateAttributes, editor, selected }) {
  const { src, caption, align } = node.attrs;
  const [editing, setEditing] = useState(!src);
  const [urlDraft, setUrlDraft] = useState(src || '');
  const [capDraft, setCapDraft] = useState(caption || '');
  const [searching, setSearching] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [results, setResults] = useState(/** @type {{ url: string, preview: string }[]} */ ([]));
  const [loadErr, setLoadErr] = useState(false);
  const urlRef = useRef(/** @type {HTMLInputElement|null} */ (null));
  const options = /** @type {import('./ImageBlock.js').ImageBlockOptions} */ (
    editor.extensionManager.extensions.find((e) => e.name === 'imageBlock')?.options ?? {}
  );

  useEffect(() => {
    if (editing) setTimeout(() => urlRef.current?.focus(), 0);
  }, [editing]);

  const commit = useCallback(() => {
    const s = urlDraft.trim();
    if (!s) return;
    updateAttributes({ src: s, caption: capDraft.trim() });
    setEditing(false);
  }, [urlDraft, capDraft, updateAttributes]);

  const doSearch = useCallback(async () => {
    if (!options.onSearch) return;
    setResults([]);
    const hits = await options.onSearch(searchQ).catch(() => []);
    setResults(hits);
  }, [options, searchQ]);

  const pickResult = useCallback((/** @type {string} */ url) => {
    updateAttributes({ src: url, caption: capDraft.trim() });
    setEditing(false);
    setSearching(false);
  }, [capDraft, updateAttributes]);

  const ALIGNS = /** @type {const} */ (['left', 'center', 'right']);
  const alignClass = align === 'left' ? 'mr-auto' : align === 'right' ? 'ml-auto' : 'mx-auto';

  const wrapperClass = `pb flex flex-col gap-1 py-1 ${selected ? 'ring-1 ring-accent/40 rounded' : ''}`;

  if (editing) {
    return (
      <NodeViewWrapper className={wrapperClass} data-type="imageBlock" data-indent={node.attrs.indent} style={{ '--indent': node.attrs.indent }}>
        <div className="rounded-lg border border-line bg-s-sidebar p-3 flex flex-col gap-2" contentEditable={false}>
          <p className="text-[12px] text-muted font-medium">Add an image</p>
          <input
            ref={urlRef}
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') setEditing(false); }}
            placeholder="Paste an image URL or .gif URL…"
            className="h-8 rounded-md border border-line bg-transparent px-2 text-[13px] text-fg placeholder:text-faint focus:outline-none focus:ring-1 focus:ring-accent/50"
          />
          {options.onSearch && (
            <div className="flex flex-col gap-1.5">
              <div className="flex gap-1.5">
                <input
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setSearching(true); doSearch(); } }}
                  placeholder="Search GIFs…"
                  className="h-8 flex-1 rounded-md border border-line bg-transparent px-2 text-[13px] text-fg placeholder:text-faint focus:outline-none focus:ring-1 focus:ring-accent/50"
                />
                <button type="button" onClick={() => { setSearching(true); doSearch(); }}
                  className="h-8 rounded-md border border-line px-3 text-[13px] text-muted hover:text-fg hover:bg-hover">
                  Search
                </button>
              </div>
              {searching && results.length === 0 && <p className="text-[12px] text-faint">No results.</p>}
              {results.length > 0 && (
                <div className="grid grid-cols-4 gap-1 max-h-48 overflow-y-auto rounded-md">
                  {results.map((r, i) => (
                    <button key={i} type="button" onClick={() => pickResult(r.url)}
                      className="overflow-hidden rounded border border-line hover:border-accent/50">
                      <img src={r.preview} alt="" className="h-16 w-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={commit} disabled={!urlDraft.trim()}
              className="h-7 rounded-md bg-accent/20 px-3 text-[13px] font-medium text-accent hover:bg-accent/30 disabled:opacity-40">
              Add
            </button>
            {src && (
              <button type="button" onClick={() => setEditing(false)}
                className="h-7 rounded-md border border-line px-3 text-[13px] text-muted hover:text-fg hover:bg-hover">
                Cancel
              </button>
            )}
          </div>
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className={wrapperClass} data-type="imageBlock" data-indent={node.attrs.indent} style={{ '--indent': node.attrs.indent }}>
      <div className={`flex flex-col gap-1 ${alignClass}`} style={{ maxWidth: '100%' }} contentEditable={false}>
        {loadErr ? (
          <div className="flex h-20 items-center justify-center rounded-lg border border-line text-[13px] text-muted">
            Couldn't load image.{' '}
            <button type="button" className="ml-1 text-accent hover:underline" onClick={() => { setLoadErr(false); setEditing(true); }}>
              Edit
            </button>
          </div>
        ) : (
          <img
            src={src}
            alt={caption || ''}
            onError={() => setLoadErr(true)}
            className="max-w-full rounded-lg"
            style={{ display: 'block' }}
          />
        )}
        {/* Caption + controls row */}
        <div className="flex items-center gap-1">
          <input
            value={capDraft}
            onChange={(e) => setCapDraft(e.target.value)}
            onBlur={() => { if (capDraft !== caption) updateAttributes({ caption: capDraft }); }}
            placeholder="Add a caption…"
            className="flex-1 bg-transparent text-[12px] text-muted placeholder:text-faint focus:outline-none"
          />
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {ALIGNS.map((a) => (
              <button key={a} type="button" onClick={() => updateAttributes({ align: a })}
                title={`Align ${a}`}
                className={`flex h-5 w-5 items-center justify-center rounded text-[10px] ${align === a ? 'bg-accent/20 text-accent' : 'text-faint hover:text-muted'}`}>
                {a === 'left' ? '⬅' : a === 'center' ? '⬛' : '➡'}
              </button>
            ))}
            <button type="button" onClick={() => { setEditing(true); setUrlDraft(src); }}
              className="ml-1 flex h-5 items-center rounded px-1 text-[10px] text-faint hover:text-muted">
              Edit
            </button>
          </div>
        </div>
      </div>
    </NodeViewWrapper>
  );
}
