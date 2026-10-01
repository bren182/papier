import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { COVERS, coverCss, THEMES } from '@papier/ui';
import { useUpdatePage } from '../api/pages.js';
import { uploadFile } from '../api/files.js';
import { usePageAction } from '../pageActions.js';
import { setMood } from '../theme.js';
import { menuItem, menuLabel, Popover } from './database/Popover.jsx';

/**
 * A page's look: its cover (the window above the glass), its icon, and the
 * Customise menu (layout, font, the backdrop mood it sets while open).
 * Everything saves through PATCH /api/pages/:id (`icon`, `appearance`).
 *
 * @typedef {import('@papier/core').Page} PageData
 * @typedef {import('../api/pages.js').Appearance} Appearance
 */

const EmojiPicker = lazy(() => import('./EmojiPicker.jsx').then((m) => ({ default: m.EmojiPicker })));

/** The article's classes for a page's layout options. @param {Appearance | undefined} a */
export function layoutClasses(a) {
  return [a?.smallText ? 'page-small' : '', a?.font && a.font !== 'sans' ? `page-font-${a.font}` : ''].join(' ');
}

/** While a page is open, its mood (if any) colours the backdrop. @param {PageData | undefined} page */
export function usePageMood(page) {
  const mood = page?.appearance?.mood ?? null;
  useEffect(() => {
    setMood(mood);
    return () => setMood(null);
  }, [mood]);
}

/** Save icon / appearance changes for a page. @param {string} id */
function usePatch(id) {
  const update = useUpdatePage();
  return {
    /** @param {string | null} icon */
    icon: (icon) => update.mutate({ id, patch: { icon } }),
    /** @param {Appearance} appearance */
    look: (appearance) => update.mutate({ id, patch: { appearance } }),
  };
}

/** Whether a page shows the band above its content (any cover, "clear" included). @param {PageData | undefined} page */
export const hasCover = (page) => Boolean(page?.appearance?.cover);

/**
 * The 170px band above the glass, only when the page has a cover: a gradient
 * drawn from the palette, or "clear" — the backdrop, blurred like the glass.
 * No cover (the default): no band, the page starts right under the top bar.
 * @param {{ page: PageData | undefined }} props
 */
export function PageCover({ page }) {
  const cover = page?.appearance?.cover;
  const [choosing, setChoosing] = useState(false);
  const ref = useRef(/** @type {HTMLButtonElement | null} */ (null));
  if (!cover) return null;
  const clear = cover === 'clear';
  return (
    <div className={`group/cover relative h-[170px] ${clear ? 'p-glass' : ''}`} data-cover={cover}>
      {!clear && <div aria-hidden="true" className="page-cover absolute inset-0" style={{ backgroundImage: coverCss(cover) }} />}
      {page && (
        <div className="absolute right-4 bottom-3 flex gap-1 opacity-0 transition-opacity group-hover/cover:opacity-100 focus-within:opacity-100">
          <button ref={ref} type="button" onClick={() => setChoosing(true)} className={coverButton}>
            Change cover
          </button>
          <CoverRemove page={page} />
        </div>
      )}
      {page && choosing && <CoverChooser page={page} anchor={ref.current} onClose={() => setChoosing(false)} />}
    </div>
  );
}

const coverButton = 'rounded-md bg-black/45 px-2 py-1 text-[12px] text-fg backdrop-blur hover:bg-black/60';

/** @param {{ page: PageData }} props */
function CoverRemove({ page }) {
  const patch = usePatch(page.id);
  return (
    <button type="button" onClick={() => patch.look({ cover: null })} className={coverButton}>
      Remove
    </button>
  );
}

/** Pick a cover preset (they follow the theme's palette). @param {{ page: PageData, anchor: HTMLElement | null, onClose: () => void }} props */
function CoverChooser({ page, anchor, onClose }) {
  const patch = usePatch(page.id);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const cover = page.appearance?.cover ?? null;
  const isImage = cover?.startsWith('asset:') ?? false;

  /** @param {File} file */
  const handleUpload = async (file) => {
    if (!file.type.startsWith('image/')) return;
    setUploading(true);
    try {
      const { url } = await uploadFile(file);
      patch.look({ cover: `asset:${url}` });
      onClose();
    } catch {
      setUploading(false);
    }
  };

  return (
    <Popover anchor={anchor} onClose={onClose} width={340} align="end">
      <div className={menuLabel}>Cover</div>
      <div className="grid grid-cols-4 gap-1.5 p-1" aria-label="Covers">
        {COVERS.map((c) => (
          <button
            key={c.id}
            type="button"
            title={c.name}
            aria-label={`Cover ${c.name}`}
            onClick={() => {
              patch.look({ cover: c.id });
              onClose();
            }}
            className={`page-cover h-12 rounded-md border ${cover === c.id ? 'border-accent' : 'border-line'} hover:border-muted`}
            style={{ backgroundImage: c.css === 'none' ? undefined : c.css }}
          >
            {c.id === 'clear' && <span className="text-[11px] text-muted">Clear (blurred)</span>}
          </button>
        ))}
        {isImage && (
          <button
            type="button"
            title="Custom photo"
            aria-label="Current photo cover"
            onClick={() => onClose()}
            className="page-cover h-12 rounded-md border border-accent"
            style={{ backgroundImage: coverCss(cover) }}
          />
        )}
      </div>
      <div className="border-t border-line px-2 py-2">
        <label
          className={`flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-line text-[12px] text-muted transition-colors hover:border-accent/60 hover:text-fg ${uploading ? 'pointer-events-none opacity-50' : ''}`}
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
              e.target.value = '';
            }}
          />
          {uploading ? 'Uploading…' : '↑ Upload photo'}
        </label>
        <p className="mt-1 text-[11px] text-faint">Covers use your theme's colours.</p>
      </div>
    </Popover>
  );
}

