/**
 * S7b — `GbxCartSink` tests. Drives a stub CartProtocol that logs each
 * call so we can pin the per-family write sequence.
 */

import { describe, it, expect, vi } from 'vitest';
import { GbxCartSink } from '../sinks/gbxCartSink.js';
import { CartError } from '../types.js';
import type { CartProtocol, CartFamily } from '../protocol/index.js';

interface Call {
  readonly op: string;
  readonly args?: unknown[];
}

function makeStubProtocol(opts: { failOn?: string } = {}): {
  protocol: CartProtocol;
  calls: Call[];
} {
  const calls: Call[] = [];
  const wrap = <T extends unknown[]>(name: string, fn: (...a: T) => Promise<unknown>) => {
    return async (...args: T): Promise<unknown> => {
      calls.push({ op: name, args });
      if (opts.failOn === name) throw new CartError('WRITE_FAILED', `stub failure on ${name}`);
      return fn(...args);
    };
  };
  const protocol: CartProtocol = {
    variant: 'lesserkuma',
    readFirmware: wrap('readFirmware', async () => ({
      banner: '',
      variant: 'lesserkuma',
      majorRev: 14,
    })) as CartProtocol['readFirmware'],
    readRom: wrap('readRom', async () => new Uint8Array(0)) as CartProtocol['readRom'],
    readSram: wrap('readSram', async () => new Uint8Array(0)) as CartProtocol['readSram'],
    writeSram: wrap('writeSram', async () => undefined) as CartProtocol['writeSram'],
    setMode: wrap('setMode', async () => undefined) as CartProtocol['setMode'],
    setBank: wrap('setBank', async () => undefined) as CartProtocol['setBank'],
    setRamEnabled: wrap('setRamEnabled', async () => undefined) as CartProtocol['setRamEnabled'],
    prepareForWrite: wrap(
      'prepareForWrite',
      async () => undefined,
    ) as CartProtocol['prepareForWrite'],
  };
  return { protocol, calls };
}

describe('GbxCartSink — DMG path', () => {
  it.each<CartFamily>(['gb', 'gbc'])(
    'drives setMode → prepareForWrite → setRamEnabled(true) → bank loop → setRamEnabled(false) for %s',
    async (family) => {
      const { protocol, calls } = makeStubProtocol();
      const sink = new GbxCartSink({ protocol, family });
      const data = new Uint8Array(8 * 1024).fill(0x42); // single bank
      await sink.write(data);
      const ops = calls.map((c) => c.op);
      expect(ops).toEqual([
        'setMode',
        'prepareForWrite',
        'setRamEnabled',
        'writeSram',
        'setRamEnabled',
      ]);
      // setRamEnabled was called as enable(true) then disable(false).
      const ramCalls = calls.filter((c) => c.op === 'setRamEnabled');
      expect(ramCalls[0]!.args![0]).toBe(true);
      expect(ramCalls[1]!.args![0]).toBe(false);
    },
  );

  it('runs the bank loop for 32 KB Gen 2 / 32 KB Gen 1 carts (4 banks)', async () => {
    const { protocol, calls } = makeStubProtocol();
    const sink = new GbxCartSink({ protocol, family: 'gbc' });
    await sink.write(new Uint8Array(32 * 1024));
    const banks = calls.filter((c) => c.op === 'setBank');
    expect(banks.map((c) => c.args![0])).toEqual([0, 1, 2, 3]);
    const writes = calls.filter((c) => c.op === 'writeSram');
    expect(writes).toHaveLength(4);
    for (const w of writes) {
      expect((w.args![1] as Uint8Array).length).toBe(8 * 1024);
    }
  });

  it('does not call setBank for a single-bank 8 KB write', async () => {
    const { protocol, calls } = makeStubProtocol();
    const sink = new GbxCartSink({ protocol, family: 'gb' });
    await sink.write(new Uint8Array(8 * 1024));
    expect(calls.filter((c) => c.op === 'setBank')).toHaveLength(0);
  });

  it('still calls setRamEnabled(false) after a writeSram failure (cleanup)', async () => {
    const { protocol, calls } = makeStubProtocol({ failOn: 'writeSram' });
    const sink = new GbxCartSink({ protocol, family: 'gb' });
    await expect(sink.write(new Uint8Array(8 * 1024))).rejects.toThrow(CartError);
    const ram = calls.filter((c) => c.op === 'setRamEnabled');
    expect(ram).toHaveLength(2);
    expect(ram[1]!.args![0]).toBe(false);
  });
});

