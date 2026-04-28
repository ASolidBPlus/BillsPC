/**
 * Unit tests for the JEDEC AGB Flash helper. These tests don't touch the
 * LK/OFW protocols — they exercise the helper in isolation against
 * scripted cart-write + read-u16 callbacks.
 */

import { describe, it, expect } from 'vitest';
import {
  AGB_FLASH_BANK_BYTES,
  AGB_FLASH_SECTOR_BYTES,
  AGB_FLASH_TOTAL_BYTES,
  agbFlashSectorPlan,
  diffBytes,
  FLASH_ERASE_POLL_MAX,
  JedecFlash,
} from '../agbFlash.js';
import { CartError } from '../../types.js';

interface CartWriteCall {
  readonly address: number;
  readonly value: number;
}

function makeJedec(opts: {
  pollSequence?: readonly number[];
  poll?: () => number;
  noSleep?: boolean;
} = {}): {
  jedec: JedecFlash;
  writes: CartWriteCall[];
  pollCalls: number[];
} {
  const writes: CartWriteCall[] = [];
  const pollCalls: number[] = [];
  let pollIdx = 0;
  const cartWrite = async (address: number, value: number): Promise<void> => {
    writes.push({ address, value });
  };
  const readU16 = async (address: number): Promise<number> => {
    pollCalls.push(address);
    if (opts.poll) return opts.poll();
    if (opts.pollSequence) {
      const v = opts.pollSequence[pollIdx] ?? 0xffff;
      pollIdx++;
      return v;
    }
    return 0xffff;
  };
  const sleep = opts.noSleep
    ? async (): Promise<void> => undefined
    : async (ms: number): Promise<void> => {
        await new Promise((r) => setTimeout(r, ms));
      };
  return { jedec: new JedecFlash(cartWrite, readU16, sleep), writes, pollCalls };
}

describe('agbFlashSectorPlan', () => {
  it('produces 32 sectors for 128 KB total spanning 2 banks', () => {
    const plan = agbFlashSectorPlan(AGB_FLASH_TOTAL_BYTES);
    expect(plan).toHaveLength(32);
    expect(plan[0]).toEqual({
      sectorIndex: 0,
      bank: 0,
      addressInBank: 0x0000,
      absoluteOffset: 0,
    });
    expect(plan[15]).toEqual({
      sectorIndex: 15,
      bank: 0,
      addressInBank: 0xf000,
      absoluteOffset: 15 * AGB_FLASH_SECTOR_BYTES,
    });
    expect(plan[16]).toEqual({
      sectorIndex: 16,
      bank: 1,
      addressInBank: 0x0000,
      absoluteOffset: AGB_FLASH_BANK_BYTES,
    });
    expect(plan[31]).toEqual({
      sectorIndex: 31,
      bank: 1,
      addressInBank: 0xf000,
      absoluteOffset: 31 * AGB_FLASH_SECTOR_BYTES,
    });
  });

  it('refuses non-sector-aligned sizes', () => {
    expect(() => agbFlashSectorPlan(8000)).toThrow(CartError);
  });

  it('refuses 0 bytes', () => {
    expect(() => agbFlashSectorPlan(0)).toThrow(CartError);
  });

  it('refuses sizes above 128 KB', () => {
    expect(() => agbFlashSectorPlan(AGB_FLASH_TOTAL_BYTES + AGB_FLASH_SECTOR_BYTES)).toThrow(
      CartError,
    );
  });
});

describe('JedecFlash.exitChipIdMode', () => {
  it('issues the documented 6-step exit sequence (per AMEND-S7b-4)', async () => {
    const { jedec, writes } = makeJedec({ noSleep: true });
    await jedec.exitChipIdMode();
    expect(writes).toEqual([
      { address: 0x0004, value: 0xff },
      { address: 0x0004, value: 0x00 },
      { address: 0x5555, value: 0xaa },
      { address: 0x2aaa, value: 0x55 },
      { address: 0x5555, value: 0xf0 },
      { address: 0x0000, value: 0xf0 },
    ]);
  });
});

