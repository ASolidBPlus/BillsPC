/**
 * Post-failure recovery dialog. Per AMEND-S7b-14 / DECISION-7 the
 * dialog caps recovery at 3 attempts; after 3 failures the copy switches
 * to "use FlashGBX manually" with no Retry button.
 */

import { dialog } from './dialog.js';
import { el } from './dom.js';

export interface RecoveryDialogProps {
  readonly errorReason: string;
  readonly errorMessage: string;
  readonly recoveryAvailable: {
    readonly backupFilename: string;
    readonly backupBytes: Uint8Array;
  } | null;
  readonly attemptsExhausted: boolean;
  readonly onRetry: () => void;
  readonly onDismiss: () => void;
  /** Optional file-input fallback for re-uploading the backup .sav. */
  readonly onUploadBackup?: (file: File) => void;
}

export function recoveryDialog(props: RecoveryDialogProps): HTMLElement {
  const wrap = dialog({ class: 'gen2-dialog gen2-dialog--refusal recovery-dialog' });
  wrap.append(el('div', { class: 'gen2-line title' }, 'Cart write failed'));
  wrap.append(
    el('div', { class: 'gen2-line subtitle' }, `${props.errorReason}: ${props.errorMessage}`),
  );

  if (props.attemptsExhausted) {
    // AMEND-S7b-14 — 4th attempt would just burn flash cycles.
    wrap.append(
      el(
        'div',
        { class: 'gen2-line' },
        'Recovery has failed 3 times. The cart may be physically damaged or the backup file may be corrupted.',
      ),
      el('div', { class: 'gen2-line indent' }, 'Please:'),
      el(
        'div',
        { class: 'gen2-line indent' },
        ` 1. Note the backup filename: ${props.recoveryAvailable?.backupFilename ?? 'unknown'}`,
      ),
      el(
        'div',
        { class: 'gen2-line indent' },
        ' 2. Disconnect the cart and use FlashGBX (or another tool) to flash the backup manually.',
      ),
      el(
        'div',
        { class: 'gen2-line indent' },
        ' 3. If that also fails, the cart may need professional repair.',
      ),
    );
    const buttonRow = el('div', { class: 'recovery-buttons' });
    const dismissBtn = el(
      'button',
      { type: 'button', class: 'secondary' },
      'Dismiss',
    ) as HTMLButtonElement;
    dismissBtn.addEventListener('click', () => props.onDismiss());
    buttonRow.append(dismissBtn);
    wrap.append(buttonRow);
    const backdropEarly = el('div', { class: 'flash-modal-backdrop' });
    backdropEarly.append(wrap);
    return backdropEarly;
  }

  if (props.recoveryAvailable) {
    wrap.append(
      el(
        'div',
        { class: 'gen2-line' },
        `You have a backup file from BEFORE this attempt: ${props.recoveryAvailable.backupFilename}`,
      ),
      el(
        'div',
        { class: 'gen2-line subtitle' },
        'Restore from backup re-flashes the original bytes. The verify pass repeats afterwards.',
      ),
    );
  } else {
    wrap.append(
      el(
        'div',
        { class: 'gen2-line' },
        'No in-memory backup available — please upload the backup .sav file you saved before the write attempt.',
      ),
    );
    if (props.onUploadBackup) {
      const input = el('input', {
        type: 'file',
        class: 'recovery-upload-input',
        accept: '.sav,.bin',
      }) as HTMLInputElement;
      input.addEventListener('change', () => {
        const f = input.files?.[0];
        if (f) props.onUploadBackup!(f);
      });
      wrap.append(input);
    }
  }

  const buttonRow = el('div', { class: 'recovery-buttons' });
  const dismissBtn = el(
    'button',
    { type: 'button', class: 'secondary' },
    'Dismiss',
  ) as HTMLButtonElement;
  dismissBtn.addEventListener('click', () => props.onDismiss());
  buttonRow.append(dismissBtn);

  if (props.recoveryAvailable) {
    const retryBtn = el(
      'button',
      { type: 'button', class: 'primary' },
      'Restore from backup',
    ) as HTMLButtonElement;
    retryBtn.addEventListener('click', () => props.onRetry());
    buttonRow.append(retryBtn);
  }
  wrap.append(buttonRow);
  const backdrop = el('div', { class: 'flash-modal-backdrop' });
  backdrop.append(wrap);
  return backdrop;
}
