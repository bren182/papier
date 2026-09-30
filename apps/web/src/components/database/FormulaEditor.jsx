import { useMemo, useRef, useState } from 'react';
import { analyzeFormula, FUNCTIONS, propFormulaType, signature } from '@papier/core/formula';
import { TypeIcon } from './meta.jsx';
import { field } from './Popover.jsx';

/**
 * Write a formula with a live check ("→ number", or what's wrong and where),
 * chips that insert properties, and the function reference — the guide to
 * the language (@papier/core formula.js).
 *
 * @typedef {import('./context.js').Property} Property
 * @param {{ value: string, onChange: (src: string) => void, properties: Property[], rows?: number, reference?: boolean }} props
 *   reference: show the function list (off in tight spots like button actions)
 */
export function FormulaEditor({ value, onChange, properties, rows = 3, reference = true }) {
  const ref = useRef(/** @type {HTMLTextAreaElement | null} */ (null));
  const [q, setQ] = useState('');
  const usable = properties.filter((p) => propFormulaType(p) !== null);
  const check = useMemo(() => {
    if (!value.trim()) return null;
    /** @param {string} name */
    const typeOf = (name) => {
      const p = properties.find((x) => x.name === name) ?? properties.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (p) return propFormulaType(p);
      return ['name', 'title'].includes(name.toLowerCase()) ? 'text' : undefined;
    };
    return analyzeFormula(value, typeOf);
  }, [value, properties]);

  /** Put text at the cursor (replacing a selection) and keep typing after it. @param {string} text */
  const insert = (text) => {
    const el = ref.current;
    const [a, b] = el ? [el.selectionStart, el.selectionEnd] : [value.length, value.length];
    const next = value.slice(0, a) + text + value.slice(b);
    onChange(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(a + text.length, a + text.length);
    });
  };

  const words = q.trim().toLowerCase();
  const fns = Object.entries(FUNCTIONS).filter(([name, f]) => !words || `${name} ${f.doc} ${f.group}`.toLowerCase().includes(words));

  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        ref={ref}
        value={value}
        rows={rows}
        spellCheck={false}
        aria-label="Formula"
        placeholder='e.g. if(prop("Done"), "✓", "")'
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        className={`${field} h-auto resize-y py-1.5 font-mono text-[12.5px] leading-5`}
      />
      <div className="min-h-5 px-1 text-[12px]" aria-live="polite">
        {!check ? (
          <span className="text-faint">Refer to properties as prop("Name"). Functions are listed below.</span>
        ) : check.ok ? (
          <span className="text-muted">
            → <span className="text-fg">{check.type === 'boolean' ? 'true / false' : check.type}</span>
          </span>
        ) : (
          <span className="text-fg-strong">
            {check.error}
            <Caret src={value} pos={check.pos} />
          </span>
        )}
      </div>
      {usable.length > 0 && (
        <div className="flex flex-wrap gap-1 px-0.5" aria-label="Insert a property">
          {[{ id: 'title', name: 'Name', type: 'title' }, ...usable].map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => insert(`prop("${p.name}")`)}
              className="flex h-6 items-center gap-1 rounded bg-white/[0.06] px-1.5 text-[12px] text-fg hover:bg-white/[0.12]"
            >
              <TypeIcon type={p.type} size={12} /> {p.name}
            </button>
          ))}
        </div>
      )}
      {reference && (
        <div className="flex flex-col gap-1 border-t border-line pt-1.5">
          <input
            value={q}
            placeholder="Search functions…"
            aria-label="Search functions"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            className={`${field} h-6`}
          />
          <div className="max-h-[180px] overflow-y-auto" aria-label="Functions">
            {fns.map(([name, f]) => (
              <button
                key={name}
                type="button"
                onClick={() => insert(`${name}(`)}
                title={`Example: ${f.example}`}
                className="flex w-full flex-col rounded-md px-1.5 py-1 text-left hover:bg-hover"
              >
                <span className="font-mono text-[12px] text-fg">{signature(name)}</span>
                <span className="text-[11.5px] leading-4 text-muted">{f.doc}</span>
                <span className="font-mono text-[11px] text-faint">{f.example}</span>
              </button>
            ))}
            {!fns.length && <div className="px-1.5 py-1 text-[12px] text-muted">No function matches.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/** A glimpse of the source around an error, with a caret under the spot. @param {{ src: string, pos: number }} props */
function Caret({ src, pos }) {
  const start = Math.max(0, pos - 24);
  const snippet = src.slice(start, pos + 24).replace(/\n/g, ' ');
  return (
    <span className="mt-0.5 block font-mono text-[11.5px] leading-4 whitespace-pre text-muted">
      {start > 0 ? '…' : ''}
      {snippet}
      {'\n'}
      {' '.repeat(pos - start + (start > 0 ? 1 : 0))}
      <span className="text-accent">^</span>
    </span>
  );
}
