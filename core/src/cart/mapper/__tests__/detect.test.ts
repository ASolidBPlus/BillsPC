/**
 * S9 — `detectMapper` table tests. Per PLAN §5.2.
 *
 * Pins every Pokemon-relevant cart_type byte to the right mapper class,
 * plus a few unsupported sentinels (TAMA5, MBC2, HuC1/3, MBC6/7,
 * MAC-GBD) to confirm the throw-stub fires. The 0x0F vs 0x10 vs
 * 0x11/12/13 distinction is the critical one: only 0x0F and 0x10
 * instantiate `DmgMapperMbc3Rtc`; 0x11/12/13 are plain `DmgMapperMbc3`
 * (matches `Mapper.py:265` `if MBC_ID not in (0x0F, 0x10, ...)`).
 */

import { describe, it, expect } from 'vitest';
import { detectMapper, detectMapperOrThrow, UNSUPPORTED_CART_MESSAGE } from '../index.js';
import {
  DmgMapperNone,
  DmgMapperMbc1,
  DmgMapperMbc3,
  DmgMapperMbc3Rtc,
  DmgMapperMbc5,
  DmgMapperUnsupported,
} from '../dmg.js';
import { CartError } from '../../types.js';

describe('detectMapper — Pokemon cart_type table', () => {
  it('0x00 → DmgMapperNone', () => {
    expect(detectMapper(0x00)).toBeInstanceOf(DmgMapperNone);
  });

  it.each([0x01, 0x02, 0x03])('0x%s → DmgMapperMbc1 (Pokemon Red/Blue/Green)', (b) => {
    const m = detectMapper(b);
    expect(m).toBeInstanceOf(DmgMapperMbc1);
    expect(m.name).toBe('MBC1');
    expect(m.cartTypeByte).toBe(b);
  });

  it.each([0x0f, 0x10])('0x%s → DmgMapperMbc3Rtc (Gold/Silver/Crystal)', (b) => {
    const m = detectMapper(b);
    expect(m).toBeInstanceOf(DmgMapperMbc3Rtc);
    expect(m.hasRtc()).toBe(true);
    expect(m.cartTypeByte).toBe(b);
  });

  it.each([0x11, 0x12, 0x13])('0x%s → DmgMapperMbc3 (no RTC — Pinball/TCG)', (b) => {
    const m = detectMapper(b);
    expect(m).toBeInstanceOf(DmgMapperMbc3);
    // Critical: NOT the RTC subclass.
    expect(m).not.toBeInstanceOf(DmgMapperMbc3Rtc);
    expect(m.hasRtc()).toBe(false);
  });

  it.each([0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e])(
    '0x%s → DmgMapperMbc5 (Yellow JP / rumble variants)',
    (b) => {
      const m = detectMapper(b);
      expect(m).toBeInstanceOf(DmgMapperMbc5);
      expect(m.hasRtc()).toBe(false);
    },
  );
});

describe('detectMapper — unsupported mapper IDs', () => {
  // TAMA5, MBC2, MAC-GBD, HuC1, HuC3, MBC6, MBC7 — none are Pokemon
  // games; users are routed to FlashGBX directly per Q2.
  it.each([
    [0x05, 'MBC2'],
    [0x06, 'MBC2+SRAM+BATTERY'],
    [0x0b, 'MMM01'],
    [0x0d, 'MMM01+SRAM+BATTERY'],
    [0x20, 'MBC6'],
    [0x22, 'MBC7'],
    [0xfc, 'MAC-GBD'],
    [0xfd, 'TAMA5'],
    [0xfe, 'HuC3'],
    [0xff, 'HuC1'],
  ])('0x%s (%s) → DmgMapperUnsupported', (b) => {
    const m = detectMapper(b as number);
    expect(m).toBeInstanceOf(DmgMapperUnsupported);
    expect(m.cartTypeByte).toBe(b);
  });

  it('detectMapperOrThrow surfaces verbatim user-facing UNSUPPORTED_CART message', () => {
    try {
      detectMapperOrThrow(0xfd);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(CartError);
      const err = e as CartError;
      expect(err.reason).toBe('UNSUPPORTED_CART');
      // Verbatim per PLAN.md §0 Q2 — no formatting.
      expect(err.message).toBe(UNSUPPORTED_CART_MESSAGE);
      // Hex byte recoverable for diagnostic logs but not in user message.
      expect(err.meta).toEqual({ headerByte: '0xfd' });
    }
  });

  it('detectMapperOrThrow returns the mapper for supported types', () => {
    expect(detectMapperOrThrow(0x10)).toBeInstanceOf(DmgMapperMbc3Rtc);
    expect(detectMapperOrThrow(0x03)).toBeInstanceOf(DmgMapperMbc1);
    expect(detectMapperOrThrow(0x00)).toBeInstanceOf(DmgMapperNone);
  });
});
