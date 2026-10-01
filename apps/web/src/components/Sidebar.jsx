import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { pageKeys, useArchivePage, useChildPages, useCreatePage, useFavorites, useMovePage, useSetFavorite } from '../api/pages.js';
import { useRecentPages } from '../recentPages.js';
import { ServerStatus } from './ServerStatus.jsx';
import { WorkspaceMenu } from './WorkspaceMenu.jsx';
import { SearchDialog } from './SearchDialog.jsx';
import { TitleText } from './TitleText.jsx';
import { SidebarIcon, StarIcon } from './Topbar.jsx';

/** @typedef {import('@papier/core').Page} Page */
/** @typedef {'before' | 'inside' | 'after'} DropWhere */
/** @typedef {{ id: string, where: DropWhere }} DropTarget */
/**
 * @typedef {{
 *   selectedId: string | null,
 *   onSelect: (id: string | null) => void,
 *   isExpanded: (id: string) => boolean,
 *   setExpanded: (id: string, open: boolean) => void,
 *   onAddChild: (parentId: string) => void,
 *   onDelete: (page: Page) => void,
 *   onMoveTo: (page: Page) => void,
 *   dnd: TreeDnd,
 * }} TreeContext
 */
/**
 * Dragging pages around the tree.
 * @typedef {{
 *   dragging: Page | null,
 *   drop: DropTarget | null,
 *   start: (page: Page) => void,
 *   over: (page: Page, path: string[], where: DropWhere) => boolean,
 *   leave: (page: Page) => void,
 *   commit: (page: Page) => void,
 *   end: () => void,
 * }} TreeDnd
 */

/** How long hovering the middle of a collapsed page waits before opening it. */
const EXPAND_DELAY_MS = 600;

const navButton = 'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-muted hover:bg-s-active hover:text-fg';

/**
 * @param {{ selectedId: string | null, atHome: boolean, onSelect: (id: string | null) => void, onSearch: () => void,
 *   onTemplates: () => void, onShortcuts: () => void, onCollapse: () => void,
 *   onSettings: (anchor: HTMLElement) => void, onTrash: () => void }} props
 */
