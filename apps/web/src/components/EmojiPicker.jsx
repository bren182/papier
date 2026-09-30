import { useMemo, useState } from 'react';
import { ALL_EMOJI, EMOJI_CATEGORIES } from './emojiData.js';

/**
 * Pick an emoji: search by name, browse by category, or roll a random one.
 * Recently picked ones come first. Rendered inside a Popover by its caller.
 */

const RECENT_KEY = 'papier.recentEmoji';

function loadRecent() {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 16) : [];
  } catch {
    return [];
  }
}

/** @param {{ onPick: (emoji: string) => void, onRemove?: () => void }} props */
export function EmojiPicker({ onPick, onRemove }) {
  const [q, setQ] = useState('');
  const recent = useMemo(loadRecent, []);
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const found = terms.length ? ALL_EMOJI.filter((e) => terms.every((t) => e.words.includes(t))) : null;

  /** @param {string} emoji */
  const pick = (emoji) => {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify([emoji, ...recent.filter((x) => x !== emoji)].slice(0, 16)));
    } catch {
      // no storage: recents just won't stick
    }
    onPick(emoji);
  };

  /** @param {{ emoji: string, words?: string }[]} list */
  const grid = (list) => (
    <div className="grid grid-cols-9 gap-0.5">
      {list.map((e) => (
        <button
          key={e.emoji}
          type="button"
          title={e.words}
          aria-label={e.words ? e.words.split(' ')[0] : e.emoji}
          onClick={() => pick(e.emoji)}
          className="flex size-8 items-center justify-center rounded text-[20px] leading-none hover:bg-hover"
        >
          {e.emoji}
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-1.5 p-1" aria-label="Emoji picker">
      <div className="flex items-center gap-1">
        <input
          autoFocus
          value={q}
          placeholder="Search emoji…"
          aria-label="Search emoji"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && found?.[0]) pick(found[0].emoji);
          }}
          className="h-7 min-w-0 flex-1 rounded-md border border-line bg-root/60 px-2 text-[13px] text-fg outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={() => pick(ALL_EMOJI[Math.floor(Math.random() * ALL_EMOJI.length)]?.emoji ?? '📄')}
          className="h-7 rounded-md px-2 text-[12px] text-muted hover:bg-hover hover:text-fg"
        >
          Random
        </button>
        {onRemove && (
          <button type="button" onClick={onRemove} className="h-7 rounded-md px-2 text-[12px] text-muted hover:bg-hover hover:text-fg">
            Remove
          </button>
        )}
      </div>
      <div className="max-h-[300px] overflow-y-auto pr-1">
        {found ? (
          found.length ? grid(found) : <div className="px-1 py-2 text-[13px] text-muted">No emoji match “{q.trim()}”.</div>
        ) : (
          <>
            {recent.length > 0 && (
              <>
                <div className="px-1 pt-1 pb-0.5 text-[11px] font-medium tracking-wide text-faint uppercase">Recent</div>
                {grid(recent.map((emoji) => ({ emoji })))}
              </>
            )}
            {EMOJI_CATEGORIES.map((c) => (
              <div key={c.name}>
                <div className="px-1 pt-2 pb-0.5 text-[11px] font-medium tracking-wide text-faint uppercase">{c.name}</div>
                {grid(c.emoji)}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
