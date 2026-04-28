/**
 * S9 — `GbxCartSink` orchestration test with a fake DmgMapper. Per
 * PLAN §5.3.
 *
 * Proves the sink is mapper-driven when a `mapper` is supplied:
 *   - protocol.setBank / setRamEnabled NEVER called
 *   - mapper.enableMapper invoked exactly once before bank loop
 *   - mapper.exerciseRtc invoked iff hasRtc(), strictly BEFORE
 *     mapper.enableRam(true)
 *   - mapper.selectBankRam(0..N-1) in order
 *   - mapper.enableRam(false) invoked at end
 */

import { describe, it, expect } from 'vitest';
import { GbxCartSink } from '../sinks/gbxCartSink.js';
import type { CartProtocol, CartFamily } from '../protocol/index.js';
import type { CartWriteCmd, DmgMapper, MapperBus } from '../mapper/index.js';

interface ProtoCall {
  readonly op: string;
  readonly args?: unknown[];
}
interface MapperCall {
  readonly op: 'enableMapper' | 'enableRam' | 'selectBankRam' | 'hasRtc' | 'exerciseRtc';
  readonly args?: unknown[];
  readonly seq: number;
}

function makeStubProtocol(): { protocol: CartProtocol; calls: ProtoCall[] } {
  const calls: ProtoCall[] = [];
  const wrap =
    (name: string) =>
    async (...args: unknown[]): Promise<unknown> => {
      calls.push({ op: name, args });
      if (name === 'readSram' || name === 'readRom') return new Uint8Array(0);
      if (name === 'readFirmware') return { banner: '', variant: 'lesserkuma', majorRev: 14 };
      return undefined;
    };
  const protocol: CartProtocol = {
    variant: 'lesserkuma',
    readFirmware: wrap('readFirmware') as CartProtocol['readFirmware'],
    readRom: wrap('readRom') as CartProtocol['readRom'],
    readSram: wrap('readSram') as CartProtocol['readSram'],
    writeSram: wrap('writeSram') as CartProtocol['writeSram'],
    setMode: wrap('setMode') as CartProtocol['setMode'],
    setBank: wrap('setBank') as CartProtocol['setBank'],
    setRamEnabled: wrap('setRamEnabled') as CartProtocol['setRamEnabled'],
    prepareForWrite: wrap('prepareForWrite') as CartProtocol['prepareForWrite'],
    runCartWriteCommands: wrap('runCartWriteCommands') as CartProtocol['runCartWriteCommands'],
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

function makeFakeMapper(opts: { hasRtc: boolean; cartTypeByte: number }): {
  mapper: DmgMapper;
  calls: MapperCall[];
} {
  const calls: MapperCall[] = [];
  let seq = 0;
  const next = (): number => ++seq;
  const mapper: DmgMapper = {
    name: opts.hasRtc ? 'MBC3+RTC' : 'TestMapper',
    cartTypeByte: opts.cartTypeByte,
    ramBankSize: 0x2000,
    enableMapper(): readonly CartWriteCmd[] {
      calls.push({ op: 'enableMapper', seq: next() });
      return [];
    },
    enableRam(enabled: boolean): readonly CartWriteCmd[] {
      calls.push({ op: 'enableRam', args: [enabled], seq: next() });
      return [[0x0000, enabled ? 0x0a : 0x00]];
    },
    selectBankRam(index: number): readonly CartWriteCmd[] {
      calls.push({ op: 'selectBankRam', args: [index], seq: next() });
      return [[0x4000, index]];
    },
    hasRtc(): boolean {
      // Don't push to calls — `hasRtc` is read multiple times in some
      // codepaths; pinning the count would over-constrain.
      return opts.hasRtc;
    },
    async exerciseRtc(_bus: MapperBus, _o?: { signal?: AbortSignal }): Promise<void> {
      void _bus;
      void _o;
      calls.push({ op: 'exerciseRtc', seq: next() });
    },
  };
  return { mapper, calls };
}

describe('GbxCartSink — mapper-driven DMG path (RTC mapper)', () => {
  it.each<CartFamily>(['gb', 'gbc'])(
    'never calls protocol.setBank / setRamEnabled when mapper is supplied (%s)',
    async (family) => {
      const { protocol, calls } = makeStubProtocol();
      const { mapper } = makeFakeMapper({ hasRtc: true, cartTypeByte: 0x10 });
      const sink = new GbxCartSink({ protocol, family, mapper });
      await sink.write(new Uint8Array(32 * 1024));
      expect(calls.filter((c) => c.op === 'setBank')).toHaveLength(0);
      expect(calls.filter((c) => c.op === 'setRamEnabled')).toHaveLength(0);
    },
  );

  it('exerciseRtc fires exactly once, BEFORE enableRam(true) — order pin', async () => {
    const { protocol } = makeStubProtocol();
    const { mapper, calls } = makeFakeMapper({ hasRtc: true, cartTypeByte: 0x10 });
    const sink = new GbxCartSink({ protocol, family: 'gbc', mapper });
    await sink.write(new Uint8Array(8 * 1024));
    const exerciseSeqs = calls.filter((c) => c.op === 'exerciseRtc').map((c) => c.seq);
    expect(exerciseSeqs).toHaveLength(1);
    const enableTrue = calls.find((c) => c.op === 'enableRam' && c.args?.[0] === true);
    expect(enableTrue).toBeDefined();
    expect(exerciseSeqs[0]!).toBeLessThan(enableTrue!.seq);
  });

  it('enableMapper invoked exactly once, BEFORE bank loop AND BEFORE enableRam(true)', async () => {
    const { protocol } = makeStubProtocol();
    const { mapper, calls } = makeFakeMapper({ hasRtc: true, cartTypeByte: 0x10 });
    const sink = new GbxCartSink({ protocol, family: 'gbc', mapper });
    await sink.write(new Uint8Array(32 * 1024));
    const enableMapperCalls = calls.filter((c) => c.op === 'enableMapper');
    expect(enableMapperCalls).toHaveLength(1);
    const enableTrue = calls.find((c) => c.op === 'enableRam' && c.args?.[0] === true)!;
    const firstBank = calls.find((c) => c.op === 'selectBankRam')!;
    expect(enableMapperCalls[0]!.seq).toBeLessThan(enableTrue.seq);
    expect(enableMapperCalls[0]!.seq).toBeLessThan(firstBank.seq);
  });

  it('selectBankRam called for every bank in order (4 banks for 32 KB Crystal)', async () => {
    const { protocol } = makeStubProtocol();
    const { mapper, calls } = makeFakeMapper({ hasRtc: true, cartTypeByte: 0x10 });
    const sink = new GbxCartSink({ protocol, family: 'gbc', mapper });
    await sink.write(new Uint8Array(32 * 1024));
    const banks = calls.filter((c) => c.op === 'selectBankRam').map((c) => c.args![0]);
    expect(banks).toEqual([0, 1, 2, 3]);
  });

  it('enableRam(false) fires at end (cleanup)', async () => {
    const { protocol } = makeStubProtocol();
    const { mapper, calls } = makeFakeMapper({ hasRtc: true, cartTypeByte: 0x10 });
    const sink = new GbxCartSink({ protocol, family: 'gbc', mapper });
    await sink.write(new Uint8Array(8 * 1024));
    const enableFalse = calls.find((c) => c.op === 'enableRam' && c.args?.[0] === false);
    expect(enableFalse).toBeDefined();
    const enableTrue = calls.find((c) => c.op === 'enableRam' && c.args?.[0] === true)!;
    expect(enableFalse!.seq).toBeGreaterThan(enableTrue.seq);
  });
});

describe('GbxCartSink — mapper-driven DMG path (non-RTC mapper)', () => {
  it('exerciseRtc NEVER called when mapper.hasRtc() is false', async () => {
    const { protocol } = makeStubProtocol();
    const { mapper, calls } = makeFakeMapper({ hasRtc: false, cartTypeByte: 0x03 });
    const sink = new GbxCartSink({ protocol, family: 'gb', mapper });
    await sink.write(new Uint8Array(8 * 1024));
    expect(calls.filter((c) => c.op === 'exerciseRtc')).toHaveLength(0);
  });

  it('still calls enableMapper + enableRam(true/false) + writeSram', async () => {
    const { protocol, calls: pCalls } = makeStubProtocol();
    const { mapper, calls } = makeFakeMapper({ hasRtc: false, cartTypeByte: 0x03 });
    const sink = new GbxCartSink({ protocol, family: 'gb', mapper });
    await sink.write(new Uint8Array(8 * 1024));
    expect(calls.filter((c) => c.op === 'enableMapper')).toHaveLength(1);
    expect(calls.filter((c) => c.op === 'enableRam' && c.args?.[0] === true)).toHaveLength(1);
    expect(calls.filter((c) => c.op === 'enableRam' && c.args?.[0] === false)).toHaveLength(1);
    expect(pCalls.filter((c) => c.op === 'writeSram')).toHaveLength(1);
  });
});

describe('GbxCartSink — DMG without mapper (S9 Stage 4: now an error)', () => {
  it('throws UNSUPPORTED_CART when DMG cart wired without a mapper', async () => {
    const { protocol } = makeStubProtocol();
    const sink = new GbxCartSink({ protocol, family: 'gbc' });
    await expect(sink.write(new Uint8Array(8 * 1024))).rejects.toThrow(/mapper required/);
  });
});

describe('GbxCartSink — protocol without runCartWriteCommands rejects mapper', () => {
  it('throws UNSUPPORTED_FIRMWARE when mapper supplied but protocol lacks support', async () => {
    const { protocol } = makeStubProtocol();
    delete (protocol as { runCartWriteCommands?: unknown }).runCartWriteCommands;
    const { mapper } = makeFakeMapper({ hasRtc: false, cartTypeByte: 0x03 });
    const sink = new GbxCartSink({ protocol, family: 'gb', mapper });
    await expect(sink.write(new Uint8Array(8 * 1024))).rejects.toThrow(/mapper-driven/);
  });
});
