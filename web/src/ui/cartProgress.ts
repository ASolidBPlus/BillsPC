/**
 * Progress overlay rendered inside the source / dest pane during cart
 * reads and writes. A simple text + bar + cancel button.
 */

import { el } from './dom.js';

export interface CartProgressOpts {
  readonly label: string;
  readonly bytesRead: number;
  readonly bytesTotal: number;
  readonly phase?: 'connecting' | 'detecting' | 'reading' | 'parsing';
  readonly onCancel?: () => void;
}

export function cartProgress(opts: CartProgressOpts): HTMLElement {
  const card = el('div', { class: 'card cart-progress' });
  const phaseLine =
    opts.phase === 'connecting'
      ? 'Opening port…'
      : opts.phase === 'detecting'
        ? 'Detecting firmware…'
        : opts.phase === 'parsing'
          ? 'Parsing save…'
          : 'Reading cart…';
  card.append(el('div', { class: 'cart-progress__phase' }, phaseLine));
  const total = Math.max(1, opts.bytesTotal);
  const pct = Math.round((opts.bytesRead / total) * 100);
  const bar = el('div', { class: 'cart-progress__bar' });
  const fill = el('div', { class: 'cart-progress__fill', style: `width:${pct}%` });
  bar.append(fill);
  card.append(bar);
  card.append(
    el(
      'div',
      { class: 'cart-progress__meta' },
      `${pct}% (${opts.bytesRead.toLocaleString()}/${opts.bytesTotal.toLocaleString()} B)`,
    ),
  );
  if (opts.label) card.append(el('div', { class: 'cart-progress__label' }, opts.label));
  if (opts.onCancel) {
    const cancel = el(
      'button',
      { class: 'secondary', type: 'button' },
      'Cancel',
    ) as HTMLButtonElement;
    cancel.addEventListener('click', () => opts.onCancel!());
    card.append(cancel);
  }
  return card;
}