describe('GbxCartSink — AGB path', () => {
  it('skips the DMG bank loop and calls writeSram once with the full payload', async () => {
    const { protocol, calls } = makeStubProtocol();
    const sink = new GbxCartSink({ protocol, family: 'gba' });
    const data = new Uint8Array(128 * 1024);
    await sink.write(data);
    expect(calls.map((c) => c.op)).toEqual(['setMode', 'prepareForWrite', 'writeSram']);
    expect(calls.filter((c) => c.op === 'setBank')).toHaveLength(0);
    expect(calls.filter((c) => c.op === 'setRamEnabled')).toHaveLength(0);
    const writeCall = calls.find((c) => c.op === 'writeSram');
    expect((writeCall!.args![1] as Uint8Array).length).toBe(128 * 1024);
  });
});

describe('GbxCartSink — signal/onProgress wiring', () => {
  it('passes the abort signal through to writeSram', async () => {
    const ctrl = new AbortController();
    const { protocol, calls } = makeStubProtocol();
    const sink = new GbxCartSink({ protocol, family: 'gba' });
    await sink.write(new Uint8Array(0x10000), { signal: ctrl.signal });
    const writeCall = calls.find((c) => c.op === 'writeSram');
    const writeOpts = writeCall!.args![2] as { signal?: AbortSignal };
    expect(writeOpts.signal).toBe(ctrl.signal);
  });

  it('multiplexes per-bank writeSram progress into a global bytesWritten', async () => {
    const protocol = makeStubProtocol().protocol;
    // Override writeSram to call onProgress with bank-relative bytes.
    (protocol.writeSram as unknown) = async (
      _family: CartFamily,
      bytes: Uint8Array,
      opts?: { onProgress?: (p: { bytesWritten: number; bytesTotal: number }) => void },
    ): Promise<void> => {
      opts?.onProgress?.({ bytesWritten: bytes.length, bytesTotal: bytes.length });
    };
    const sink = new GbxCartSink({ protocol, family: 'gbc' });
    const seen: Array<{ bytesWritten: number; bytesTotal: number }> = [];
    await sink.write(new Uint8Array(32 * 1024), {
      onProgress: (p) => seen.push(p),
    });
    expect(seen.length).toBe(4);
    // After 4 banks the running total reaches 32 KB.
    expect(seen[3]!.bytesWritten).toBe(32 * 1024);
    expect(seen[3]!.bytesTotal).toBe(32 * 1024);
  });
});

describe('GbxCartSink — label', () => {
  it('uses the deps.label override when supplied', () => {
    const { protocol } = makeStubProtocol();
    const sink = new GbxCartSink({ protocol, family: 'gb', label: 'MyCart' });
    expect(sink.label).toBe('MyCart');
  });
  it('falls back to a family-shaped default label', () => {
    const { protocol } = makeStubProtocol();
    expect(new GbxCartSink({ protocol, family: 'gba' }).label).toMatch(/gba/);
  });
});

describe('GbxCartSink — protocol with no prepareForWrite', () => {
  it('is OK if protocol.prepareForWrite is missing (optional in interface)', async () => {
    const { protocol, calls } = makeStubProtocol();
    const noPrep: CartProtocol = { ...protocol };
    delete (noPrep as { prepareForWrite?: unknown }).prepareForWrite;
    const sink = new GbxCartSink({ protocol: noPrep, family: 'gb' });
    await sink.write(new Uint8Array(8 * 1024));
    expect(calls.filter((c) => c.op === 'prepareForWrite')).toHaveLength(0);
    // The remaining sequence still lands.
    expect(calls.filter((c) => c.op === 'setMode')).toHaveLength(1);
    expect(calls.filter((c) => c.op === 'writeSram')).toHaveLength(1);
  });
  void vi; // imported for symmetry with other test files
});
