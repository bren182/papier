// Notion's date text → stored `YYYY-MM-DD`.

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Matches `Month D, YYYY`, the way Notion writes dates in exports and @-mentions. */
export const MONTH_DATE = /(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4})/;

const pad = (n: number) => String(n).padStart(2, '0');

/** `Month D, YYYY` parts → ISO, or null for an impossible day. */
export function isoFromParts(month: string, day: string, year: string): string | null {
  const m = MONTHS.indexOf(month.toLowerCase()) + 1;
  const d = Number(day);
  if (!m || d < 1) return null;
  const iso = `${year}-${pad(m)}-${pad(d)}`;
  // Round-trip through Date to reject e.g. February 30.
  return new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso ? iso : null;
}

/**
 * A property's date text → `YYYY-MM-DD`, or null when it isn't a date. Times,
 * time zones and range ends are dropped: `June 20, 2026 6:00 (GMT+2) → June 21, 2026`
 * is `2026-06-20`.
 */
export function parseNotionDate(text: string): string | null {
  const t = text.trim();
  const start = t.split('→')[0]!.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/.exec(start);
  if (iso) return isoFromParts(MONTHS[Number(iso[2]) - 1] ?? '', iso[3]!, iso[1]!);
  const m = new RegExp(`^${MONTH_DATE.source}(?: \\d{1,2}:\\d{2}(?: ?[AP]M)?)?(?: \\([^)]*\\))?$`).exec(start);
  return m ? isoFromParts(m[1]!, m[2]!, m[3]!) : null;
}

/** Month-day (`MM-DD`) of an ISO date. */
export const monthDay = (iso: string) => iso.slice(5, 10);
