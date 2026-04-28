/**
 * S7b — `GbxCartSink` tests. Drives a stub CartProtocol that logs each
 * call so we can pin the per-family write sequence.
 *
 * S9 Stage 4: the legacy `setRamEnabled`/`setBank` path is removed;
 * mapper is required for DMG. These tests now thread a stub mapper
 * through and assert the mapper-driven sequence. The mapper-orchestration
 * unit tests live in `gbxCartSink-mapper.test.ts`; this file covers
 * the family-shape and signal/progress wiring.
 */

import { describe, it, expect, vi } from 'vitest';
import { GbxCartSink } from '../sinks/gbxCartSink.js';
import { CartError } from '../types.js';
import type { CartProtocol, CartFamily } from '../protocol/index.js';
import type { CartWriteCmd, DmgMapper, MapperBus } from '../mapper/index.js';

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
    runCartWriteCommands: wrap(
      'runCartWriteCommands',
      async () => undefined,
    ) as CartProtocol['runCartWriteCommands'],
    cartBus: () => {
      calls.push({ op: 'cartBus' });
      const bus: MapperBus = {
        async cartWrite() {},
        async clkToggle() {},
        async bulkReadRam(_a, length) {
          return new Uint8Array(length);
        },
      };
      return bus;
    },
  };
  return { protocol, calls };
}

function makeStubMapper(opts: { hasRtc?: boolean } = {}): DmgMapper {
  return {
    name: 'StubMapper',
    cartTypeByte: 0x03,
    ramBankSize: 0x2000,
    enableMapper(): readonly CartWriteCmd[] {
      return [];
    },
    enableRam(enabled: boolean): readonly CartWriteCmd[] {
      return [[0x0000, enabled ? 0x0a : 0x00]];
    },
    selectBankRam(index: number): readonly CartWriteCmd[] {
      return [[0x4000, index]];
    },
    hasRtc(): boolean {
      return opts.hasRtc ?? false;
    },
    async exerciseRtc(): Promise<void> {
      /* no-op for stub */
    },
  };
}

describe('GbxCartSink — DMG path', () => {
  it.each<CartFamily>(['gb', 'gbc'])(
    'drives setMode → prepareForWrite → enableRam(true) → bank loop → enableRam(false) for %s',
    async (family) => {
      const { protocol, calls } = makeStubProtocol();
      const sink = new GbxCartSink({ protocol, family, mapper: makeStubMapper() });
      const data = new Uint8Array(8 * 1024).fill(0x42); // single bank
      await sink.write(data);
      // protocol.setRamEnabled / setBank are NEVER called (mapper-driven).
      expect(calls.filter((c) => c.op === 'setRamEnabled')).toHaveLength(0);
      expect(calls.filter((c) => c.op === 'setBank')).toHaveLength(0);
      // The high-level shape: setMode + prepareForWrite + enableMapper +
      // enableRam(true) + writeSram + enableRam(false). With single bank
      // (8 KB), no selectBankRam call. enableMapper is empty for stub
      // but runCartWriteCommands is still invoked once for it.
      expect(calls.filter((c) => c.op === 'setMode')).toHaveLength(1);
      expect(calls.filter((c) => c.op === 'prepareForWrite')).toHaveLength(1);
      expect(calls.filter((c) => c.op === 'writeSram')).toHaveLength(1);
      // 3 runCartWriteCommands calls: enableMapper + enableRam(true) + enableRam(false).
      expect(calls.filter((c) => c.op === 'runCartWriteCommands')).toHaveLength(3);
    },
  );

  it('runs the bank loop for 32 KB Gen 2 / 32 KB Gen 1 carts (4 banks)', async () => {
    const { protocol, calls } = makeStubProtocol();
    const sink = new GbxCartSink({ protocol, family: 'gbc', mapper: makeStubMapper() });
    await sink.write(new Uint8Array(32 * 1024));
    const writes = calls.filter((c) => c.op === 'writeSram');
    expect(writes).toHaveLength(4);
    for (const w of writes) {
      expect((w.args![1] as Uint8Array).length).toBe(8 * 1024);
    }
    // 4 banks → 4 selectBankRam calls (each delivered via runCartWriteCommands).
    // Total runCartWriteCommands: enableMapper + enableRam(true) + 4×selectBankRam + enableRam(false) = 7.
    expect(calls.filter((c) => c.op === 'runCartWriteCommands')).toHaveLength(7);
  });

  it('does not call selectBankRam for a single-bank 8 KB write', async () => {
    const { protocol, calls } = makeStubProtocol();
    const sink = new GbxCartSink({ protocol, family: 'gb', mapper: makeStubMapper() });
    await sink.write(new Uint8Array(8 * 1024));
    // 3 runCartWriteCommands calls only: enableMapper + enableRam(true) + enableRam(false).
    expect(calls.filter((c) => c.op === 'runCartWriteCommands')).toHaveLength(3);
  });

  it('still calls enableRam(false) cleanup after a writeSram failure', async () => {
    const { protocol, calls } = makeStubProtocol({ failOn: 'writeSram' });
    const sink = new GbxCartSink({ protocol, family: 'gb', mapper: makeStubMapper() });
    await expect(sink.write(new Uint8Array(8 * 1024))).rejects.toThrow(CartError);
    // Even on failure, the finally block fires the disable. So we still
    // see enableMapper + enableRam(true) + enableRam(false) = 3.
    expect(calls.filter((c) => c.op === 'runCartWriteCommands')).toHaveLength(3);
  });

  it('throws UNSUPPORTED_CART when DMG cart is wired without a mapper', async () => {
    const { protocol } = makeStubProtocol();
    const sink = new GbxCartSink({ protocol, family: 'gb' });
    await expect(sink.write(new Uint8Array(8 * 1024))).rejects.toThrow(CartError);
    await expect(sink.write(new Uint8Array(8 * 1024))).rejects.toThrow(/mapper required/);
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
    expect(calls.filter((c) => c.op === 'runCartWriteCommands')).toHaveLength(0);
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
    const sink = new GbxCartSink({ protocol, family: 'gbc', mapper: makeStubMapper() });
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
    const sink = new GbxCartSink({ protocol: noPrep, family: 'gb', mapper: makeStubMapper() });
    await sink.write(new Uint8Array(8 * 1024));
    expect(calls.filter((c) => c.op === 'prepareForWrite')).toHaveLength(0);
    // The remaining sequence still lands.
    expect(calls.filter((c) => c.op === 'setMode')).toHaveLength(1);
    expect(calls.filter((c) => c.op === 'writeSram')).toHaveLength(1);
  });
  void vi; // imported for symmetry with other test files
});