export function Sidebar({ selectedId, atHome, onSelect, onSearch, onTemplates, onShortcuts, onCollapse, onSettings, onTrash }) {
  const [isExpanded, setExpanded] = useExpandedSet();
  const createPage = useCreatePage();
  const archivePage = useArchivePage();
  const qc = useQueryClient();

  /** @param {string | null} parentId @param {'page' | 'database'} [kind] */
  const addPage = (parentId, kind = 'page') =>
    createPage.mutate(
      { parentId, kind },
      {
        onSuccess: (page) => {
          if (parentId) setExpanded(parentId, true);
          onSelect(page.id);
        },
      },
    );

  /** @param {Page} page */
  const deletePage = (page) =>
    archivePage.mutate(
      { id: page.id, parentId: page.parentId },
      {
        onSuccess: () => {
          // If the open page was this one or inside it, step out to the parent.
          /** @type {{ ancestors: { id: string }[] } | undefined} */
          const open = selectedId ? qc.getQueryData(pageKeys.detail(selectedId)) : undefined;
          const openLineage = open && selectedId ? [...open.ancestors.map((a) => a.id), selectedId] : [];
          if (openLineage.includes(page.id)) onSelect(page.parentId);
        },
      },
    );

  const dnd = useTreeDnd(setExpanded);
  const [moving, setMoving] = useState(/** @type {Page | null} */ (null));
  const movePage = useMovePage();

  /** @type {TreeContext} */
  const ctx = {
    selectedId,
    onSelect,
    isExpanded,
    setExpanded,
    onAddChild: addPage,
    onDelete: deletePage,
    onMoveTo: setMoving,
    dnd,
  };

  return (
    <nav aria-label="Workspace" className="p-glass relative flex w-[260px] shrink-0 flex-col gap-0.5 border-r border-white/5 bg-s-sidebar px-2 py-3">
      <div className="group/head flex items-center">
        <WorkspaceMenu onHome={() => onSelect(null)} />
        <ServerStatus />
        <button
          type="button"
          aria-label="Hide sidebar"
          title="Hide sidebar (Ctrl+\)"
          onClick={onCollapse}
          className="ml-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted opacity-0 group-hover/head:opacity-100 hover:bg-s-active hover:text-fg focus-visible:opacity-100"
        >
          <SidebarIcon />
        </button>
      </div>

      <button
        type="button"
        onClick={() => onSelect(null)}
        aria-current={atHome ? 'page' : undefined}
        className={`${navButton} ${atHome ? 'bg-s-active text-fg-strong' : ''}`}
      >
        <HomeIcon />
        <span>Home</span>
      </button>
      <button type="button" onClick={onSearch} className={navButton}>
        <SearchIcon />
        <span className="flex-1">Search</span>
        <kbd className="font-mono text-[11px] text-faint">Ctrl K</kbd>
      </button>
      <button type="button" className={navButton} onClick={onTemplates}>
        <TemplateIcon />
        <span>Templates</span>
      </button>
      <button type="button" className={navButton} data-settings-anchor="" onClick={(e) => onSettings(e.currentTarget)}>
        <GearIcon />
        <span>Settings</span>
      </button>
      <button type="button" className={navButton} onClick={onShortcuts}>
        <KeyboardIcon />
        <span className="flex-1">Keyboard shortcuts</span>
        <kbd className="font-mono text-[11px] text-faint">Ctrl /</kbd>
      </button>

      <div className="-mx-2 mt-4 min-h-0 flex-1 overflow-y-auto px-2">
        <Favorites selectedId={selectedId} onSelect={onSelect} />
        <Recent selectedId={selectedId} onSelect={onSelect} />
        <div className="group/pages flex h-[26px] items-center justify-between px-2.5 text-xs font-medium text-faint">
          <span>Pages</span>
          <button
            type="button"
            aria-label="New page"
            onClick={() => addPage(null)}
            className="flex size-5 items-center justify-center rounded text-muted opacity-0 group-hover/pages:opacity-100 hover:bg-s-active hover:text-fg focus-visible:opacity-100"
          >
            <PlusIcon size={14} />
          </button>
        </div>

        <PageList parentId={null} depth={0} path={[]} ctx={ctx} />
      </div>

      <button type="button" className={navButton} onClick={onTrash}>
        <TrashIcon />
        <span>Trash</span>
      </button>
      <button type="button" className={navButton} onClick={() => addPage(null)} disabled={createPage.isPending}>
        <PlusIcon />
        <span>New page</span>
      </button>
      <button type="button" className={navButton} onClick={() => addPage(null, 'database')} disabled={createPage.isPending}>
        <DatabaseIcon />
        <span>New database</span>
      </button>

      {moving && (
        <SearchDialog
          label={`Move “${moving.title || 'Untitled'}” to…`}
          rootOption
          exclude={moving.id}
          onClose={() => setMoving(null)}
          onOpen={(parentId) => {
            movePage.mutate({ id: moving.id, from: moving.parentId, parentId });
            if (parentId) setExpanded(parentId, true);
          }}
        />
      )}
    </nav>
  );
}

/**
 * Starred pages, in starring order; hidden until something is starred.
 * @param {{ selectedId: string | null, onSelect: (id: string) => void }} props
 */
function Favorites({ selectedId, onSelect }) {
  const { data } = useFavorites();
  const setFavorite = useSetFavorite();
  if (!data?.length) return null;
  return (
    <SideSection label="Favourites" storageKey="papier.sidebar.favorites">
      {data.map((p) => (
        <SideLink key={p.id} page={p} active={p.id === selectedId} onSelect={onSelect}>
          <button
            type="button"
            aria-label={`Remove ${p.title || 'Untitled'} from favourites`}
            title="Remove from favourites"
            onClick={() => setFavorite.mutate({ id: p.id, favorite: false })}
            className="flex size-6 items-center justify-center rounded text-muted opacity-0 group-hover:opacity-100 hover:bg-white/10 hover:text-fg focus-visible:opacity-100"
          >
            <StarIcon filled />
          </button>
        </SideLink>
      ))}
    </SideSection>
  );
}

