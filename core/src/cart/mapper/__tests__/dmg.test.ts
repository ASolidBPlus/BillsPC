/**
 * S9 — DmgMapper concrete-class unit tests. Per PLAN §5.1.
 *
 * Per-class assertions on the exact `enableRam(true/false)`,
 * `selectBankRam(b)`, and `exerciseRtc` call sequences. Pins the
 * MBC1 mode-1 quirk in both directions and proves non-RTC mappers
 * never accidentally run the RTC dance.
 */

import { describe, it, expect } from 'vitest';
import {
  DmgMapperNone,
  DmgMapperMbc1,
  DmgMapperMbc3,
  DmgMapperMbc3Rtc,
  DmgMapperMbc5,
  DmgMapperUnsupported,
} from '../dmg.js';
import { UNSUPPORTED_CART_MESSAGE } from '../index.js';
import type { MapperBus } from '../index.js';
import { CartError } from '../../types.js';

interface BusCall {
  readonly op: 'cartWrite' | 'clkToggle' | 'bulkReadRam';
  readonly args: readonly number[];
}

function makeFakeBus(): { bus: MapperBus; calls: BusCall[] } {
  const calls: BusCall[] = [];
  const bus: MapperBus = {
    async cartWrite(address, value) {
      calls.push({ op: 'cartWrite', args: [address, value] });
    },
    async clkToggle(count) {
      calls.push({ op: 'clkToggle', args: [count] });
    },
    async bulkReadRam(baseAddr, length) {
      calls.push({ op: 'bulkReadRam', args: [baseAddr, length] });
      return new Uint8Array(length);
    },
  };
  return { bus, calls };
}

describe('DmgMapperNone (cart_type 0x00) — base behaviour', () => {
  it('emits the standard single-write enableRam', () => {
    const m = new DmgMapperNone(0x00);
    expect(m.enableRam(true)).toEqual([[0x0000, 0x0a]]);
    expect(m.enableRam(false)).toEqual([[0x0000, 0x00]]);
  });
  it('emits the standard bank-select', () => {
    const m = new DmgMapperNone(0x00);
    expect(m.selectBankRam(0)).toEqual([[0x4000, 0x00]]);
    expect(m.selectBankRam(3)).toEqual([[0x4000, 0x03]]);
  });
  it('enableMapper is empty (no MMM01-style enable needed)', () => {
    const m = new DmgMapperNone(0x00);
    expect(m.enableMapper()).toEqual([]);
  });
  it('hasRtc is false; exerciseRtc is a no-op', async () => {
    const m = new DmgMapperNone(0x00);
    expect(m.hasRtc()).toBe(false);
    const { bus, calls } = makeFakeBus();
    await m.exerciseRtc(bus);
    expect(calls).toEqual([]);
  });
});

describe('DmgMapperMbc1 (cart_type 0x01..0x03) — quirky two-write enableRam', () => {
  it('enableRam(true) emits [0x6000=0x01, 0x0000=0x0a] (mode-1 then unlock)', () => {
    const m = new DmgMapperMbc1(0x03);
    expect(m.enableRam(true)).toEqual([
      [0x6000, 0x01],
      [0x0000, 0x0a],
    ]);
  });
  it('enableRam(false) emits [0x0000=0x00, 0x6000=0x00] (lock then mode-0)', () => {
    const m = new DmgMapperMbc1(0x03);
    expect(m.enableRam(false)).toEqual([
      [0x0000, 0x00],
      [0x6000, 0x00],
    ]);
  });
  it('selectBankRam emits the standard [0x4000, b]', () => {
    const m = new DmgMapperMbc1(0x03);
    for (let b = 0; b < 4; b++) {
      expect(m.selectBankRam(b)).toEqual([[0x4000, b]]);
    }
  });
  it('hasRtc=false; exerciseRtc no-op', async () => {
    const m = new DmgMapperMbc1(0x03);
    expect(m.hasRtc()).toBe(false);
    const { bus, calls } = makeFakeBus();
    await m.exerciseRtc(bus);
    expect(calls).toEqual([]);
  });
});

describe('DmgMapperMbc3 (cart_type 0x11..0x13, no RTC)', () => {
  it('enableRam emits the standard single-write', () => {
    const m = new DmgMapperMbc3(0x13);
    expect(m.enableRam(true)).toEqual([[0x0000, 0x0a]]);
    expect(m.enableRam(false)).toEqual([[0x0000, 0x00]]);
  });
  it('selectBankRam emits [0x4000, b]', () => {
    const m = new DmgMapperMbc3(0x13);
    expect(m.selectBankRam(2)).toEqual([[0x4000, 0x02]]);
  });
  it('hasRtc=false; exerciseRtc no-op even though parent type is MBC3', async () => {
    const m = new DmgMapperMbc3(0x13);
    expect(m.hasRtc()).toBe(false);
    const { bus, calls } = makeFakeBus();
    await m.exerciseRtc(bus);
    expect(calls).toEqual([]);
  });
});

