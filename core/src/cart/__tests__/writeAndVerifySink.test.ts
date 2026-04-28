/**
 * S7b — `WriteAndVerifySink` tests. Exercises the verify-after-write
 * decorator against a stub protocol with a scriptable readback.
 */

import { describe, it, expect } from 'vitest';
import {
  WriteAndVerifySink,
  WriteVerifyError,
  isWriteVerifyError,
} from '../sinks/writeAndVerifySink.js';
import type { CartProtocol, CartFamily } from '../protocol/index.js';
import type { SaveSink } from '../../sav/saveSink.js';

function stubProtocol(readback: () => Promise<Uint8Array>): CartProtocol {
  return {
    variant: 'lesserkuma',
    readFirmware: async () => ({ banner: '', variant: 'lesserkuma', majorRev: 14 }),
    readRom: async () => new Uint8Array(0),
    readSram: async () => readback(),
    writeSram: async () => undefined,
    setMode: async () => undefined,
    setBank: async () => undefined,
    setRamEnabled: async () => undefined,
  };
}

function makeInner(): { sink: SaveSink; calls: Uint8Array[] } {
  const calls: Uint8Array[] = [];
  return {
    calls,
    sink: {
      label: 'inner-spy',
      write: async (b: Uint8Array): Promise<void> => {
        calls.push(b);
      },
    },
  };
}

const FAMILY: CartFamily = 'gba';

describe('WriteAndVerifySink — happy path', () => {
  it('forwards write to inner then verifies via readSram', async () => {
    const data = new Uint8Array(64).fill(0x42);
    const { sink: inner, calls } = makeInner();
    const protocol = stubProtocol(async () => new Uint8Array(data));
    const sink = new WriteAndVerifySink({ inner, protocol, family: FAMILY });
    await sink.write(data);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.length).toBe(64);
  });
});

describe('WriteAndVerifySink — verify mismatch', () => {
  it('throws WriteVerifyError with first-mismatch offset + count', async () => {
    const data = new Uint8Array(64).fill(0x42);
    const reread = new Uint8Array(64).fill(0x42);
    reread[10] = 0x99;
    reread[20] = 0x88;
    const { sink: inner } = makeInner();
    const protocol = stubProtocol(async () => reread);
    const sink = new WriteAndVerifySink({ inner, protocol, family: FAMILY });
    let caught: WriteVerifyError | null = null;
    try {
      await sink.write(data);
    } catch (e) {
      caught = e as WriteVerifyError;
    }
    expect(caught).toBeInstanceOf(WriteVerifyError);
    expect(isWriteVerifyError(caught)).toBe(true);
    expect(caught!.mismatch.firstMismatchOffset).toBe(10);
    expect(caught!.mismatch.mismatchCount).toBe(2);
    expect(caught!.actual).toBe(reread);
    expect(caught!.expected).toBe(data);
  });

  it('throws on length mismatch even if both buffers match where they overlap', async () => {
    const data = new Uint8Array(64).fill(0x11);
    const reread = new Uint8Array(63).fill(0x11);
    const { sink: inner } = makeInner();
    const protocol = stubProtocol(async () => reread);
    const sink = new WriteAndVerifySink({ inner, protocol, family: FAMILY });
    await expect(sink.write(data)).rejects.toThrow(WriteVerifyError);
  });

  it('detects a single-byte save_index footer drift (no diff masking — AMEND-S7b-12)', async () => {
    // The Gen 3 active-slot save_index footer at sector_offset 0xFFC is
    // the canonical "this byte should be quiet" candidate. Confirm we DO
    // NOT pre-mask it: if the cart bumps it spontaneously, the verify
    // surfaces the mismatch (we want to know).
    const data = new Uint8Array(0x1000).fill(0xab);
    const reread = new Uint8Array(0x1000).fill(0xab);
    reread[0xffc] = 0xff; // simulate save_index drift on read-back
    const { sink: inner } = makeInner();
    const protocol = stubProtocol(async () => reread);
    const sink = new WriteAndVerifySink({ inner, protocol, family: FAMILY });
    await expect(sink.write(data)).rejects.toThrow(WriteVerifyError);
  });
});

describe('WriteAndVerifySink — readback override (test seam)', () => {
  it('uses deps.readback when supplied (so tests can drive verify deterministically)', async () => {
    const data = new Uint8Array(64).fill(0x55);
    let readbackCalls = 0;
    const protocol = stubProtocol(async () => {
      throw new Error('readSram should NOT be called when readback is provided');
    });
    const { sink: inner } = makeInner();
    const sink = new WriteAndVerifySink({
      inner,
      protocol,
      family: FAMILY,
      readback: async () => {
        readbackCalls++;
        return new Uint8Array(data);
      },
    });
    await sink.write(data);
    expect(readbackCalls).toBe(1);
  });
});

describe('WriteAndVerifySink — AMEND-S7b-6 buffer-reference contract', () => {
  it('verifies against the same buffer reference passed to inner.write (not a re-derived one)', async () => {
    // Confirm the verify uses `expected` from the call argument, NOT a
    // re-fetch from staging-store / external state. We do this by making
    // inner.write a no-op AND giving readback a different buffer that
    // matches `expected` exactly: if the sink were re-deriving expected
    // from somewhere else, this test would fail.
    const data = new Uint8Array(64).fill(0x77);
    let innerCalled: Uint8Array | null = null;
    const innerSink: SaveSink = {
      label: 'capture-inner',
      write: async (b) => {
        innerCalled = b;
      },
    };
    const protocol = stubProtocol(async () => new Uint8Array(64).fill(0x77));
    const sink = new WriteAndVerifySink({ inner: innerSink, protocol, family: FAMILY });
    await sink.write(data);
    // Same reference reached the inner sink — no defensive copy in the
    // wrapper (the controller is expected to copy if it wants isolation,
    // per AMEND-S7b-6).
    expect(innerCalled).toBe(data);
  });
});

describe('WriteAndVerifySink — onProgress wiring', () => {
  it('emits monotonic progress through write phase then verify phase', async () => {
    const data = new Uint8Array(1024).fill(0x33);
    const innerSink: SaveSink = {
      label: 'progress-inner',
      write: async (_b, opts) => {
        opts?.onProgress?.({ bytesWritten: 512, bytesTotal: 1024 });
        opts?.onProgress?.({ bytesWritten: 1024, bytesTotal: 1024 });
      },
    };
    const protocol = stubProtocol(async () => new Uint8Array(data));
    const sink = new WriteAndVerifySink({
      inner: innerSink,
      protocol,
      family: FAMILY,
      readback: async (length) => new Uint8Array(length).fill(0x33),
    });
    const seen: Array<{ bytesWritten: number; bytesTotal: number }> = [];
    await sink.write(data, { onProgress: (p) => seen.push(p) });
    // Final tick is bytesWritten=bytesTotal.
    expect(seen[seen.length - 1]!.bytesWritten).toBe(1024);
    expect(seen[seen.length - 1]!.bytesTotal).toBe(1024);
    // Sequence is non-decreasing.
    let prev = -1;
    for (const p of seen) {
      expect(p.bytesWritten).toBeGreaterThanOrEqual(prev);
      prev = p.bytesWritten;
    }
  });
});
