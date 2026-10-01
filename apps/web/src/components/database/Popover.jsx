import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * A menu/popover anchored below an element, portalled to <body> so it escapes
 * the table's overflow and the editor. Closes on outside mousedown or Escape.
 * @param {{ anchor: HTMLElement | null, onClose: () => void, children: import('react').ReactNode,
 *   width?: number, className?: string, align?: 'start' | 'end' }} props
 */
export function Popover({ anchor, onClose, children, width = 240, className = '', align = 'start' }) {
  const ref = useRef(/** @type {HTMLDivElement | null} */ (null));
  const [pos, setPos] = useState(/** @type {{ top: number, left: number, maxHeight: number } | null} */ (null));

  useLayoutEffect(() => {
    if (!anchor) return;
    // Below the anchor if it fits, else above; if neither, on the roomier side,
    // capped to the viewport and scrolling inside.
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const h = ref.current?.scrollHeight ?? 0;
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const top = h <= below || below >= above ? r.bottom + 4 : Math.max(8, r.top - Math.min(h, above) - 4);
      const maxHeight = h <= below || below >= above ? below : above;
      const left = align === 'end' ? r.right - width : r.left;
      setPos({ top, left: Math.max(8, Math.min(left, window.innerWidth - width - 8)), maxHeight: Math.max(120, maxHeight) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    // Content can grow after opening (a formula's check, a menu that expands).
    const observer = new ResizeObserver(place);
    if (ref.current?.firstElementChild) observer.observe(ref.current.firstElementChild);
    if (ref.current) observer.observe(ref.current);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      observer.disconnect();
    };
  }, [anchor, width, align]);

  useEffect(() => {
    /** @param {MouseEvent} e */
    const onDown = (e) => {
      const t = /** @type {Node} */ (e.target);
      // Nested popovers are portalled siblings; clicks inside any of them stay open.
      if (ref.current?.contains(t) || anchor?.contains(t) || (t instanceof Element && t.closest('[data-popover]') && !ref.current?.contains(t) && isAbove(ref.current, t))) return;
      onClose();
    };
    /** @param {KeyboardEvent} e */
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // Only the topmost popover closes.
      const all = document.querySelectorAll('[data-popover]');
      if (all[all.length - 1] === ref.current) {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref}
      data-popover=""
      className={`papier-popover fixed z-50 overflow-y-auto overscroll-contain p-1 ${className}`}
      style={{ width, top: pos?.top ?? -9999, left: pos?.left ?? -9999, maxHeight: pos?.maxHeight }}
      // Keep ProseMirror (inline databases) from treating these as editor events.
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

/** Whether popover `b` was opened after `a` (later in the DOM = on top). @param {Element | null} a @param {Node} t */
function isAbove(a, t) {
  const b = t instanceof Element ? t.closest('[data-popover]') : null;
  return Boolean(a && b && a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

export const menuItem = 'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] text-fg hover:bg-hover disabled:opacity-40';
export const menuLabel = 'px-2 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-faint uppercase';
export const field = 'h-7 w-full rounded-md border border-line bg-root/60 px-2 text-[13px] text-fg outline-none focus:border-accent appearance-none cursor-pointer';

/**
 * A styled <select> that replaces the OS dropdown arrow with our own.
 * @param {{ className?: string } & import('react').SelectHTMLAttributes<HTMLSelectElement>} props
 */
export function FieldSelect({ className = '', children, ...props }) {
  return (
    <span className={`relative inline-flex ${className}`}>
      <select {...props} className={`${field} w-full pr-6`}>
        {children}
      </select>
      <svg
        className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-muted"
        width="10" height="10" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" strokeWidth="2.5"
        strokeLinecap="round" strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </span>
  );
}