describe('DmgMapperMbc3Rtc (cart_type 0x0F / 0x10)', () => {
  it('inherits standard single-write enableRam', () => {
    const m = new DmgMapperMbc3Rtc(0x10);
    expect(m.enableRam(true)).toEqual([[0x0000, 0x0a]]);
    expect(m.enableRam(false)).toEqual([[0x0000, 0x00]]);
  });
  it('hasRtc=true', () => {
    expect(new DmgMapperMbc3Rtc(0x10).hasRtc()).toBe(true);
    expect(new DmgMapperMbc3Rtc(0x0f).hasRtc()).toBe(true);
  });
  it('exerciseRtc issues the exact bus-call sequence (literal port of dmgRtcExerciseAndReset)', async () => {
    const m = new DmgMapperMbc3Rtc(0x10);
    const { bus, calls } = makeFakeBus();
    await m.exerciseRtc(bus);
    // Pre-loop: defensive disable, enable, clk, re-asserted enable,
    // latch reset, latch set.
    const expected: BusCall[] = [
      { op: 'cartWrite', args: [0x0000, 0x00] },
      { op: 'cartWrite', args: [0x0000, 0x0a] },
      { op: 'clkToggle', args: [60] },
      { op: 'cartWrite', args: [0x0000, 0x0a] },
      { op: 'cartWrite', args: [0x6000, 0x00] },
      { op: 'cartWrite', args: [0x6000, 0x01] },
    ];
    // 5 iters: clk, select-reg, bulk-read 0xA880×256.
    for (let reg = 0x08; reg <= 0x0c; reg++) {
      expected.push({ op: 'clkToggle', args: [60] });
      expected.push({ op: 'cartWrite', args: [0x4000, reg] });
      expected.push({ op: 'bulkReadRam', args: [0xa880, 0x100] });
    }
    // Post-loop: DisableRAM, reset bank 0.
    expected.push({ op: 'cartWrite', args: [0x0000, 0x00] });
    expected.push({ op: 'cartWrite', args: [0x4000, 0x00] });
    expect(calls).toEqual(expected);
  });
});

describe('DmgMapperMbc5 (cart_type 0x19..0x1E)', () => {
  it('enableRam emits the standard single-write', () => {
    const m = new DmgMapperMbc5(0x1b);
    expect(m.enableRam(true)).toEqual([[0x0000, 0x0a]]);
    expect(m.enableRam(false)).toEqual([[0x0000, 0x00]]);
  });
  it('selectBankRam emits [0x4000, b]', () => {
    const m = new DmgMapperMbc5(0x1b);
    expect(m.selectBankRam(1)).toEqual([[0x4000, 0x01]]);
  });
  it('hasRtc=false; exerciseRtc no-op', async () => {
    const m = new DmgMapperMbc5(0x1b);
    expect(m.hasRtc()).toBe(false);
    const { bus, calls } = makeFakeBus();
    await m.exerciseRtc(bus);
    expect(calls).toEqual([]);
  });
});

describe('DmgMapperUnsupported — throws verbatim user-facing message on every bus op', () => {
  it('enableRam throws UNSUPPORTED_CART with the verbatim message + headerByte meta', () => {
    const m = new DmgMapperUnsupported(0xfd);
    try {
      m.enableRam(true);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(CartError);
      const err = e as CartError;
      expect(err.reason).toBe('UNSUPPORTED_CART');
      expect(err.message).toBe(UNSUPPORTED_CART_MESSAGE);
      expect(err.meta).toEqual({ headerByte: '0xfd' });
    }
  });
  it('selectBankRam throws', () => {
    expect(() => new DmgMapperUnsupported(0x05).selectBankRam(0)).toThrow(CartError);
  });
  it('enableMapper throws', () => {
    expect(() => new DmgMapperUnsupported(0xff).enableMapper()).toThrow(CartError);
  });
  it('exerciseRtc throws', async () => {
    const m = new DmgMapperUnsupported(0xfe);
    const { bus } = makeFakeBus();
    await expect(m.exerciseRtc(bus)).rejects.toThrow(CartError);
  });
  it('name + cartTypeByte are inert (queryable for diagnostics)', () => {
    const m = new DmgMapperUnsupported(0xfd);
    expect(m.name).toBe('Unsupported');
    expect(m.cartTypeByte).toBe(0xfd);
    expect(m.hasRtc()).toBe(false);
  });
});
