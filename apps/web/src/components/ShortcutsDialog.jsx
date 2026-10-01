import { useCallback, useEffect, useRef, useState } from 'react';
import { isMac, keyLabel, SHORTCUTS } from '../shortcuts.js';

/**
 * Keyboard shortcuts dialog. Two tabs:
 *  - Reference: searchable list of every shortcut.
 *  - Practice: DDR-style falling-notes game with Web Audio music.
 * @param {{ onClose: () => void }} props
 */
export function ShortcutsDialog({ onClose }) {
  const [tab, setTab] = useState(/** @type {'reference' | 'practice'} */ ('reference'));
  const inGame = tab === 'practice';

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center bg-black/40 px-4 pt-[8vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="papier-popover flex h-fit max-h-[80vh] w-full max-w-[780px] flex-col overflow-hidden"
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          // Swallow all keys in practice mode so global handlers don't fire.
          if (inGame && e.key !== 'Escape') e.stopPropagation();
        }}
      >
        <div className="flex items-center gap-2 border-b border-line px-4">
          <h2 className="shrink-0 text-[15px] font-semibold text-fg-strong">Keyboard shortcuts</h2>
          <div className="flex flex-1 gap-1 py-1.5">
            <TabBtn active={tab === 'reference'} onClick={() => setTab('reference')}>Reference</TabBtn>
            <TabBtn active={tab === 'practice'} onClick={() => setTab('practice')}>🕹 Practice</TabBtn>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg">×</button>
        </div>
        {tab === 'reference' ? <ReferenceTab /> : <DDRTab />}
      </div>
    </div>
  );
}

