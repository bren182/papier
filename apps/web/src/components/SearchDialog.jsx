import { Fragment, useEffect, useRef, useState } from 'react';
import { snippetParts } from '@papier/core/text';
import { useSearch } from '../api/search.js';
import { TitleText } from './TitleText.jsx';

/** @typedef {import('../api/search.js').SearchHit} SearchHit */
/**
 * A command in the palette: runs after the dialog closes. `keys` shows its shortcut.
 * @typedef {{ id: string, title: string, keywords?: string, keys?: string, common?: boolean, run: () => void }} Command
 * @typedef {{ kind: 'command', command: Command } | { kind: 'hit', hit: SearchHit, recent?: boolean }} Item
 */

const DEBOUNCE_MS = 120;

/** "Top level" in the move picker: a hit with no page. */
const ROOT_HIT = /** @type {SearchHit} */ ({ page: { id: '', title: 'Top level', titleContent: null, icon: null }, ancestors: [], blockId: null, field: null, snippet: '' });

/**
 * Ctrl/Cmd-K search and command palette: type, ↑/↓ to pick, Enter to open (at
 * the matching block) or run, Esc to close. With `commands`, matching commands
 * come first ("`>`" shows only commands) and an empty query shows `recent`
 * pages and the common commands. Also the page picker for "Move to…"
 * (`rootOption` adds a "Top level" row, which picks `null`).
 * @param {{
 *   onClose: () => void,
 *   onOpen: (pageId: string | null, blockId: string | null) => void,
 *   label?: string,
 *   rootOption?: boolean,
 *   exclude?: string,
 *   commands?: Command[],
 *   recent?: import('../recentPages.js').RecentPage[],
 * }} props
 */
export function SearchDialog({ onClose, onOpen, label = 'Search', rootOption = false, exclude, commands, recent = [] }) {
  const [input, setInput] = useState('');
  const commandMode = Boolean(commands) && input.trimStart().startsWith('>');
  const text = commandMode ? input.trimStart().slice(1).trim() : input.trim();
  const q = useDebounced(commandMode ? '' : input, DEBOUNCE_MS);
  const search = useSearch(q);
  const found = text && !commandMode ? (search.data?.pages.flatMap((p) => p.items) ?? []) : [];
  const hits = [...(rootOption ? [ROOT_HIT] : []), ...found.filter((h) => h.page.id !== exclude)];
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const matching = (commands ?? []).filter((c) =>
    words.length ? words.every((w) => `${c.title} ${c.keywords ?? ''}`.toLowerCase().includes(w)) : commandMode || c.common,
  );
  /** @type {Item[]} */
  const items = [
    ...(!text && !commandMode
      ? recent.filter((p) => p.id !== exclude).map((p) => /** @type {Item} */ ({ kind: 'hit', recent: true, hit: { page: p, ancestors: [], blockId: null, field: null, snippet: '' } }))
      : []),
    ...(words.length && !commandMode ? matching.slice(0, 6) : matching).map((command) => /** @type {Item} */ ({ kind: 'command', command })),
    ...hits.map((hit) => /** @type {Item} */ ({ kind: 'hit', hit })),
  ];
  const [active, setActive] = useState(0);
  const list = useRef(/** @type {HTMLUListElement | null} */ (null));

  useEffect(() => setActive(0), [q, input]);

  // Keep the active row in view while arrowing through.
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  /** @param {Item} item */
  const open = (item) => {
    onClose();
    if (item.kind === 'command') item.command.run();
    else onOpen(item.hit === ROOT_HIT ? null : item.hit.page.id, item.hit.blockId);
  };

  /** @param {import('react').KeyboardEvent} e */
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      const next = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      setActive(next);
      if (next >= items.length - 3 && search.hasNextPage && !search.isFetchingNextPage) search.fetchNextPage();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[active];
      if (item) open(item);
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
            placeholder={commands ? 'Search pages, or type > for commands…' : label === 'Search' ? 'Search pages…' : label}
            aria-label={label === 'Search' ? 'Search pages' : label}
            role="combobox"
            aria-expanded={items.length > 0}
            aria-controls="papier-search-results"
            aria-activedescendant={items[active] ? `papier-search-${active}` : undefined}
            // The global :focus-visible ring is unlayered CSS and beats `outline-none`;
            // the dialog itself shows where focus is.
            style={{ outline: 'none' }}
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-fg-strong placeholder:text-faint"
          />
        </div>

        {items.length > 0 ? (
          <ul
            ref={list}
            id="papier-search-results"
            role="listbox"
            aria-label="Results"
            onScroll={onScroll}
            className="min-h-0 overflow-y-auto p-1.5"
          >
            {items.map((item, i) => {
              // A small heading where a group starts.
              const group = item.kind === 'command' ? 'Commands' : item.recent ? 'Recent' : commands ? 'Pages' : null;
              const isRecent = item.kind === 'hit' && item.recent;
              const prev = items[i - 1];
              const prevGroup = !prev ? null : prev.kind === 'command' ? 'Commands' : prev.recent ? 'Recent' : 'Pages';
              const heading = group && group !== prevGroup && (commands || isRecent) ? (
                <li role="presentation" className="px-3 pt-2 pb-1 text-[11px] font-medium tracking-wide text-faint uppercase">
                  {group}
                </li>
              ) : null;
              if (item.kind === 'command') {
                const c = item.command;
                return (
                  <Fragment key={`c:${c.id}`}>
                    {heading}
                    <li
                      id={`papier-search-${i}`}
                      data-index={i}
                      role="option"
                      aria-selected={i === active}
                      onMouseMove={() => i !== active && setActive(i)}
                      onClick={() => open(item)}
                      className={`flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-sm ${i === active ? 'bg-hover' : ''}`}
                    >
                      <span className="flex-1 truncate text-fg">{c.title}</span>
                      {c.keys && <kbd className="shrink-0 font-mono text-[11px] text-faint">{c.keys}</kbd>}
                    </li>
                  </Fragment>
                );
              }
              const hit = item.hit;
              return (
                <Fragment key={`${item.recent ? 'r' : 'h'}:${hit.page.id}`}>
                  {heading}
                  <li
                    id={`papier-search-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={i === active}
                    onMouseMove={() => i !== active && setActive(i)}
                    onClick={() => open(item)}
                    className={`cursor-pointer rounded-md px-3 py-2 ${i === active ? 'bg-hover' : ''}`}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className={`truncate text-sm font-medium ${hit === ROOT_HIT ? 'text-muted' : 'text-fg-strong'}`}>
                        {hit.page.icon && <span className="mr-1.5">{hit.page.icon}</span>}
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
                    {(hit.blockId || hit.field) && <Snippet text={hit.snippet} field={hit.field} />}
                  </li>
                </Fragment>
              );
            })}
          </ul>
        ) : (
          <p className="px-4 py-5 text-sm text-faint">
            {!input.trim() ? 'Search titles and page content.' : search.isFetching ? 'Searching…' : commandMode ? 'No such command.' : 'No results.'}
          </p>
        )}
      </div>
    </div>
  );
}

/** A snippet with its matched terms highlighted; `field` names the property it's from. @param {{ text: string, field?: string | null }} props */
function Snippet({ text, field }) {
  return (
    <p className="mt-0.5 line-clamp-2 text-[13px] leading-5 text-muted">
      {field && <span className="text-faint">{field}: </span>}
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