/**
 * The last few pages opened on this device.
 * @param {{ selectedId: string | null, onSelect: (id: string) => void }} props
 */
function Recent({ selectedId, onSelect }) {
  const recent = useRecentPages().slice(0, 5);
  if (recent.length === 0) return null;
  return (
    <SideSection label="Recent" storageKey="papier.sidebar.recent">
      {recent.map((p) => (
        <SideLink key={p.id} page={{ ...p, kind: 'page' }} active={p.id === selectedId} onSelect={onSelect} />
      ))}
    </SideSection>
  );
}

/**
 * A small sidebar section whose header folds it (remembered per device).
 * @param {{ label: string, storageKey: string, children: import('react').ReactNode }} props
 */
function SideSection({ label, storageKey, children }) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(storageKey) !== 'closed';
    } catch {
      return true;
    }
  });
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(storageKey, open ? 'closed' : 'open');
    } catch {
      // no storage: not remembered
    }
  };
  return (
    <section aria-label={label} className="mb-3">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex h-[26px] w-full items-center gap-1 rounded px-2.5 text-left text-xs font-medium text-faint hover:text-muted"
      >
        {label}
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          style={{ transform: `rotate(${open ? 90 : 0}deg)` }}
          aria-hidden="true"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
      {open && <ul>{children}</ul>}
    </section>
  );
}

/**
 * A flat link to a page (Favourites, Recent); `children` are its hover actions.
 * @param {{ page: { id: string, title: string, titleContent: Page['titleContent'], icon: string | null, kind: string }, active: boolean,
 *   onSelect: (id: string) => void, children?: import('react').ReactNode }} props
 */
function SideLink({ page, active, onSelect, children }) {
  return (
    <li
      className={`group flex h-[30px] items-center gap-0.5 rounded-md pr-1 pl-[6px] text-sm ${active ? 'bg-s-active text-fg-strong' : 'text-[#a3a3a3] hover:bg-s-active hover:text-fg'}`}
    >
      <button type="button" onClick={() => onSelect(page.id)} className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-[22px] text-left">
        {page.icon ? (
          <span className="flex w-4 shrink-0 justify-center text-[14px] leading-none">{page.icon}</span>
        ) : page.kind === 'database' ? (
          <DatabaseIcon />
        ) : (
          <PageIcon />
        )}
        <span className={`truncate ${page.title ? '' : 'text-faint'}`}>
          <TitleText title={page.title} titleContent={page.titleContent} />
        </span>
      </button>
      {children}
    </li>
  );
}

/** @param {{ parentId: string | null, depth: number, path: string[], ctx: TreeContext }} props */
function PageList({ parentId, depth, path, ctx }) {
  const { data: pages, isPending, isError } = useChildPages(parentId);
  const indent = { paddingLeft: 6 + depth * 18 + 22 };

  if (isPending) return null;
  if (isError) {
    return (
      <div className="flex h-[30px] items-center text-sm text-faint" style={indent}>
        Couldn't load pages
      </div>
    );
  }
  if (pages.length === 0) {
    return (
      <div className="flex h-[30px] items-center text-sm text-faint" style={indent}>
        {parentId ? 'No pages inside' : 'No pages yet'}
      </div>
    );
  }

  return (
    <ul role={depth === 0 ? 'tree' : 'group'} aria-label={depth === 0 ? 'Pages' : undefined}>
      {pages.map((page) => (
        <TreeItem key={page.id} page={page} depth={depth} path={path} ctx={ctx} />
      ))}
    </ul>
  );
}

/**
 * @param {{ page: Page, depth: number, path: string[], ctx: TreeContext }} props
 *   path: ancestor ids, root first — a page can't be dropped into its own subtree.
 */
