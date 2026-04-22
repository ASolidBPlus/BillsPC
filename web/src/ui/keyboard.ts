/**
 * Single global keydown handler for the box browser + comparison overlay.
 *
 * Per PLAN_EVAL S5 A15:
 *   - call event.preventDefault() on Arrow / PageUp / PageDown so the
 *     page does not scroll.
 *   - skip when document.activeElement is an INPUT or TEXTAREA so a
 *     future text input cannot be hijacked.
 *   - mount on Document; the renderer focuses `#app` (tabindex="-1")
 *     after parse so keys flow without an explicit click.
 */
export interface KeyHandlers {
  readonly onArrow?: (drow: -1 | 0 | 1, dcol: -1 | 0 | 1) => void;
  readonly onConfirm?: () => void;
  readonly onCancel?: () => void;
  readonly onPrevBox?: () => void;
  readonly onNextBox?: () => void;
}

const ARROW_DELTA: Record<string, [-1 | 0 | 1, -1 | 0 | 1]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
  w: [-1, 0],
  s: [1, 0],
  a: [0, -1],
  d: [0, 1],
  W: [-1, 0],
  S: [1, 0],
  A: [0, -1],
  D: [0, 1],
};

export function bindKeys(target: Document | HTMLElement, h: KeyHandlers): () => void {
  const listener = (ev: Event): void => {
    const e = ev as KeyboardEvent;
    const ae = (target.ownerDocument ?? document).activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;

    const arrow = ARROW_DELTA[e.key];
    if (arrow && h.onArrow) {
      e.preventDefault();
      h.onArrow(arrow[0], arrow[1]);
      return;
    }
    if (e.key === 'Enter' || e.key === 'z' || e.key === 'Z') {
      h.onConfirm?.();
      return;
    }
    if (e.key === 'Escape' || e.key === 'x' || e.key === 'X') {
      h.onCancel?.();
      return;
    }
    if (e.key === 'PageUp' || e.key === '[') {
      e.preventDefault();
      h.onPrevBox?.();
      return;
    }
    if (e.key === 'PageDown' || e.key === ']') {
      e.preventDefault();
      h.onNextBox?.();
      return;
    }
  };
  target.addEventListener('keydown', listener);
  return () => target.removeEventListener('keydown', listener);
}