describe('JedecFlash.eraseSector', () => {
  it('issues the 6-step JEDEC erase sequence with the sector address', async () => {
    const { jedec, writes } = makeJedec({ noSleep: true });
    const plan = agbFlashSectorPlan(AGB_FLASH_TOTAL_BYTES);
    const sector3 = plan[3]!;
    await jedec.eraseSector(sector3);
    expect(writes).toEqual([
      { address: 0x5555, value: 0xaa },
      { address: 0x2aaa, value: 0x55 },
      { address: 0x5555, value: 0x80 },
      { address: 0x5555, value: 0xaa },
      { address: 0x2aaa, value: 0x55 },
      { address: sector3.addressInBank, value: 0x30 },
    ]);
  });

  it('uses the within-bank address for bank-1 sectors', async () => {
    const { jedec, writes } = makeJedec({ noSleep: true });
    const plan = agbFlashSectorPlan(AGB_FLASH_TOTAL_BYTES);
    const sector20 = plan[20]!; // bank=1, idx-in-bank=4
    await jedec.eraseSector(sector20);
    expect(writes[5]!.address).toBe(0x4000);
  });
});

describe('JedecFlash.pollErased', () => {
  it('returns once the u16 read equals 0xFFFF', async () => {
    const { jedec, pollCalls } = makeJedec({
      pollSequence: [0xc4c, 0xc4c, 0xc4c, 0xffff],
      noSleep: true,
    });
    const sector = agbFlashSectorPlan(AGB_FLASH_TOTAL_BYTES)[7]!;
    await jedec.pollErased(sector);
    expect(pollCalls).toHaveLength(4);
    expect(pollCalls.every((a) => a === sector.addressInBank)).toBe(true);
  });

  it('treats partial 0xFF as not-yet-erased — guards against AMEND-S7b-5 false-fast-exit', async () => {
    // 0x00FF → low byte erased, high byte not yet → must keep polling.
    // (If we accidentally compared `byte0 === 0xFF`, we'd succeed early.)
    const { jedec } = makeJedec({
      pollSequence: [0x00ff, 0xff00, 0xfffe, 0xffff],
      noSleep: true,
    });
    const sector = agbFlashSectorPlan(AGB_FLASH_TOTAL_BYTES)[0]!;
    await jedec.pollErased(sector);
  });

  it('throws WRITE_FAILED with sector metadata when poll timeout elapses', async () => {
    const { jedec } = makeJedec({ poll: () => 0xc4c, noSleep: true });
    const sector = agbFlashSectorPlan(AGB_FLASH_TOTAL_BYTES)[12]!;
    let caught: CartError | null = null;
    try {
      await jedec.pollErased(sector);
    } catch (e) {
      caught = e as CartError;
    }
    expect(caught).toBeInstanceOf(CartError);
    expect(caught!.reason).toBe('WRITE_FAILED');
    expect(caught!.message).toContain('sector 12');
    expect(caught!.meta).toBeDefined();
    expect(caught!.meta!.sectorIndex).toBe(12);
    expect(caught!.meta!.phase).toBe('erase_poll');
  });

  it('caps at FLASH_ERASE_POLL_MAX attempts', async () => {
    const { jedec, pollCalls } = makeJedec({ poll: () => 0xc4c, noSleep: true });
    const sector = agbFlashSectorPlan(AGB_FLASH_TOTAL_BYTES)[0]!;
    await expect(jedec.pollErased(sector)).rejects.toThrow();
    expect(pollCalls).toHaveLength(FLASH_ERASE_POLL_MAX);
  });
});

describe('diffBytes', () => {
  it('reports zero mismatches for identical buffers', () => {
    const a = new Uint8Array(64).fill(0x42);
    const b = new Uint8Array(64).fill(0x42);
    const r = diffBytes(a, b);
    expect(r.mismatchCount).toBe(0);
    expect(r.mismatches).toHaveLength(0);
  });

  it('reports the offset + values for each mismatch', () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 9, 3, 7]);
    const r = diffBytes(a, b);
    expect(r.mismatchCount).toBe(2);
    expect(r.mismatches).toEqual([
      { offset: 1, expected: 2, actual: 9 },
      { offset: 3, expected: 4, actual: 7 },
    ]);
  });

  it('caps detail entries at limit but keeps the full mismatchCount', () => {
    const a = new Uint8Array(2000).fill(0);
    const b = new Uint8Array(2000).fill(1);
    const r = diffBytes(a, b, 10);
    expect(r.mismatches).toHaveLength(10);
    expect(r.mismatchCount).toBe(2000);
  });

  it('returns a length-mismatch entry when sizes differ', () => {
    const a = new Uint8Array(8);
    const b = new Uint8Array(16);
    const r = diffBytes(a, b);
    expect(r.mismatches[0]!.offset).toBe(-1);
    expect(r.mismatchCount).toBe(16);
  });
});
