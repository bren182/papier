import { useRef } from 'react';

const SLOP = 8; // px — distance a touch can travel before the click is suppressed

/**
 * Returns props to spread on a clickable element. Suppresses the click if the
 * pointer moved more than SLOP pixels between pointerdown and click, which
 * means the gesture was a scroll, not a tap.
 * @param {((e: import('react').MouseEvent) => void) | undefined} [onClick]
 * @returns {{ onPointerDown: (e: import('react').PointerEvent) => void, onPointerMove: (e: import('react').PointerEvent) => void, onClick: (e: import('react').MouseEvent) => void }}
 */
export function useTapGuard(onClick) {
  const start = useRef(/** @type {{ x: number, y: number } | null} */ (null));
  const moved = useRef(false);

  return {
    onPointerDown(e) {
      start.current = { x: e.clientX, y: e.clientY };
      moved.current = false;
    },
    onPointerMove(e) {
      if (!start.current) return;
      const dx = e.clientX - start.current.x;
      const dy = e.clientY - start.current.y;
      if (dx * dx + dy * dy > SLOP * SLOP) moved.current = true;
    },
    onClick(e) {
      if (moved.current) { e.preventDefault(); e.stopPropagation(); return; }
      onClick?.(e);
    },
  };
}
