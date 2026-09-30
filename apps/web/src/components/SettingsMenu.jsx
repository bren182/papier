import { THEMES } from '@papier/ui';
import { menuItem, menuLabel, Popover } from './database/Popover.jsx';
import { MoodOption } from './PageHeader.jsx';

/**
 * Display settings (this device): colour theme, ambient or grayscale, glass,
 * motion. The same prefs the top bar toggles.
 * @param {{ anchor: HTMLElement | null, onClose: () => void, prefs: import('../usePrefs.js').Prefs,
 *   onChange: (patch: Partial<import('../usePrefs.js').Prefs>) => void }} props
 */
export function SettingsMenu({ anchor, onClose, prefs, onChange }) {
  const toggle = (/** @type {string} */ label, /** @type {boolean} */ on, /** @type {() => void} */ flip) => (
    <button type="button" className={menuItem} onClick={flip} aria-pressed={on}>
      <span className="flex-1">{label}</span>
      {on && <span className="text-accent">✓</span>}
    </button>
  );
  return (
    <Popover anchor={anchor} onClose={onClose} width={260}>
      <div className={menuLabel}>Theme</div>
      <div className="flex flex-col gap-0.5 px-1 pb-1" aria-label="Themes">
        {THEMES.map((t) => (
          <MoodOption key={t.id} label={t.name} swatches={t.swatches} selected={prefs.theme === t.id} onClick={() => onChange({ theme: t.id })} />
        ))}
      </div>
      <div className="px-2 pb-1 text-[11px] text-faint">A page can set its own mood (Customise, above its title).</div>
      <div className="my-1 h-px bg-line" />
      <div className={menuLabel}>Display</div>
      {toggle('Grayscale backdrop', prefs.mode === 'grayscale', () => onChange({ mode: prefs.mode === 'grayscale' ? 'ambient' : 'grayscale' }))}
      {prefs.mode === 'ambient' && toggle('Clear glass', prefs.glass === 'clear', () => onChange({ glass: prefs.glass === 'clear' ? 'frosted' : 'clear' }))}
      {toggle('Motion', prefs.motion, () => onChange({ motion: !prefs.motion }))}
    </Popover>
  );
}
