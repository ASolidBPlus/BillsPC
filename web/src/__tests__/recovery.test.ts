/**
 * S7b — recovery flow tests. Drives the boundary cases (port-open
 * failure, file-uploaded backup conversion). The full happy-path
 * round-trip lives in `cart-write-flow.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { restoreFromBackup, readBackupFile, MAX_RECOVERY_ATTEMPTS } from '../cart/recovery.js';
import type { Port } from '@pokeportal/core';

describe('restoreFromBackup', () => {
  it('returns kind=failed when port-open rejects', async () => {
    const result = await restoreFromBackup(
      {
        requestPort: async () => {
          throw new Error('user cancelled');
        },
      },
      {
        backupBytes: new Uint8Array(8 * 1024),
        backupFilename: 'POKEMON-RED.backup-pre-x.sav',
        family: 'gb',
      },
    );
    expect(result.kind).toBe('failed');
  });

  it('closes the port even on failure', async () => {
    let closed = false;
    const port: Port = {
      readable: new ReadableStream<Uint8Array>({
        start(c) {
          c.close();
        },
      }),
      writable: new WritableStream<Uint8Array>({ write() {} }),
      async close() {
        closed = true;
      },
    };
    await restoreFromBackup(
      { requestPort: async () => port },
      {
        backupBytes: new Uint8Array(8 * 1024),
        backupFilename: 'POKEMON-RED.backup-pre-x.sav',
        family: 'gb',
      },
    );
    expect(closed).toBe(true);
  });
});

describe('readBackupFile', () => {
  it('reads a File into a Uint8Array', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const file = new File([data], 'backup.sav');
    const out = await readBackupFile(file);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('MAX_RECOVERY_ATTEMPTS', () => {
  it('caps recovery at 3 (per AMEND-S7b-14 + DECISION-7)', () => {
    expect(MAX_RECOVERY_ATTEMPTS).toBe(3);
  });
});
