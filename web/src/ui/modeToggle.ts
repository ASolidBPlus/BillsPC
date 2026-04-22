/**
 * `[Upload Mode] [Cart Mode]` segmented control rendered above the
 * panes-grid. Per orchestrator decision Q2 + PLAN §6.1: the toggle is
 * GLOBAL (swaps both panes simultaneously), and switching modes is
 * non-destructive (state for the inactive mode is preserved).
 */

import { el } from './dom.js';
import { FALLBACK_TOOLTIP } from '../cart/browserCompat.js';

export type Mode = 'upload' | 'cart';

export interface ModeToggleOpts {
  readonly mode: Mode;
  readonly cartAvailable: boolean;
  readonly onModeChange: (next: Mode) => void;
  readonly onDisabledClick?: () => void;
}

export function modeToggle(opts: ModeToggleOpts): HTMLElement {
  const wrap = el('div', { class: 'mode-toggle' });
  const upload = button('Upload Mode', opts.mode === 'upload', false, () => {
    if (opts.mode !== 'upload') opts.onModeChange('upload');
  });
  const cart = button(
    'Cart Mode',
    opts.mode === 'cart',
    !opts.cartAvailable,
    () => {
      if (!opts.cartAvailable) {
        opts.onDisabledClick?.();
        return;
      }
      if (opts.mode !== 'cart') opts.onModeChange('cart');
    },
    !opts.cartAvailable ? FALLBACK_TOOLTIP : undefined,
  );
  wrap.append(upload, cart);
  return wrap;
}

function button(
  label: string,
  active: boolean,
  disabled: boolean,
  onClick: () => void,
  title?: string,
): HTMLButtonElement {
  const cls = ['mode-toggle__btn'];
  if (active) cls.push('is-active');
  if (disabled) cls.push('is-disabled');
  const b = el('button', { class: cls.join(' '), type: 'button' }, label) as HTMLButtonElement;
  // We use aria-disabled (not the HTMLButton `disabled` attribute) so that
  // clicks still fire — the onDisabledClick callback opens the explainer
  // dialog. The visual styling lives on `.is-disabled`.
  if (disabled) b.setAttribute('aria-disabled', 'true');
  if (title) b.setAttribute('title', title);
  b.addEventListener('click', () => {
    onClick();
  });
  return b;
}
