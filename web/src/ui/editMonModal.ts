/**
 * S10 — manual edit modal for Gen 3 mons.
 *
 * Stage 1: stub shell — opens a placeholder. Stage 2 swaps in the real
 * form (PID/TID/SID/IVs/OT-name with live-derived shiny/nature/ability
 * + confirm-dialog wrapper for impossible combos).
 */

import type { Gen3MonEdits } from '../state.js';
import { el } from './dom.js';

export interface EditMonModalOpts {
  readonly currentSlot: Uint8Array;
  readonly boxIndex: number;
  readonly slot: number;
  readonly onApply: (edits: Gen3MonEdits) => void;
  readonly onCancel: () => void;
}

export function openEditMonModal(opts: EditMonModalOpts): void {
  // S10 Stage 2 will replace this with the real form. The stage-1 stub
  // is enough to prove the click → modal wiring works.
  for (const node of Array.from(document.body.querySelectorAll('.edit-mon-overlay'))) {
    node.remove();
  }
  const overlay = el('div', { class: 'edit-mon-overlay' });
  const inner = el('div', { class: 'edit-mon-inner card' });
  inner.append(
    el('div', { class: 'edit-mon-title' }, 'EDIT MON (stub — Stage 2 form pending)'),
    el(
      'div',
      { class: 'edit-mon-meta' },
      `box ${opts.boxIndex + 1} slot ${opts.slot + 1} (${opts.currentSlot.length} bytes)`,
    ),
  );
  const close = (): void => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') close();
  }
  const cancel = el(
    'button',
    { type: 'button', class: 'secondary' },
    'Cancel',
  ) as HTMLButtonElement;
  cancel.addEventListener('click', () => {
    close();
    opts.onCancel();
  });
  inner.append(cancel);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      close();
      opts.onCancel();
    }
  });
  document.addEventListener('keydown', onKey);
  overlay.append(inner);
  document.body.append(overlay);
}
