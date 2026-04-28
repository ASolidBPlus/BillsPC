/**
 * S7a — BackupSink decorator semantics.
 *
 * Pinned per orchestrator decision Q3 + AMEND-S7a-EVAL-3:
 *   - backup-write happens BEFORE inner.write
 *   - if backup fails (picker cancelled, fallback rejected), inner.write
 *     is NEVER called
 *   - filename matches `${cartLabel}-${tid}.backup-pre-${YYYYMMDDHHmmss}.sav`
 */
import { describe, it, expect } from 'vitest';
import { BackupSink, backupFilename } from '../cart/backupSink.js';
import { CartError, type SaveSink, type SaveSinkOptions } from '@pokeportal/core';

class RecordingSink implements SaveSink {
  readonly label = 'recording';
  readonly calls: { bytes: Uint8Array; opts?: SaveSinkOptions }[] = [];
  async write(bytes: Uint8Array, opts?: SaveSinkOptions): Promise<void> {
    this.calls.push(opts ? { bytes, opts } : { bytes });
  }
}

describe('BackupSink', () => {
  it('calls picker BEFORE inner.write and writes pre-write bytes via picker', async () => {
    const inner = new RecordingSink();
    const pre = new Uint8Array([1, 2, 3]);
    const order: string[] = [];
    const writable = {
      async write(b: Uint8Array): Promise<void> {
        order.push(`backup:${b.length}`);
      },
      async close(): Promise<void> {},
    };
    inner.write = (async (bytes) => {
      order.push(`inner:${bytes.length}`);
    }) as typeof inner.write;
    const sink = new BackupSink(inner, pre, 'cart.backup-pre.sav', {
      savePicker: async () => writable,
    });
    await sink.write(new Uint8Array([7, 8, 9]));
    expect(order).toEqual(['backup:3', 'inner:3']);
  });

  it('falls back to <a download> when picker returns null and confirms', async () => {
    const inner = new RecordingSink();
    let downloadFired = false;
    const sink = new BackupSink(inner, new Uint8Array([1]), 'cart.backup.sav', {
      savePicker: async () => null,
      fallbackDownload: async () => {
        downloadFired = true;
        return true;
      },
    });
    await sink.write(new Uint8Array([2]));
    expect(downloadFired).toBe(true);
    expect(inner.calls.length).toBe(1);
  });

  it('throws BACKUP_FAILED and DOES NOT call inner when picker is cancelled', async () => {
    const inner = new RecordingSink();
    const sink = new BackupSink(inner, new Uint8Array([1]), 'cart.backup.sav', {
      savePicker: async () => {
        throw new Error('AbortError: user cancelled');
      },
    });
    await expect(sink.write(new Uint8Array([2]))).rejects.toThrow(CartError);
    expect(inner.calls.length).toBe(0);
  });

  it('throws BACKUP_FAILED when fallback returns false (user did not confirm)', async () => {
    const inner = new RecordingSink();
    const sink = new BackupSink(inner, new Uint8Array([1]), 'cart.backup.sav', {
      savePicker: async () => null,
      fallbackDownload: async () => false,
    });
    await expect(sink.write(new Uint8Array([2]))).rejects.toThrow(CartError);
    expect(inner.calls.length).toBe(0);
  });

  it('forwards opts (signal, onProgress) to the inner write', async () => {
    const inner = new RecordingSink();
    const sink = new BackupSink(inner, new Uint8Array([1]), 'cart.backup.sav', {
      savePicker: async () => ({
        async write() {},
        async close() {},
      }),
    });
    const ctrl = new AbortController();
    const cb = (): void => {};
    await sink.write(new Uint8Array([2]), { signal: ctrl.signal, onProgress: cb });
    expect(inner.calls[0]!.opts).toBeDefined();
    expect(inner.calls[0]!.opts!.signal).toBe(ctrl.signal);
    expect(inner.calls[0]!.opts!.onProgress).toBe(cb);
  });

  it('backupFilename matches the documented pattern', () => {
    const fixed = new Date(Date.UTC(2026, 3, 22, 14, 35, 9));
    const out = backupFilename('POKEMON RED (32 KB)', 12345, fixed);
    expect(out).toMatch(/^POKEMON-RED-32-KB-12345\.backup-pre-\d{14}\.sav$/);
  });

  // AMEND-S7b-9: file-size verification after close.
  it('throws BACKUP_FAILED if verifySize reports 0 bytes (truncated download)', async () => {
    const inner = new RecordingSink();
    const sink = new BackupSink(inner, new Uint8Array(32 * 1024), 'cart.backup-pre.sav', {
      savePicker: async () => ({
        writable: {
          async write() {},
          async close() {},
        },
        // Simulate a browser truncating the download.
        verifySize: async () => 0,
      }),
    });
    await expect(sink.write(new Uint8Array(32 * 1024))).rejects.toThrow(CartError);
    expect(inner.calls.length).toBe(0);
  });

  it('throws BACKUP_FAILED if verifySize reports a length mismatch', async () => {
    const inner = new RecordingSink();
    const sink = new BackupSink(inner, new Uint8Array(32 * 1024), 'cart.backup-pre.sav', {
      savePicker: async () => ({
        writable: {
          async write() {},
          async close() {},
        },
        verifySize: async () => 16 * 1024,
      }),
    });
    await expect(sink.write(new Uint8Array(32 * 1024))).rejects.toThrow(/size mismatch/);
    expect(inner.calls.length).toBe(0);
  });

  it('proceeds when verifySize matches preWriteBytes.length exactly', async () => {
    const inner = new RecordingSink();
    const sink = new BackupSink(inner, new Uint8Array(32 * 1024), 'cart.backup-pre.sav', {
      savePicker: async () => ({
        writable: {
          async write() {},
          async close() {},
        },
        verifySize: async () => 32 * 1024,
      }),
    });
    await sink.write(new Uint8Array(32 * 1024));
    expect(inner.calls.length).toBe(1);
  });
});
