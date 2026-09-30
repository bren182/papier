const TREE = [
  { label: 'Roadmap', depth: 0, expanded: true },
  { label: 'v0.1 — it holds my notes', depth: 1, active: true },
  { label: 'v0.2 — actually nice', depth: 1 },
  { label: 'v0.3 — databases', depth: 1 },
  { label: 'v0.4 — not alone', depth: 1 },
  { label: 'v1.0 — shipped', depth: 1 },
  { label: 'Tech stack', depth: 0, expanded: false },
  { label: 'Data model', depth: 0, expanded: false },
  { label: 'Scale & longevity', depth: 0, expanded: false },
  { label: 'Open questions', depth: 0, expanded: false },
  { label: 'Scratch', depth: 0, expanded: false },
];

const navButton =
  'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-muted hover:bg-s-active hover:text-fg';

export function Sidebar() {
  return (
    <nav
      aria-label="Workspace"
      className="p-glass relative flex w-[260px] shrink-0 flex-col gap-0.5 border-r border-white/5 bg-s-sidebar px-2 py-3"
    >
      <button type="button" className="flex h-10 items-center gap-2.5 rounded-md px-2.5 text-left hover:bg-s-active">
        <span className="flex size-[22px] items-center justify-center rounded-[5px] bg-hover font-display text-sm text-fg-strong">
          P
        </span>
        <span className="flex-1 text-sm font-semibold text-fg-strong">Papier</span>
      </button>

      <button type="button" className={navButton}>
        <SearchIcon />
        <span className="flex-1">Search</span>
        <kbd className="font-mono text-[11px] text-faint">Ctrl K</kbd>
      </button>
      <button type="button" className={navButton}>
        <GearIcon />
        <span>Settings</span>
      </button>

      <div className="mt-4 flex h-[26px] items-center px-2.5 text-xs font-medium text-faint">Pages</div>

      {TREE.map((item) => (
        <button
          key={item.label}
          type="button"
          aria-current={item.active ? 'page' : undefined}
          className={`flex h-[30px] items-center gap-1.5 rounded-md pr-2.5 text-left text-sm ${
            item.active ? 'bg-s-active text-fg-strong' : 'text-[#a3a3a3] hover:bg-s-active hover:text-fg'
          }`}
          style={{ paddingLeft: 6 + item.depth * 18 }}
        >
          <span className="flex size-4 items-center justify-center">
            {item.expanded !== undefined && (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                className="text-muted"
                style={{ transform: `rotate(${item.expanded ? 90 : 0}deg)` }}
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
            )}
          </span>
          <PageIcon />
          <span className="truncate">{item.label}</span>
        </button>
      ))}

      <div className="flex-1" />
      <button type="button" className={navButton}>
        <TrashIcon />
        <span>Trash</span>
      </button>
      <button type="button" className={navButton}>
        <PlusIcon />
        <span>New page</span>
      </button>
    </nav>
  );
}

const iconProps = /** @type {const} */ ({
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
});

function SearchIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </svg>
  );
}

function PageIcon() {
  return (
    <svg {...iconProps} strokeWidth={1.8} className="shrink-0 opacity-75">
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg {...iconProps}>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
