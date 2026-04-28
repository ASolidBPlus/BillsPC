/**
 * Cart-flash progress overlay. Shown ON TOP of the cart pane during a
 * write. Per PLAN §10:
 *   - Big "DO NOT UNPLUG" banner (red).
 *   - Phase + progress (sector / bytes-written).
 *   - Disappears on cart_flash_succeeded; replaced by recoveryDialog on
 *     cart_flash_failed.
 */

import type { CartFlashState } from '../state.js';
import { dialog } from './dialog.js';
import { el } from './dom.js';

export interface FlashProgressOverlayProps {
  readonly state: Extract<CartFlashState, { kind: 'cart_flash_progressing' | 'cart_flash_pending' | 'cart_recovery_progressing' }>;
}

export function flashProgressOverlay(props: FlashProgressOverlayProps): HTMLElement {
  const wrap = dialog({ class: 'gen2-dialog flash-progress-overlay' });
  wrap.append(
    el('div', { class: 'gen2-line do-not-unplug' }, 'DO NOT UNPLUG'),
    el(
      'div',
      { class: 'gen2-line subtitle' },
      'Cart write in progress. Disconnecting now may corrupt your save.',
    ),
  );

  if (props.state.kind === 'cart_flash_pending') {
    wrap.append(el('div', { class: 'gen2-line phase' }, 'Connecting to cart…'));
  } else if (props.state.kind === 'cart_recovery_progressing') {
    wrap.append(
      el('div', { class: 'gen2-line phase' }, `Restoring from backup: ${props.state.backupFilename}`),
    );
    if (props.state.progress) {
      wrap.append(renderProgressBar(props.state.progress.bytesWritten, props.state.progress.bytesTotal));
    }
  } else {
    // cart_flash_progressing.
    const phaseLabel: Record<typeof props.state.phase, string> = {
      connecting: 'Connecting to cart…',
      detecting: 'Detecting firmware…',
      backup: 'Saving backup file…',
      flashing: 'Writing to cart…',
      verifying: 'Verifying cart bytes…',
    };
    wrap.append(el('div', { class: 'gen2-line phase' }, phaseLabel[props.state.phase]));
    if (props.state.progress) {
      wrap.append(renderProgressBar(props.state.progress.bytesWritten, props.state.progress.bytesTotal));
    }
  }

  const backdrop = el('div', { class: 'flash-modal-backdrop' });
  backdrop.append(wrap);
  return backdrop;
}

function renderProgressBar(bytesWritten: number, bytesTotal: number): HTMLElement {
  const wrap = el('div', { class: 'flash-progress-bar' });
  const total = Math.max(1, bytesTotal);
  const ratio = Math.max(0, Math.min(1, bytesWritten / total));
  const fill = el('div', { class: 'flash-progress-bar-fill', style: `width: ${(ratio * 100).toFixed(1)}%;` });
  wrap.append(fill);
  wrap.append(
    el(
      'div',
      { class: 'gen2-line bytes-line' },
      `${bytesWritten.toLocaleString()} / ${bytesTotal.toLocaleString()} bytes (${(ratio * 100).toFixed(1)}%)`,
    ),
  );
  return wrap;
}
