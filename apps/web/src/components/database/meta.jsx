/** Property type names, icons and display helpers shared by the views. */

export const TYPE_LABELS = /** @type {Record<string, string>} */ ({
  text: 'Text',
  number: 'Number',
  select: 'Select',
  multi_select: 'Multi-select',
  date: 'Date',
  checkbox: 'Checkbox',
  url: 'URL',
  created_time: 'Created time',
  edited_time: 'Edited time',
  relation: 'Relation',
  rollup: 'Rollup',
  button: 'Button',
});

export const ROLLUP_LABELS = /** @type {Record<string, string>} */ ({
  show_original: 'Show original',
  count: 'Count all',
  count_values: 'Count values',
  count_unique: 'Count unique values',
  count_empty: 'Count empty',
  percent_empty: 'Percent empty',
  sum: 'Sum',
  avg: 'Average',
  min: 'Min',
  max: 'Max',
  range: 'Range',
  earliest: 'Earliest date',
  latest: 'Latest date',
  checked: 'Checked',
  percent_checked: 'Percent checked',
});

export const OP_LABELS = /** @type {Record<string, string>} */ ({
  contains: 'contains',
  not_contains: 'does not contain',
  is: 'is',
  is_not: 'is not',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
  '=': '=',
  '!=': '≠',
  '>': '>',
  '<': '<',
  '>=': '≥',
  '<=': '≤',
  before: 'is before',
  after: 'is after',
  on_or_before: 'is on or before',
  on_or_after: 'is on or after',
});

/** @param {number} [size] */
const iconProps = (size = 14) =>
  /** @type {const} */ ({
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    className: 'shrink-0',
  });

const PATHS = /** @type {Record<string, import('react').ReactNode>} */ ({
  title: <path d="M5 7h14M5 12h14M5 17h9" />,
  text: <path d="M5 7h14M5 12h10M5 17h7" />,
  number: <path d="M9 4L7 20M17 4l-2 16M4 9h16M3 15h16" />,
  select: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 11l3.5 3.5 3.5-3.5" />
    </>
  ),
  multi_select: <path d="M4 6h3M4 12h3M4 18h3M10 6h10M10 12h10M10 18h10" />,
  date: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16M9 3v4M15 3v4" />
    </>
  ),
  checkbox: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </>
  ),
  url: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  created_time: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  edited_time: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  relation: <path d="M7 17L17 7M9 7h8v8" />,
  rollup: <path d="M17 5H7l6 7-6 7h10" />,
  button: (
    <>
      <rect x="3.5" y="7" width="17" height="10" rx="3" />
      <path d="M9 12h6" />
    </>
  ),
});

/** @param {{ type: string, size?: number }} props */
export function TypeIcon({ type, size }) {
  return <svg {...iconProps(size)}>{PATHS[type] ?? PATHS.text}</svg>;
}

/** @param {{ size?: number }} props */
export function DatabaseIcon({ size = 16 }) {
  return (
    <svg {...iconProps(size)} strokeWidth={1.8} className="shrink-0 opacity-75">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M9.5 9.5v10" />
    </svg>
  );
}

/** @param {{ path: string, size?: number }} props */
export function Icon({ path, size = 14 }) {
  return (
    <svg {...iconProps(size)}>
      <path d={path} />
    </svg>
  );
}

export const ICONS = {
  plus: 'M12 5v14M5 12h14',
  sort: 'M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4',
  filter: 'M4 5h16l-6 8v6l-4-2v-4z',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
  x: 'M6 6l12 12M18 6L6 18',
  open: 'M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  table: 'M3.5 5.5h17v13h-17zM3.5 10h17M9.5 10v8.5',
  board: 'M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v11h-4z',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  bolt: 'M13 3L5 14h6l-1 7 8-11h-6l1-7z',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  move: 'M5 12h14M13 6l6 6-6 6',
  group: 'M4 6h16M4 12h10M4 18h13M17 10l3 2-3 2',
  calendar: 'M4 5h16v15H4zM4 10h16M9 3v4M15 3v4',
};
