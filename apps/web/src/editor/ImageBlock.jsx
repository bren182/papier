import { useCallback, useEffect, useRef, useState } from 'react';
import { mergeAttributes, Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';

/**
 * An image (or GIF) block: `{ type: 'imageBlock', attrs: { id, indent, src, caption, align, animation } }`.
 * Stores `src` as a URL (Giphy CDN, pasted URL, or an upload path like `/files/<uuid>.jpg`). The
 * `animation` prop is reserved for slidedeck timing (e.g. { delay, duration }).
 *
 * The node view is a React component so the URL and caption inputs are reactive.
 */

/**
 * @typedef {{ src?: string, caption?: string, align?: 'left'|'center'|'right', animation?: unknown }} ImageProps
 * @typedef {{
 *   onSearch?: ((query: string) => Promise<{ url: string, preview: string }[]>) | null,
 *   onUpload?: ((file: File) => Promise<string>) | null,
 * }} ImageBlockOptions
 */

export const ImageBlock = Node.create({
  name: 'imageBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  /** @returns {ImageBlockOptions} */
  addOptions: () => ({ onSearch: null, onUpload: null }),

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

/**
 * @param {{ node: import('@tiptap/pm/model').Node, updateAttributes: (attrs: Record<string,any>) => void,
 *   editor: import('@tiptap/core').Editor, selected: boolean }} props
 */
function ImageBlockView({ node, updateAttributes, editor, selected }) {
  const { src, caption, align } = node.attrs;
  const options = /** @type {ImageBlockOptions} */ (
    editor.extensionManager.extensions.find((e) => e.name === 'imageBlock')?.options ?? {}
  );

  // ── edit / display mode ──────────────────────────────────────────────────
  const [editing, setEditing] = useState(!src);

  // ── per-tab state ────────────────────────────────────────────────────────
  /** @type {'link'|'upload'|'gif'} */
  const defaultTab = 'link';
  const [tab, setTab] = useState(/** @type {'link'|'upload'|'gif'} */ (defaultTab));

  // link tab
  const [urlDraft, setUrlDraft] = useState(/** @type {string} */ (src || ''));
  const urlRef = useRef(/** @type {HTMLInputElement|null} */ (null));

  // upload tab
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef(/** @type {HTMLInputElement|null} */ (null));

  // gif tab
  const [searchQ, setSearchQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState(/** @type {{ url: string, preview: string }[]} */ ([]));

  // shared
  const [capDraft, setCapDraft] = useState(/** @type {string} */ (caption || ''));
  const [loadErr, setLoadErr] = useState(false);

  useEffect(() => {
    if (editing && tab === 'link') setTimeout(() => urlRef.current?.focus(), 0);
  }, [editing, tab]);

  // ── link tab handlers ────────────────────────────────────────────────────
  const commitUrl = useCallback(() => {
    const s = urlDraft.trim();
    if (!s) return;
    updateAttributes({ src: s, caption: capDraft.trim() });
    setEditing(false);
  }, [urlDraft, capDraft, updateAttributes]);

  // ── upload tab handlers ──────────────────────────────────────────────────
  const doUpload = useCallback(async (/** @type {File} */ file) => {
    if (!file.type.startsWith('image/')) { setUploadErr('Please upload an image file.'); return; }
    if (!options.onUpload) return;
    setUploading(true);
    setUploadErr('');
    try {
      const url = await options.onUpload(file);
      updateAttributes({ src: url, caption: capDraft.trim() });
      setEditing(false);
    } catch {
      setUploadErr('Upload failed — please try again.');
    } finally {
      setUploading(false);
    }
  }, [options, capDraft, updateAttributes]);

  const handleFilePick = useCallback((/** @type {React.ChangeEvent<HTMLInputElement>} */ e) => {
    const f = e.target.files?.[0];
    if (f) doUpload(f);
    e.target.value = '';
  }, [doUpload]);

  const handleDrop = useCallback((/** @type {React.DragEvent} */ e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) doUpload(f);
  }, [doUpload]);

  // ── gif tab handlers ─────────────────────────────────────────────────────
  const doSearch = useCallback(async () => {
    if (!options.onSearch) return;
    setResults([]);
    const hits = await options.onSearch(searchQ).catch(() => /** @type {{ url: string, preview: string }[]} */ ([]));
    setResults(hits);
  }, [options, searchQ]);

  const pickResult = useCallback((/** @type {string} */ url) => {
    updateAttributes({ src: url, caption: capDraft.trim() });
    setEditing(false);
    setSearching(false);
  }, [capDraft, updateAttributes]);

  // ── tabs config ──────────────────────────────────────────────────────────
  const tabs = /** @type {('link'|'upload'|'gif')[]} */ ([
    'link',
    ...(options.onUpload ? /** @type {const} */ (['upload']) : []),
    ...(options.onSearch ? /** @type {const} */ (['gif']) : []),
  ]);

  const TAB_LABEL = { link: 'Link', upload: 'Upload', gif: 'GIFs' };

  // ── alignment classes ────────────────────────────────────────────────────
  const ALIGNS = /** @type {const} */ (['left', 'center', 'right']);
  const alignClass = align === 'left' ? 'mr-auto' : align === 'right' ? 'ml-auto' : 'mx-auto';
  const wrapperClass = `pb flex flex-col gap-1 py-1 ${selected ? 'ring-1 ring-accent/40 rounded' : ''}`;

  // ── edit panel ────────────────────────────────────────────────────────────
  if (editing) {
    return (
      <NodeViewWrapper className={wrapperClass} data-type="imageBlock" data-indent={node.attrs.indent} style={{ '--indent': node.attrs.indent }}>
        <div className="rounded-lg border border-line bg-s-sidebar p-3 flex flex-col gap-2.5" contentEditable={false}>
          {/* tab bar */}
          {tabs.length > 1 && (
            <div className="flex gap-0.5 border-b border-line pb-2">
              {tabs.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`h-6 rounded px-2.5 text-[12px] font-medium transition-colors ${tab === t ? 'bg-accent/20 text-accent' : 'text-muted hover:text-fg hover:bg-hover'}`}
                >
                  {TAB_LABEL[t]}
                </button>
              ))}
            </div>
          )}

          {/* link tab */}
          {tab === 'link' && (
            <>
              <input
                ref={urlRef}
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitUrl(); }
                  if (e.key === 'Escape') setEditing(false);
                }}
                placeholder="Paste an image URL or .gif URL…"
                className="h-8 rounded-md border border-line bg-transparent px-2 text-[13px] text-fg placeholder:text-faint focus:outline-none focus:ring-1 focus:ring-accent/50"
              />
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={commitUrl}
                  disabled={!urlDraft.trim()}
                  className="h-7 rounded-md bg-accent/20 px-3 text-[13px] font-medium text-accent hover:bg-accent/30 disabled:opacity-40"
                >
                  Add
                </button>
                {src && (
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
                    className="h-7 rounded-md border border-line px-3 text-[13px] text-muted hover:text-fg hover:bg-hover"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </>
          )}

          {/* upload tab */}
          {tab === 'upload' && (
            <>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 transition-colors ${dragging ? 'border-accent/60 bg-accent/5' : 'border-line hover:border-muted'} ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
              >
                <span className="text-[28px]">🖼</span>
                <p className="text-[13px] text-muted">
                  {uploading ? 'Uploading…' : 'Drop an image here or'}
                </p>
                {!uploading && (
                  <label className="h-7 cursor-pointer rounded-md bg-accent/20 px-3 text-[13px] font-medium text-accent hover:bg-accent/30 flex items-center">
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleFilePick}
                    />
                    Choose file
                  </label>
                )}
              </div>
              {uploadErr && <p className="text-[12px] text-red-400">{uploadErr}</p>}
              {src && (
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="h-7 self-start rounded-md border border-line px-3 text-[13px] text-muted hover:text-fg hover:bg-hover"
                >
                  Cancel
                </button>
              )}
            </>
          )}

          {/* gif tab */}
          {tab === 'gif' && (
            <>
              <div className="flex gap-1.5">
                <input
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); setSearching(true); doSearch(); }
                  }}
                  placeholder="Search GIFs…"
                  className="h-8 flex-1 rounded-md border border-line bg-transparent px-2 text-[13px] text-fg placeholder:text-faint focus:outline-none focus:ring-1 focus:ring-accent/50"
                />
                <button
                  type="button"
                  onClick={() => { setSearching(true); doSearch(); }}
                  className="h-8 rounded-md border border-line px-3 text-[13px] text-muted hover:text-fg hover:bg-hover"
                >
                  Search
                </button>
              </div>
              {searching && results.length === 0 && (
                <p className="text-[12px] text-faint">No results.</p>
              )}
              {results.length > 0 && (
                <div className="grid grid-cols-4 gap-1 max-h-48 overflow-y-auto rounded-md">
                  {results.map((r, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => pickResult(r.url)}
                      className="overflow-hidden rounded border border-line hover:border-accent/50"
                    >
                      <img src={r.preview} alt="" className="h-16 w-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
              {src && (
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="h-7 self-start rounded-md border border-line px-3 text-[13px] text-muted hover:text-fg hover:bg-hover"
                >
                  Cancel
                </button>
              )}
            </>
          )}
        </div>
      </NodeViewWrapper>
    );
  }

  // ── display ───────────────────────────────────────────────────────────────
  return (
    <NodeViewWrapper className={wrapperClass} data-type="imageBlock" data-indent={node.attrs.indent} style={{ '--indent': node.attrs.indent }}>
      <div className={`flex flex-col gap-1 ${alignClass}`} style={{ maxWidth: '100%' }} contentEditable={false}>
        {loadErr ? (
          <div className="flex h-20 items-center justify-center rounded-lg border border-line text-[13px] text-muted">
            Couldn't load image.{' '}
            <button
              type="button"
              className="ml-1 text-accent hover:underline"
              onClick={() => { setLoadErr(false); setEditing(true); setTab('link'); }}
            >
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
        <div className="flex items-center gap-1 group">
          <input
            value={capDraft}
            onChange={(e) => setCapDraft(e.target.value)}
            onBlur={() => { if (capDraft !== caption) updateAttributes({ caption: capDraft }); }}
            placeholder="Add a caption…"
            className="flex-1 bg-transparent text-[12px] text-muted placeholder:text-faint focus:outline-none"
          />
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {ALIGNS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => updateAttributes({ align: a })}
                title={`Align ${a}`}
                className={`flex h-5 w-5 items-center justify-center rounded text-[10px] ${align === a ? 'bg-accent/20 text-accent' : 'text-faint hover:text-muted'}`}
              >
                {a === 'left' ? '⬅' : a === 'center' ? '⬛' : '➡'}
              </button>
            ))}
            <button
              type="button"
              onClick={() => { setEditing(true); setUrlDraft(src); setTab('link'); }}
              className="ml-1 flex h-5 items-center rounded px-1 text-[10px] text-faint hover:text-muted"
            >
              Edit
            </button>
          </div>
        </div>
      </div>
    </NodeViewWrapper>
  );
}
