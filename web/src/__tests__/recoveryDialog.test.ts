/**
 * S7b — `recoveryDialog` tests. Covers the AMEND-S7b-14 / DECISION-7
 * 3-attempt cap → "use FlashGBX manually" copy.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { recoveryDialog } from '../ui/recoveryDialog.js';

describe('recoveryDialog — fresh failure', () => {
  let host: HTMLElement;
  beforeEach(() => {
    document.body.replaceChildren();
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('renders the backup filename + Restore button when recoveryAvailable is set', () => {
    let retryFired = false;
    const dialog = recoveryDialog({
      errorReason: 'WRITE_FAILED',
      errorMessage: 'mid-write disconnect',
      recoveryAvailable: {
        backupFilename: 'POKEMON-RED-12345.backup-pre-x.sav',
        backupBytes: new Uint8Array(8 * 1024),
      },
      attemptsExhausted: false,
      onRetry: () => (retryFired = true),
      onDismiss: () => undefined,
    });
    host.append(dialog);
    expect(host.textContent).toMatch(/POKEMON-RED-12345/);
    const restoreBtn = Array.from(host.querySelectorAll('button')).find(
      (b) => b.textContent === 'Restore from backup',
    ) as HTMLButtonElement;
    expect(restoreBtn).not.toBeUndefined();
    restoreBtn.click();
    expect(retryFired).toBe(true);
  });

  it('Dismiss fires onDismiss', () => {
    let dismissed = false;
    const dialog = recoveryDialog({
      errorReason: 'WRITE_FAILED',
      errorMessage: '',
      recoveryAvailable: null,
      attemptsExhausted: false,
      onRetry: () => undefined,
      onDismiss: () => (dismissed = true),
    });
    host.append(dialog);
    const dismissBtn = Array.from(host.querySelectorAll('button')).find(
      (b) => b.textContent === 'Dismiss',
    ) as HTMLButtonElement;
    dismissBtn.click();
    expect(dismissed).toBe(true);
  });

  it('shows file-input fallback when recoveryAvailable=null', () => {
    let uploaded: File | null = null;
    const dialog = recoveryDialog({
      errorReason: 'WRITE_FAILED',
      errorMessage: 'no in-memory backup',
      recoveryAvailable: null,
      attemptsExhausted: false,
      onRetry: () => undefined,
      onDismiss: () => undefined,
      onUploadBackup: (f) => (uploaded = f),
    });
    host.append(dialog);
    const input = host.querySelector('.recovery-upload-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    void uploaded;
  });
});

describe('recoveryDialog — attemptsExhausted (AMEND-S7b-14)', () => {
  let host: HTMLElement;
  beforeEach(() => {
    document.body.replaceChildren();
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('switches copy to "use FlashGBX manually" with no Retry button', () => {
    const dialog = recoveryDialog({
      errorReason: 'WRITE_FAILED',
      errorMessage: 'attempt 3',
      recoveryAvailable: {
        backupFilename: 'POKEMON-RED-12345.backup-pre-x.sav',
        backupBytes: new Uint8Array(8 * 1024),
      },
      attemptsExhausted: true,
      onRetry: () => undefined,
      onDismiss: () => undefined,
    });
    host.append(dialog);
    expect(host.textContent).toMatch(/Recovery has failed 3 times/);
    expect(host.textContent).toMatch(/FlashGBX/);
    expect(host.textContent).toMatch(/professional repair/);
    // No "Restore from backup" button when exhausted.
    const restoreBtn = Array.from(host.querySelectorAll('button')).find(
      (b) => b.textContent === 'Restore from backup',
    );
    expect(restoreBtn).toBeUndefined();
  });
});
