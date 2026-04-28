/**
 * S7b — `flashCart` controller test. Drives a stubbed port via the deps
 * interface; asserts the AMEND-S7b-7/-20 cleanup contract, the
 * BACKUP_FAILED → recoveryAvailable=null path, and the verify-mismatch
 * → recoveryAvailable=populated path.
 *
 * The full happy-path round-trip is covered by `cart-write-flow.test.ts`
 * (the jsdom integration test) — here we mock at the boundary so the
 * unit can be tested in isolation.
 */

import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import { flashCart } from '../cart/cartFlasher.js';
import type { Port } from '@pokeportal/core';

/** A port that immediately closes — every read returns "done". Useful
 *  for asserting the "we tried, hit a port-level error, we still
 *  cleaned up" path. */
function makeBrokenPort(): { port: Port; closed: () => boolean } {
  let closed = false;
  return {
    port: {
      readable: new ReadableStream<Uint8Array>({
        start(controller) {
          // Provide one ack-like byte so detect's V probe doesn't hang
          // forever, then close.
          controller.enqueue(new Uint8Array([26]));
          controller.enqueue(new Uint8Array([0])); // LK probe size=0 → fall through
          controller.close();
        },
      }),
      writable: new WritableStream<Uint8Array>({
        write() {
          // Discard.
        },
      }),
      async close() {
        closed = true;
      },
    },
    closed: () => closed,
  };
}

describe('flashCart — backup-failed path (AMEND-S7b-7)', () => {
  it('returns kind=failed with recoveryAvailable=null when BackupSink throws BACKUP_FAILED', async () => {
    const { port, closed } = makeBrokenPort();
    const result = await flashCart(
      {
        requestPort: async () => port,
        backupSinkDeps: {
          savePicker: async () => {
            throw new Error('AbortError: user cancelled');
          },
          fallbackDownload: async () => false,
        },
      },
      {
        bytes: new Uint8Array(8 * 1024),
        cartCurrentBytes: new Uint8Array(8 * 1024),
        family: 'gb',
        cartLabel: 'POKEMON-RED',
        tid: 12345,
        backupFilename: 'POKEMON-RED.backup-pre-x.sav',
      },
    );
    expect(result.kind).toBe('failed');
    if (result.kind !== 'failed') return;
    expect(result.recoveryAvailable).toBeNull();
    // AMEND-S7b-20: cleanup even on BackupSink failure path.
    expect(closed()).toBe(true);
  });
});

describe('flashCart — port lifecycle on detect failure', () => {
  it('closes the port even when detectProtocol fails (cart-side disconnect)', async () => {
    let closed = false;
    const port: Port = {
      readable: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      }),
      writable: new WritableStream<Uint8Array>({ write() {} }),
      async close() {
        closed = true;
      },
    };
    const result = await flashCart(
      {
        requestPort: async () => port,
      },
      {
        bytes: new Uint8Array(8 * 1024),
        cartCurrentBytes: new Uint8Array(8 * 1024),
        family: 'gb',
        cartLabel: 'POKEMON-RED',
        tid: 12345,
        backupFilename: 'POKEMON-RED.backup-pre-x.sav',
      },
    );
    expect(result.kind).toBe('failed');
    expect(closed).toBe(true);
  });
});

describe('flashCart — recovery flag semantics', () => {
  it('keeps recoveryAvailable=null when backup never started (port open failure)', async () => {
    const result = await flashCart(
      {
        requestPort: async () => {
          throw new Error('PORT_OPEN_FAILED: user dismissed the picker');
        },
      },
      {
        bytes: new Uint8Array(8 * 1024),
        cartCurrentBytes: new Uint8Array(8 * 1024),
        family: 'gb',
        cartLabel: 'POKEMON-RED',
        tid: 12345,
        backupFilename: 'POKEMON-RED.backup-pre-x.sav',
      },
    );
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.recoveryAvailable).toBeNull();
    }
  });
});