/** @param {{ active: boolean, onClick: () => void, children: import('react').ReactNode }} props */
function TabBtn({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-[13px] transition-colors ${active ? 'bg-s-active text-fg-strong' : 'text-muted hover:text-fg'}`}
    >
      {children}
    </button>
  );
}

// ─── Reference Tab ────────────────────────────────────────────────────────────

function ReferenceTab() {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const groups = SHORTCUTS.map((g) => ({
    ...g,
    items: g.items.filter((s) => !query || s.label.toLowerCase().includes(query) || s.keys.some((k) => keyLabel(k).toLowerCase().includes(query))),
  })).filter((g) => g.items.length);

  return (
    <>
      <div className="border-b border-line/50 px-4">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter shortcuts…"
          aria-label="Filter shortcuts"
          style={{ outline: 'none' }}
          className="h-10 w-full bg-transparent text-[14px] text-fg placeholder:text-faint"
        />
      </div>
      <div className="grid min-h-0 gap-x-8 gap-y-5 overflow-y-auto px-5 py-4 sm:grid-cols-2">
        {groups.length === 0 && <p className="text-[14px] text-muted">No shortcut matches "{q}".</p>}
        {groups.map((g) => (
          <section key={g.group} aria-label={g.group}>
            <h3 className="mb-1.5 text-[11px] font-medium tracking-wide text-faint uppercase">{g.group}</h3>
            <ul className="flex flex-col">
              {g.items.map((s) => (
                <li key={s.label} className="flex items-center justify-between gap-3 border-b border-line/60 py-1.5 last:border-b-0">
                  <span className="text-[13px] text-fg">{s.label}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {s.keys.map((k, i) => (
                      <kbd
                        key={i}
                        className={`min-w-[22px] rounded-[5px] border border-line bg-white/[0.05] px-1.5 py-px text-center text-[12px] text-fg-strong ${s.typed ? 'font-mono' : 'font-sans'}`}
                      >
                        {keyLabel(k)}
                      </kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

// ─── DDR Practice Tab ─────────────────────────────────────────────────────────

const LANE_COUNT = 4;
const GAME_H = 480;
const NOTE_SPEED = 110; // px/s
const HIT_Y = GAME_H - 72; // centre of the hit zone
const HIT_WINDOW = 52; // ±px that counts as "in zone"
const SPAWN_MS = 2000; // spawn interval
const BPM = 132;

/** Shortcuts eligible for the game (no markdown/mouse shortcuts). */
const POOL = SHORTCUTS.flatMap((g) => g.items).filter(
  (s) => !s.typed && !s.keys.some((k) => k === 'Right-click' || k === 'Mod+Click'),
);

/** Normalize shortcut keys to a canonical sorted string for comparison. */
function normalizeExpected(/** @type {string[]} */ keys) {
  return keys
    .map((k) => (k === 'Mod' ? (isMac ? 'Meta' : 'Control') : k))
    .sort()
    .join('+');
}

/** Normalize a pressed KeyboardEvent to the same format; returns null for bare modifiers. */
function normalizePressed(/** @type {KeyboardEvent} */ e) {
  if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) return null;
  const parts = [];
  if (e.ctrlKey) parts.push('Control');
  if (e.metaKey) parts.push('Meta');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
  return parts.sort().join('+');
}

// Lane accent colours (variants on the Sky accent)
const LANE_HUE = ['#7BB2D9', '#91C4A8', '#C4A88E', '#A891C4'];

/**
 * Generates a bar of DDR-style percussion/bass in the Web Audio context.
 * @param {AudioContext} ctx
 * @param {number} t - AudioContext time to start this bar
 */
function scheduleBar(ctx, t) {
  const beat = 60 / BPM;
  // Kick: beats 1 & 3
  for (const b of [0, 2]) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, t + b * beat);
    osc.frequency.exponentialRampToValueAtTime(28, t + b * beat + 0.12);
    g.gain.setValueAtTime(0.9, t + b * beat);
    g.gain.exponentialRampToValueAtTime(0.001, t + b * beat + 0.13);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(t + b * beat); osc.stop(t + b * beat + 0.14);
  }
  // Snare: beats 2 & 4
  for (const b of [1, 3]) {
    const len = Math.floor(ctx.sampleRate * 0.08);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * ((1 - i / len) ** 1.4);
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    src.buffer = buf;
    g.gain.setValueAtTime(0.38, t + b * beat);
    src.connect(g); g.connect(ctx.destination);
    src.start(t + b * beat);
  }
  // Hi-hat: 8th notes
  for (let i = 0; i < 8; i++) {
    const len = Math.floor(ctx.sampleRate * 0.025);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let j = 0; j < len; j++) d[j] = (Math.random() * 2 - 1) * ((1 - j / len) ** 2.2);
    const src = ctx.createBufferSource();
    const filt = ctx.createBiquadFilter();
    const g = ctx.createGain();
    filt.type = 'highpass'; filt.frequency.value = 8000;
    g.gain.setValueAtTime(i % 2 === 0 ? 0.1 : 0.055, t + i * beat / 2);
    src.connect(filt); filt.connect(g); g.connect(ctx.destination);
    src.start(t + i * beat / 2);
  }
  // Synth bass: 4-note riff (A2 A2 C#3 D3)
  for (const [i, freq] of /** @type {[number, number][]} */ ([[0, 110], [1, 110], [2, 138.6], [3, 146.8]])) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, t + i * beat);
    g.gain.linearRampToValueAtTime(0.13, t + i * beat + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + i * beat + beat * 0.85);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(t + i * beat); osc.stop(t + i * beat + beat);
  }
  // Synth lead arpeggio (A4 C#5 E5 A5 every half-beat)
  for (const [i, freq] of /** @type {[number, number][]} */ ([[0, 440], [1, 554.4], [2, 659.3], [3, 880], [4, 659.3], [5, 554.4], [6, 440], [7, 369.9]])) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, t + i * beat / 2);
    g.gain.linearRampToValueAtTime(0.045, t + i * beat / 2 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + i * beat / 2 + beat / 2 * 0.7);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(t + i * beat / 2); osc.stop(t + i * beat / 2 + beat / 2);
  }
}

// ── DDRTab component ──────────────────────────────────────────────────────────

function DDRTab() {
  /** @typedef {{ id: number, shortcut: import('../shortcuts.js').Shortcut, lane: number, y: number, state: 'falling'|'wrong'|'hit' }} Note */
  /** @typedef {{ id: number, text: string, lane: number, tier: 'perfect'|'good'|'miss' }} Float */

  const [phase, setPhase] = useState(/** @type {'idle'|'playing'|'over'} */ ('idle'));
  const [notes, setNotes] = useState(/** @type {Note[]} */ ([]));
  const [floats, setFloats] = useState(/** @type {Float[]} */ ([]));
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [health, setHealth] = useState(100);

  const audioRef = useRef(/** @type {AudioContext | null} */ (null));
  const frameRef = useRef(/** @type {number | undefined} */ (undefined));
  const lastTRef = useRef(0);
  const nextSpawnRef = useRef(0);
  const noteIdRef = useRef(0);
  const floatIdRef = useRef(0);

  // Stable refs for game loop (avoids stale closure issues)
  const notesRef = useRef(notes);
  const comboRef = useRef(combo);
  const healthRef = useRef(health);
  const phaseRef = useRef(phase);
  notesRef.current = notes;
  comboRef.current = combo;
  healthRef.current = health;
  phaseRef.current = phase;

  // ── Music ──
  const startMusic = useCallback(() => {
    const ctx = new AudioContext();
    audioRef.current = ctx;
    const loop = () => {
      if (audioRef.current !== ctx) return;
      scheduleBar(ctx, ctx.currentTime + 0.05);
      const barMs = (4 * 60 / BPM) * 1000;
      setTimeout(loop, barMs - 80);
    };
    ctx.resume().then(loop);
  }, []);

  const stopMusic = useCallback(() => {
    audioRef.current?.close();
    audioRef.current = null;
  }, []);

  // ── Spawn helper ──
  const spawnNote = useCallback(() => {
    const used = new Set(notesRef.current.map((n) => n.lane));
    const free = Array.from({ length: LANE_COUNT }, (_, i) => i).filter((l) => !used.has(l));
    if (!free.length) return null;
    const lane = free[Math.floor(Math.random() * free.length)];
    const shortcut = POOL[Math.floor(Math.random() * POOL.length)];
    return /** @type {Note} */ ({ id: noteIdRef.current++, shortcut, lane, y: -90, state: 'falling' });
  }, []);

  // ── Float helper ──
  const addFloat = useCallback((/** @type {string} */ text, /** @type {number} */ lane, /** @type {Float['tier']} */ tier) => {
    const id = floatIdRef.current++;
    setFloats((prev) => [...prev, { id, text, lane, tier }]);
    setTimeout(() => setFloats((prev) => prev.filter((f) => f.id !== id)), 950);
  }, []);

  // ── Game loop ──
  useEffect(() => {
    if (phase !== 'playing') return;
    lastTRef.current = performance.now();
    nextSpawnRef.current = performance.now() + 600;

    const tick = (/** @type {number} */ now) => {
      const dt = Math.min((now - lastTRef.current) / 1000, 0.05);
      lastTRef.current = now;

      if (now >= nextSpawnRef.current) {
        nextSpawnRef.current = now + SPAWN_MS;
        const n = spawnNote();
        if (n) setNotes((prev) => [...prev, n]);
      }

      let healthLoss = 0;
      let comboBroke = false;

      setNotes((prev) => {
        const next = prev
          .map((n) => {
            if (n.state !== 'falling') return n;
            const y = n.y + NOTE_SPEED * dt;
            if (y > HIT_Y + HIT_WINDOW + 14) {
              healthLoss += 15;
              comboBroke = true;
              addFloat('MISS', n.lane, 'miss');
              return { ...n, y, state: /** @type {'hit'} */ ('hit') }; // mark for removal
            }
            return { ...n, y };
          })
          .filter((n) => n.state !== 'hit' || n.y <= HIT_Y + HIT_WINDOW + 14);
        // Actually filter out missed ones:
        return next.filter((n) => !(n.state === 'hit'));
      });

      if (comboBroke) setCombo(0);
      if (healthLoss > 0) {
        setHealth((h) => {
          const v = Math.max(0, h - healthLoss);
          if (v === 0) setPhase('over');
          return v;
        });
      }

      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => { if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current); };
  }, [phase, spawnNote, addFloat]);

  // ── Key handler (capture phase so global shortcuts don't fire) ──
  useEffect(() => {
    if (phase !== 'playing') return;

    const onKey = (/** @type {KeyboardEvent} */ e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const pressed = normalizePressed(e);
      if (!pressed) return;

      const inZone = notesRef.current.find(
        (n) => n.state === 'falling' && n.y >= HIT_Y - HIT_WINDOW && n.y <= HIT_Y + HIT_WINDOW,
      );
      if (!inZone) return;

      const expected = normalizeExpected(inZone.shortcut.keys);
      if (pressed === expected) {
        const perfect = Math.abs(inZone.y - HIT_Y) < 22;
        const tier = /** @type {'perfect'|'good'} */ (perfect ? 'perfect' : 'good');
        const pts = perfect ? 300 : 150;
        const newCombo = comboRef.current + 1;
        setScore((s) => s + pts * Math.max(1, Math.floor(newCombo / 5)));
        setCombo(newCombo);
        addFloat(perfect ? 'PERFECT!' : 'GOOD!', inZone.lane, tier);
        setNotes((prev) => prev.filter((n) => n.id !== inZone.id));
      } else {
        setCombo(0);
        setNotes((prev) => prev.map((n) => (n.id === inZone.id ? { ...n, state: 'wrong' } : n)));
        setTimeout(
          () => setNotes((prev) => prev.map((n) => (n.id === inZone.id ? { ...n, state: 'falling' } : n))),
          240,
        );
      }
    };

    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [phase, addFloat]);

  // ── Cleanup on unmount ──
  useEffect(() => () => { if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current); stopMusic(); }, [stopMusic]);

  // ── Start / restart ──
  const startGame = useCallback(() => {
    if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
    stopMusic();
    setNotes([]); setFloats([]); setScore(0); setCombo(0); setHealth(100);
    noteIdRef.current = 0; floatIdRef.current = 0;
    setPhase('playing');
    startMusic();
  }, [startMusic, stopMusic]);

  const quitGame = useCallback(() => {
    if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
    stopMusic();
    setNotes([]); setFloats([]);
    setPhase('idle');
  }, [stopMusic]);

  // ── Render ──
  if (phase === 'idle') return <DDRStartScreen onStart={startGame} />;
  if (phase === 'over') return <DDRGameOver score={score} onRestart={startGame} onBack={quitGame} />;

  const laneW = 100 / LANE_COUNT;

  return (
    <div className="flex flex-col overflow-hidden" style={{ background: 'rgba(0,0,0,0.55)' }}>
      {/* HUD */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <div className="flex items-center gap-4">
          <span className="font-mono text-[15px] font-semibold text-fg-strong tabular-nums">{score.toLocaleString()}</span>
          {combo > 1 && (
            <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[12px] font-semibold text-accent">×{combo}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full transition-[width] duration-300"
              style={{
                width: `${health}%`,
                background: health > 50 ? '#7BB2D9' : health > 25 ? '#d49a52' : '#e05252',
              }}
            />
          </div>
          <button type="button" onClick={quitGame} className="text-[11px] text-faint hover:text-muted">
            quit
          </button>
        </div>
      </div>

      {/* Game field */}
      <div className="relative overflow-hidden" style={{ height: GAME_H }}>
        {/* Lane dividers */}
        {Array.from({ length: LANE_COUNT - 1 }, (_, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 w-px"
            style={{ left: `${(i + 1) * laneW}%`, background: 'rgba(255,255,255,0.04)' }}
          />
        ))}

        {/* Scanline effect */}
        <div
          className="pointer-events-none absolute inset-0 z-10"
          style={{ background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.06) 2px, rgba(0,0,0,0.06) 4px)' }}
        />

        {/* Hit zone line */}
        <div
          className="absolute left-0 right-0 z-20"
          style={{ top: HIT_Y, height: 2, background: 'rgba(123,178,217,0.45)', boxShadow: '0 0 10px 3px rgba(123,178,217,0.25)' }}
        />

        {/* Lane targets (glow on approach) */}
        {Array.from({ length: LANE_COUNT }, (_, i) => {
          const approaching = notes.some(
            (n) => n.lane === i && n.state === 'falling' && n.y >= HIT_Y - HIT_WINDOW - 10,
          );
          const color = LANE_HUE[i];
          return (
            <div
              key={i}
              className="absolute z-20 flex items-center justify-center rounded-lg transition-all duration-100"
              style={{
                left: `calc(${i * laneW}% + 5px)`,
                width: `calc(${laneW}% - 10px)`,
                top: HIT_Y - 18,
                height: 36,
                border: `1px solid ${approaching ? color + '88' : 'rgba(255,255,255,0.07)'}`,
                background: approaching ? color + '18' : 'transparent',
                boxShadow: approaching ? `0 0 12px ${color}44` : 'none',
              }}
            />
          );
        })}

        {/* Falling note cards */}
        {notes.map((note) => {
          const color = LANE_HUE[note.lane];
          const inZone = note.y >= HIT_Y - HIT_WINDOW;
          const isWrong = note.state === 'wrong';
          return (
            <div
              key={note.id}
              className="absolute z-30 flex flex-col items-center justify-center overflow-hidden rounded-xl px-2 py-1.5 text-center transition-colors"
              style={{
                left: `calc(${note.lane * laneW}% + 5px)`,
                width: `calc(${laneW}% - 10px)`,
                top: note.y - 38,
                height: 76,
                background: isWrong ? 'rgba(220,60,60,0.28)' : inZone ? `${color}22` : 'rgba(255,255,255,0.05)',
                border: `1px solid ${isWrong ? 'rgba(220,60,60,0.5)' : inZone ? color + '55' : 'rgba(255,255,255,0.08)'}`,
                boxShadow: inZone && !isWrong ? `0 0 16px ${color}30` : 'none',
              }}
            >
              <span
                className="line-clamp-2 text-[11px] font-medium leading-tight"
                style={{ color: isWrong ? '#e08080' : inZone ? color : '#9a9a9a' }}
              >
                {note.shortcut.label}
              </span>
              {inZone && (
                <span className="mt-0.5 flex gap-0.5">
                  {note.shortcut.keys.map((k, ki) => (
                    <kbd
                      key={ki}
                      className="rounded-[3px] px-1 py-px text-[9px] font-sans"
                      style={{ background: `${color}22`, border: `1px solid ${color}44`, color }}
                    >
                      {keyLabel(k)}
                    </kbd>
                  ))}
                </span>
              )}
            </div>
          );
        })}

        {/* Floating hit ratings */}
        {floats.map((f) => (
          <div
            key={f.id}
            className="pointer-events-none absolute z-40 text-[13px] font-bold"
            style={{
              left: `${f.lane * laneW + laneW / 2}%`,
              top: HIT_Y - 50,
              transform: 'translateX(-50%)',
              color: f.tier === 'perfect' ? '#7BB2D9' : f.tier === 'good' ? '#8bc48b' : '#e05252',
              animation: 'ddr-float 0.95s ease-out forwards',
            }}
          >
            {f.text}
          </div>
        ))}
      </div>

      {/* Hint strip */}
      <div className="border-t border-white/5 px-4 py-2 text-center text-[12px] text-faint">
        Type the shortcut when the card reaches the glowing bar
      </div>
    </div>
  );
}

/** @param {{ onStart: () => void }} props */
function DDRStartScreen({ onStart }) {
  return (
    <div className="flex flex-col items-center gap-6 px-8 py-12 text-center">
      <div className="text-4xl">🕹</div>
      <div>
        <h3 className="text-[17px] font-semibold text-fg-strong">Shortcut Trainer</h3>
        <p className="mt-1 text-[13px] text-muted">Shortcut cards fall in 4 lanes. When a card reaches the hit zone, type the combo shown on it. Perfect timing scores more!</p>
      </div>
      <div className="flex gap-3 text-[12px] text-faint">
        <span className="flex items-center gap-1"><span style={{ color: '#7BB2D9' }}>●</span> PERFECT +300×</span>
        <span className="flex items-center gap-1"><span style={{ color: '#8bc48b' }}>●</span> GOOD +150</span>
        <span className="flex items-center gap-1"><span style={{ color: '#e05252' }}>●</span> MISS −15hp</span>
      </div>
      <button
        type="button"
        autoFocus
        onClick={onStart}
        className="rounded-xl bg-accent/20 px-8 py-3 text-[15px] font-semibold text-accent hover:bg-accent/30 focus-visible:ring-1 focus-visible:ring-accent"
      >
        Start Game
      </button>
    </div>
  );
}

/** @param {{ score: number, onRestart: () => void, onBack: () => void }} props */
function DDRGameOver({ score, onRestart, onBack }) {
  return (
    <div className="flex flex-col items-center gap-6 px-8 py-12 text-center">
      <div className="text-4xl">💀</div>
      <div>
        <h3 className="text-[17px] font-semibold text-fg-strong">Game Over</h3>
        <p className="mt-1 text-[13px] text-muted">Final score</p>
        <p className="mt-2 font-mono text-[28px] font-bold text-accent">{score.toLocaleString()}</p>
      </div>
      <div className="flex gap-3">
        <button type="button" autoFocus onClick={onRestart} className="rounded-xl bg-accent/20 px-6 py-2.5 text-[14px] font-semibold text-accent hover:bg-accent/30">
          Play again
        </button>
        <button type="button" onClick={onBack} className="rounded-xl border border-white/10 px-6 py-2.5 text-[14px] text-muted hover:bg-s-active hover:text-fg">
          Back
        </button>
      </div>
    </div>
  );
}
