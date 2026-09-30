import { useEffect, useRef, useState } from 'react';
import { snippetParts } from '@papier/core/text';
import { useSearch } from '../api/search.js';
import { TitleText } from './TitleText.jsx';

/** @typedef {import('../api/search.js').SearchHit} SearchHit */

const DEBOUNCE_MS = 120;

/** "Top level" in the move picker: a hit with no page. */
const ROOT_HIT = /** @type {SearchHit} */ ({ page: { id: '', title: 'Top level', titleContent: null, icon: null }, ancestors: [], blockId: null, snippet: '' });

/**
 * Ctrl/Cmd-K search: type, ↑/↓ to pick, Enter to open (at the matching
 * block), Esc to close. Also the page picker for "Move to…" (`rootOption`
 * adds a "Top level" row, which picks `null`).
 * @param {{
 *   onClose: () => void,
 *   onOpen: (pageId: string | null, blockId: string | null) => void,
 *   label?: string,
 *   rootOption?: boolean,
 *   exclude?: string,
 * }} props
 */
export function SearchDialog({ onClose, onOpen, label = 'Search', rootOption = false, exclude }) {
  const [input, setInput] = useState('');
  const q = useDebounced(input, DEBOUNCE_MS);
  const search = useSearch(q);
  const found = input.trim() ? (search.data?.pages.flatMap((p) => p.items) ?? []) : [];
  const hits = [...(rootOption ? [ROOT_HIT] : []), ...found.filter((h) => h.page.id !== exclude)];
  const [active, setActive] = useState(0);
  const list = useRef(/** @type {HTMLUListElement | null} */ (null));

  useEffect(() => setActive(0), [q]);

  // Keep the active row in view while arrowing through.
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  /** @param {SearchHit} hit */
  const open = (hit) => {
    onOpen(hit === ROOT_HIT ? null : hit.page.id, hit.blockId);
    onClose();
  };

  /** @param {import('react').KeyboardEvent} e */
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!hits.length) return;
      const next = (active + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
      setActive(next);
      if (next >= hits.length - 3 && search.hasNextPage && !search.isFetchingNextPage) search.fetchNextPage();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = hits[active];
      if (hit) open(hit);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  /** @param {import('react').UIEvent<HTMLUListElement>} e */
  const onScroll = (e) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120 && search.hasNextPage && !search.isFetchingNextPage) {
      search.fetchNextPage();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center bg-black/40 px-4 pt-[12vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="papier-popover flex h-fit max-h-[70vh] w-full max-w-[600px] flex-col overflow-hidden"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0 text-faint">
            <circle cx="7" cy="7" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={label === 'Search' ? 'Search pages…' : label}
            aria-label={label === 'Search' ? 'Search pages' : label}
            role="combobox"
            aria-expanded={hits.length > 0}
            aria-controls="papier-search-results"
            aria-activedescendant={hits[active] ? `papier-search-${active}` : undefined}
            // The global :focus-visible ring is unlayered CSS and beats `outline-none`;
            // the dialog itself shows where focus is.
            style={{ outline: 'none' }}
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-fg-strong placeholder:text-faint"
          />
        </div>

        {hits.length > 0 ? (
          <ul
            ref={list}
            id="papier-search-results"
            role="listbox"
            aria-label="Results"
            onScroll={onScroll}
            className="min-h-0 overflow-y-auto p-1.5"
          >
            {hits.map((hit, i) => (
              <li
                key={hit.page.id}
                id={`papier-search-${i}`}
                data-index={i}
                role="option"
                aria-selected={i === active}
                onMouseMove={() => i !== active && setActive(i)}
                onClick={() => open(hit)}
                className={`cursor-pointer rounded-md px-3 py-2 ${i === active ? 'bg-hover' : ''}`}
              >
                <div className="flex items-baseline gap-2">
                  <span className={`truncate text-sm font-medium ${hit === ROOT_HIT ? 'text-muted' : 'text-fg-strong'}`}>
                    <TitleText title={hit.page.title} titleContent={hit.page.titleContent} />
                  </span>
                  {hit.ancestors.length > 0 && (
                    <span className="truncate text-xs text-faint">
                      {hit.ancestors.map((a, j) => (
                        <span key={a.id}>
                          {j > 0 && ' / '}
                          <TitleText title={a.title} titleContent={a.titleContent} />
                        </span>
                      ))}
                    </span>
                  )}
                </div>
                {hit.blockId && <Snippet text={hit.snippet} />}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-5 text-sm text-faint">
            {!input.trim() ? 'Search titles and page content.' : search.isFetching ? 'Searching…' : 'No results.'}
          </p>
        )}
      </div>
    </div>
  );
}

/** A snippet with its matched terms highlighted. @param {{ text: string }} props */
function Snippet({ text }) {
  return (
    <p className="mt-0.5 line-clamp-2 text-[13px] leading-5 text-muted">
      {snippetParts(text.trim()).map((part, i) =>
        part.hit ? (
          <mark key={i} className="rounded-[3px] bg-accent-soft px-0.5 text-fg-strong">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </p>
  );
}

/**
 * @template T
 * @param {T} value @param {number} ms
 * @returns {T}
 */
function useDebounced(value, ms) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