function TreeItem({ page, depth, path, ctx }) {
  const expanded = ctx.isExpanded(page.id);
  const active = ctx.selectedId === page.id;
  const title = page.title || 'Untitled';
  const { dnd } = ctx;
  const drop = dnd.drop?.id === page.id ? dnd.drop.where : null;
  const isDatabase = page.kind === 'database';

  /** @param {import('react').DragEvent<HTMLDivElement>} e @returns {DropWhere} */
  const whereOf = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - box.top) / box.height;
    return y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside';
  };

  return (
    <li role="treeitem" aria-expanded={page.hasChildren ? expanded : undefined} aria-selected={active}>
      <div
        // The whole row drags. Never preventDefault its mousedown (see CLAUDE.md).
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', title);
          dnd.start(page);
        }}
        onDragOver={(e) => {
          if (dnd.over(page, path, whereOf(e))) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(/** @type {Node | null} */ (e.relatedTarget))) dnd.leave(page);
        }}
        onDrop={(e) => {
          e.preventDefault();
          dnd.commit(page);
        }}
        onDragEnd={dnd.end}
        data-page-id={page.id}
        className={`group relative flex h-[30px] items-center gap-0.5 rounded-md pr-1 text-sm ${
          drop === 'inside' ? 'bg-accent-soft text-fg-strong' : active ? 'bg-s-active text-fg-strong' : 'text-[#a3a3a3] hover:bg-s-active hover:text-fg'
        } ${dnd.dragging?.id === page.id ? 'opacity-50' : ''}`}
        style={{ paddingLeft: 6 + depth * 18 }}
      >
        {(drop === 'before' || drop === 'after') && (
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute right-1 h-[2px] rounded-full bg-accent ${drop === 'before' ? '-top-px' : '-bottom-px'}`}
            style={{ left: 6 + depth * 18 }}
          />
        )}
        {isDatabase ? (
          <span className="size-5 shrink-0" />
        ) : (
          <button
            type="button"
            aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`}
            onClick={() => ctx.setExpanded(page.id, !expanded)}
            className="flex size-5 shrink-0 items-center justify-center rounded text-muted hover:bg-white/10"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              className="transition-transform"
              style={{
                transform: `rotate(${expanded ? 90 : 0}deg)`,
                opacity: page.hasChildren ? 1 : 0.45,
              }}
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        )}

        <button
          type="button"
          aria-current={active ? 'page' : undefined}
          onClick={() => ctx.onSelect(page.id)}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          {page.icon ? (
            <span className="flex w-4 shrink-0 justify-center text-[14px] leading-none">{page.icon}</span>
          ) : isDatabase ? (
            <DatabaseIcon />
          ) : (
            <PageIcon />
          )}
          <span className={`truncate ${page.title ? '' : 'text-faint'}`}>
            <TitleText title={page.title} titleContent={page.titleContent} />
          </span>
        </button>

        <span className="flex shrink-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
          <button
            type="button"
            aria-label={`Move ${title}`}
            title="Move to…"
            onClick={() => ctx.onMoveTo(page)}
            className="flex size-6 items-center justify-center rounded text-muted hover:bg-white/10 hover:text-fg"
          >
            <MoveIcon />
          </button>
          <button
            type="button"
            aria-label={`Delete ${title}`}
            onClick={() => ctx.onDelete(page)}
            className="flex size-6 items-center justify-center rounded text-muted hover:bg-white/10 hover:text-fg"
          >
            <TrashIcon size={14} />
          </button>
          {!isDatabase && (
            <button
              type="button"
              aria-label={`Add a page inside ${title}`}
              onClick={() => ctx.onAddChild(page.id)}
              className="flex size-6 items-center justify-center rounded text-muted hover:bg-white/10 hover:text-fg"
            >
              <PlusIcon size={14} />
            </button>
          )}
        </span>
      </div>

      {expanded && !isDatabase && <PageList parentId={page.id} depth={depth + 1} path={[...path, page.id]} ctx={ctx} />}
    </li>
  );
}

