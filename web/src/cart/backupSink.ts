/**
 * BackupSink — `SaveSink` decorator that persists the pre-write cart
 * bytes to disk BEFORE delegating to the wrapped sink. Per AMEND-S7a-EVAL-3
 * and orchestrator decision Q3:
 *
 *  1. Try `showSaveFilePicker()` (File System Access API; Chromium-only,
 *     same audience as Web Serial). If the user accepts, await the
 *     handle's writable.write() — only then call `inner.write`.
 *  2. If `showSaveFilePicker` is unavailable, fall back to a transient
 *     `<a download>` click, THEN show a "Did the backup save?" confirm
 *     dialog. The user must click "Yes, continue" before `inner.write`
 *     fires. "No, cancel" throws CartError('BACKUP_FAILED').
 *  3. If the picker is cancelled or rejects, throw CartError('BACKUP_FAILED')
 *     and DO NOT call `inner.write`. The cart is left untouched.
 *
 * The intent is "every cart write IS backed up first" as a type-level
 * guarantee — the decorator is the only path the controller knows about.
 */

import { CartError, type SaveSink, type SaveSinkOptions } from '@pokeportal/core';

export interface BackupSinkDeps {
  /**
   * Override `showSaveFilePicker` for testing. May return either:
   *   - A `FileSystemWritableLike` (legacy S7a shape; no size verify).
   *   - A `FileSystemHandleAndWritable` (S7b shape; opt-in size verify
   *     per AMEND-S7b-9).
   */
  readonly savePicker?: (
    filename: string,
  ) => Promise<FileSystemWritableLike | FileSystemHandleAndWritable | null>;
  /** Fallback path: trigger an `<a download>` then return a promise that
   *  resolves true if the user confirmed the file landed. */
  readonly fallbackDownload?: (filename: string, bytes: Uint8Array) => Promise<boolean>;
}

function adoptHandle(
  raw: FileSystemWritableLike | FileSystemHandleAndWritable | null,
): FileSystemHandleAndWritable | null {
  if (!raw) return null;
  if (typeof (raw as FileSystemHandleAndWritable).writable === 'object') {
    return raw as FileSystemHandleAndWritable;
  }
  return { writable: raw as FileSystemWritableLike };
}

interface FileSystemWritableLike {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

/**
 * Per AMEND-S7b-9: after `close()`, the backup must be verified — read
 * back the file's size and assert it matches the source bytes length.
 * Browsers occasionally truncate downloads silently. The picker returns
 * BOTH the writable AND a way to re-stat the resulting file.
 */
export interface FileSystemHandleAndWritable {
  readonly writable: FileSystemWritableLike;
  /** Optional post-close size verification — returns the resulting file's
   *  byte length (read via `getFile().size`). Tests + the legacy code
   *  path that can't readback omit this. */
  readonly verifySize?: () => Promise<number>;
}

interface FileSystemFileHandleLike {
  createWritable(): Promise<FileSystemWritableLike>;
  getFile(): Promise<{ size: number }>;
}

interface SaveFilePickerWindow extends Window {
  showSaveFilePicker?(opts: { suggestedName?: string }): Promise<FileSystemFileHandleLike>;
}

export class BackupSink implements SaveSink {
  readonly label: string;
  constructor(
    private readonly inner: SaveSink,
    private readonly preWriteBytes: Uint8Array,
    private readonly backupFilename: string,
    private readonly deps: BackupSinkDeps = {},
  ) {
    this.label = `Backup + ${inner.label}`;
  }

  async write(bytes: Uint8Array, opts?: SaveSinkOptions): Promise<void> {
    await this.persistBackup();
    await this.inner.write(bytes, opts);
  }

  /** Public so the "Test backup" debug button can verify the flow without
   *  having to construct a no-op inner sink. */
  async persistBackup(): Promise<void> {
    const picker = this.deps.savePicker ?? defaultSavePicker;
    let handled = false;
    try {
      const result = await picker(this.backupFilename);
      const handle = adoptHandle(result);
      if (handle) {
        try {
          await handle.writable.write(this.preWriteBytes);
          await handle.writable.close();
          // AMEND-S7b-9 — re-stat the file post-close. Browsers
          // occasionally truncate downloads silently; a 0-byte backup
          // would leave the user without recourse on a write failure.
          if (handle.verifySize) {
            const actualSize = await handle.verifySize();
            if (actualSize !== this.preWriteBytes.length) {
              throw new CartError(
                'BACKUP_FAILED',
                `backup file size mismatch: wrote ${this.preWriteBytes.length}, got ${actualSize}`,
              );
            }
          }
          handled = true;
        } catch (e) {
          if (e instanceof CartError) throw e;
          throw new CartError('BACKUP_FAILED', `picker write failed: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      if (e instanceof CartError) throw e;
      const msg = (e as Error).message ?? String(e);
      // Picker user-cancelled — try fallback or surface failure.
      if (/abort/i.test(msg)) {
        throw new CartError('BACKUP_FAILED', 'user cancelled save picker');
      }
      // Other picker errors fall through to fallback.
    }
    if (handled) return;
    const fallback = this.deps.fallbackDownload ?? defaultFallback;
    let confirmed: boolean;
    try {
      confirmed = await fallback(this.backupFilename, this.preWriteBytes);
    } catch (e) {
      throw new CartError('BACKUP_FAILED', `fallback download failed: ${(e as Error).message}`);
    }
    if (!confirmed) {
      throw new CartError('BACKUP_FAILED', 'user did not confirm backup save');
    }
  }
}

async function defaultSavePicker(
  filename: string,
): Promise<FileSystemHandleAndWritable | null> {
  const w = globalThis as unknown as SaveFilePickerWindow;
  if (typeof w.showSaveFilePicker !== 'function') return null;
  const handle = await w.showSaveFilePicker({ suggestedName: filename });
  const writable = await handle.createWritable();
  return {
    writable,
    verifySize: async () => {
      const f = await handle.getFile();
      return f.size;
    },
  };
}

async function defaultFallback(filename: string, bytes: Uint8Array): Promise<boolean> {
  const { blobDownload } = await import('../download.js');
  blobDownload(filename, bytes);
  // Best-effort confirmation. In real UI this is wired to a modal; here
  // we use a synchronous confirm() so jsdom tests can stub it.
  if (typeof confirm === 'function') {
    return confirm(
      `Backup saved as ${filename}?\n\nContinue with cart write only if the file is on disk.`,
    );
  }
  return true;
}

export function backupFilename(cartLabel: string, tid: number, now = new Date()): string {
  const safeLabel = cartLabel.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'cart';
  const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`);
  const ts =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${safeLabel}-${tid}.backup-pre-${ts}.sav`;
}