/**
 * Above the title: the icon (click to change), and on hover "Add icon · Add
 * cover · Customise".
 * @param {{ page: PageData }} props
 */
export function PageDecor({ page }) {
  const patch = usePatch(page.id);
  const [open, setOpen] = useState(/** @type {'icon' | 'cover' | 'look' | null} */ (null));
  const iconRef = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const addIconRef = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const coverRef = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const lookRef = useRef(/** @type {HTMLButtonElement | null} */ (null));
  // Opened from the palette, a menu's own button may not be there (e.g. Change cover): anchor on the header.
  const boxRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const covered = hasCover(page);
  const close = () => setOpen(null);
  // The command palette's "Change icon / cover / Customise".
  usePageAction('icon', () => setOpen('icon'));
  usePageAction('cover', () => setOpen('cover'));
  usePageAction('customise', () => setOpen('look'));
  const action = 'flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-faint hover:bg-hover hover:text-muted';

  return (
    <div ref={boxRef} className="group/decor" data-page-decor="">
      {page.icon && (
        <button
          ref={iconRef}
          type="button"
          aria-label="Change icon"
          onClick={() => setOpen('icon')}
          className={`mb-2 flex size-[78px] items-center justify-center rounded-lg text-[64px] leading-none hover:bg-hover ${covered ? '-mt-[76px]' : ''}`}
        >
          {page.icon}
        </button>
      )}
      <div className="-ml-2 flex h-8 items-center gap-0.5 opacity-0 transition-opacity group-hover/decor:opacity-100 focus-within:opacity-100" aria-label="Page appearance">
        {!page.icon && (
          <button ref={addIconRef} type="button" className={action} onClick={() => setOpen('icon')}>
            ☺ Add icon
          </button>
        )}
        {!covered && (
          <button ref={coverRef} type="button" className={action} onClick={() => setOpen('cover')}>
            ▭ Add cover
          </button>
        )}
        <button ref={lookRef} type="button" className={action} onClick={() => setOpen('look')}>
          ◐ Customise
        </button>
      </div>
      {open === 'icon' && (
        <Popover anchor={(page.icon ? iconRef.current : addIconRef.current) ?? boxRef.current} onClose={close} width={340}>
          <Suspense fallback={<div className="h-10" />}>
            <EmojiPicker
              onPick={(e) => {
                patch.icon(e);
                close();
              }}
              onRemove={page.icon ? () => (patch.icon(null), close()) : undefined}
            />
          </Suspense>
        </Popover>
      )}
      {open === 'cover' && <CoverChooser page={page} anchor={coverRef.current ?? boxRef.current} onClose={close} />}
      {open === 'look' && <Customise page={page} anchor={lookRef.current} onClose={close} />}
    </div>
  );
}

/**
 * Layout, font and mood for one page.
 * @param {{ page: PageData, anchor: HTMLElement | null, onClose: () => void }} props
 */
export function Customise({ page, anchor, onClose }) {
  const patch = usePatch(page.id);
  const a = page.appearance ?? {};
  const font = a.font ?? 'sans';
  return (
    <Popover anchor={anchor} onClose={onClose} width={300}>
      <div className={menuLabel}>Font</div>
      <div className="grid grid-cols-3 gap-1 px-1 pb-1">
        {/** @type {const} */ (['sans', 'serif', 'mono']).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={font === f}
            onClick={() => patch.look({ font: f === 'sans' ? null : f })}
            className={`flex flex-col items-center rounded-md border py-1.5 ${font === f ? 'border-accent text-fg-strong' : 'border-line text-muted hover:bg-hover'}`}
          >
            <span className={`text-[20px] leading-7 ${f === 'serif' ? 'font-display' : f === 'mono' ? 'font-mono' : ''}`}>Ag</span>
            <span className="text-[11px] capitalize">{f === 'sans' ? 'Default' : f}</span>
          </button>
        ))}
      </div>
      <button type="button" className={menuItem} onClick={() => patch.look({ fullWidth: a.fullWidth ? null : true })}>
        <span className="flex-1">Full width</span>
        {a.fullWidth && <span className="text-accent">✓</span>}
      </button>
      <button type="button" className={menuItem} onClick={() => patch.look({ smallText: a.smallText ? null : true })}>
        <span className="flex-1">Small text</span>
        {a.smallText && <span className="text-accent">✓</span>}
      </button>
      <div className="my-1 h-px bg-line" />
      <div className={menuLabel}>Mood</div>
      <div className="px-2 pb-1 text-[11px] text-faint">Colours the backdrop while this page is open.</div>
      <div className="flex flex-col gap-0.5 px-1 pb-1">
        <MoodOption label="Your theme" selected={!a.mood} onClick={() => patch.look({ mood: null })} />
        {THEMES.map((t) => (
          <MoodOption key={t.id} label={t.name} swatches={t.swatches} selected={a.mood === t.id} onClick={() => patch.look({ mood: t.id })} />
        ))}
      </div>
    </Popover>
  );
}

/** @param {{ label: string, swatches?: readonly string[], selected: boolean, onClick: () => void }} props */
export function MoodOption({ label, swatches, selected, onClick }) {
  return (
    <button type="button" aria-pressed={selected} onClick={onClick} className={menuItem}>
      <span className="flex -space-x-1">
        {(swatches ?? []).map((c) => (
          <span key={c} className="size-3.5 rounded-full border border-black/40" style={{ background: c }} />
        ))}
        {!swatches && <span className="size-3.5 rounded-full border border-line" />}
      </span>
      <span className="flex-1">{label}</span>
      {selected && <span className="text-accent">✓</span>}
    </button>
  );
}