/**
 * Tree drag state: which page is dragged, where it would land, and the move
 * on drop. A page can't land on itself or inside its own subtree.
 * @param {(id: string, open: boolean) => void} setExpanded
 * @returns {TreeDnd}
 */
function useTreeDnd(setExpanded) {
  const [dragging, setDragging] = useState(/** @type {Page | null} */ (null));
  const [drop, setDrop] = useState(/** @type {DropTarget | null} */ (null));
  const expandTimer = useRef(/** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined));
  const movePage = useMovePage();

  const clearTimer = () => clearTimeout(expandTimer.current);

  return {
    dragging,
    drop,
    start: (page) => setDragging(page),
    over: (page, path, where) => {
      if (!dragging || page.id === dragging.id || path.includes(dragging.id)) return false;
      // A database's children are its rows; pages don't go inside one.
      if (where === 'inside' && page.kind === 'database') where = 'after';
      if (drop?.id !== page.id || drop.where !== where) {
        setDrop({ id: page.id, where });
        clearTimer();
        if (where === 'inside') expandTimer.current = setTimeout(() => setExpanded(page.id, true), EXPAND_DELAY_MS);
      }
      return true;
    },
    leave: (page) => {
      if (drop?.id === page.id) {
        setDrop(null);
        clearTimer();
      }
    },
    commit: (page) => {
      clearTimer();
      if (!dragging || !drop || drop.id !== page.id) return;
      const from = dragging.parentId;
      if (drop.where === 'inside') {
        movePage.mutate({ id: dragging.id, from, parentId: page.id });
        setExpanded(page.id, true);
      } else {
        const side = drop.where === 'before' ? { beforeId: page.id } : { afterId: page.id };
        movePage.mutate({
          id: dragging.id,
          from,
          parentId: page.parentId,
          ...side,
        });
      }
      setDrop(null);
      setDragging(null);
    },
    end: () => {
      clearTimer();
      setDrop(null);
      setDragging(null);
    },
  };
}

const EXPANDED_KEY = 'papier.expanded';

/** Which tree nodes are open, remembered per device. */
function useExpandedSet() {
  const [open, setOpen] = useState(() => {
    try {
      return new Set(/** @type {string[]} */ (JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '[]')));
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...open]));
    } catch {
      // storage unavailable: expansion just won't persist
    }
  }, [open]);

  const isExpanded = useCallback((/** @type {string} */ id) => open.has(id), [open]);
  const setExpanded = useCallback((/** @type {string} */ id, /** @type {boolean} */ value) => {
    setOpen((prev) => {
      if (prev.has(id) === value) return prev;
      const next = new Set(prev);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  return /** @type {const} */ ([isExpanded, setExpanded]);
}

/** @param {number} [size] */
const iconProps = (size = 16) =>
  /** @type {const} */ ({
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  });

function MoveIcon() {
  return (
    <svg {...iconProps(14)}>
      <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg {...iconProps()}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

function TemplateIcon() {
  return (
    <svg {...iconProps()}>
      <rect x="4" y="4" width="16" height="16" rx="2" strokeDasharray="3 2.5" />
      <path d="M8 9h8M8 13h5" />
    </svg>
  );
}

function KeyboardIcon() {
  return (
    <svg {...iconProps()}>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg {...iconProps()}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </svg>
  );
}

function DatabaseIcon() {
  return (
    <svg {...iconProps()} strokeWidth={1.8} className="shrink-0 opacity-75">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M9.5 9.5v10" />
    </svg>
  );
}

function PageIcon() {
  return (
    <svg {...iconProps()} strokeWidth={1.8} className="shrink-0 opacity-75">
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
    </svg>
  );
}

/** @param {{ size?: number }} props */
function TrashIcon({ size }) {
  return (
    <svg {...iconProps(size)}>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
    </svg>
  );
}

/** @param {{ size?: number }} props */
function PlusIcon({ size }) {
  return (
    <svg {...iconProps(size)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
