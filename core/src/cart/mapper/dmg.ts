/**
 * DmgMapper concrete classes — one per MBC family. Mirrors FlashGBX
 * `Mapper.py` (`DMG_MBC` base + `DMG_MBC1` / `DMG_MBC3` / `DMG_MBC5`).
 *
 * `enableRam` / `selectBankRam` / `enableMapper` return command-list
 * arrays (see `Mapper.py`'s `[[addr, value], ...]` shape) — the driver
 * `runCartWriteCommands` issues each as a 0xB2 cart-write. `exerciseRtc`
 * is async because the dance interleaves cart-writes with CLK_TOGGLE
 * and bulk-reads — a flat command list can't express that.
 */

import { CartError } from '../types.js';
import type { CartWriteCmd, DmgMapper, MapperBus } from './index.js';
import { UNSUPPORTED_CART_MESSAGE } from './index.js';

/** RAM bank size for every MBC Pokemon uses. MBC2 (0x200) and MBC7
 *  (0x200) get their own size when those classes are added. */
const RAM_BANK_SIZE_8K = 0x2000;

/** Base — also serves as `DmgMapperNone` (cart_type 0x00). Default
 *  EnableRAM emits the standard `[[0x0000, 0x0a]]` even though there's
 *  no SRAM to enable, mirroring `Mapper.py:144-149` (defensive). */
export class DmgMapperNone implements DmgMapper {
  readonly name: string;
  readonly cartTypeByte: number;
  readonly ramBankSize = RAM_BANK_SIZE_8K;

  constructor(cartTypeByte: number, name = 'None') {
    this.cartTypeByte = cartTypeByte;
    this.name = name;
  }

  enableRam(enabled: boolean): readonly CartWriteCmd[] {
    return [[0x0000, enabled ? 0x0a : 0x00]];
  }

  enableMapper(): readonly CartWriteCmd[] {
    return [];
  }

  selectBankRam(index: number): readonly CartWriteCmd[] {
    return [[0x4000, index & 0xff]];
  }

  hasRtc(): boolean {
    return false;
  }

  async exerciseRtc(_bus: MapperBus, _opts?: { signal?: AbortSignal }): Promise<void> {
    void _bus;
    void _opts;
  }
}

/** MBC1 — quirky two-write EnableRAM (mode-1 RAM banking THEN unlock).
 *  Per `Mapper.py:220-231`. Disable is the reverse. */
export class DmgMapperMbc1 extends DmgMapperNone {
  constructor(cartTypeByte: number) {
    super(cartTypeByte, 'MBC1');
  }

  override enableRam(enabled: boolean): readonly CartWriteCmd[] {
    if (enabled) {
      return [
        [0x6000, 0x01],
        [0x0000, 0x0a],
      ];
    }
    return [
      [0x0000, 0x00],
      [0x6000, 0x00],
    ];
  }
}

/** MBC3 (no RTC — cart_type 0x11/0x12/0x13). */
export class DmgMapperMbc3 extends DmgMapperNone {
  constructor(cartTypeByte: number, name = 'MBC3') {
    super(cartTypeByte, name);
  }
}

/** MBC3+RTC (cart_type 0x0F / 0x10). HasRTC dance lives here. */
export class DmgMapperMbc3Rtc extends DmgMapperMbc3 {
  constructor(cartTypeByte: number) {
    super(cartTypeByte, 'MBC3+RTC');
  }

  override hasRtc(): boolean {
    return true;
  }

  /**
   * Walk the bank register through every defined value (RAM banks 0-3 →
   * RTC registers S/M/H/DL/DH at 0x08-0x0C → reset to 0) to force the
   * MBC's state machine out of any "stuck in RTC mode" or "stuck on a
   * non-zero RAM bank" state inherited from the prior game session.
   *
   * Literal port of `FlashgbxProtocol.dmgRtcExerciseAndReset` (which
   * itself was a literal port of `Mapper.py:263-287` HasRTC) — emitted
   * as MapperBus calls instead of direct firmware-private operations.
   * The wire bytes match byte-for-byte.
   */
  override async exerciseRtc(bus: MapperBus, opts: { signal?: AbortSignal } = {}): Promise<void> {
    await bus.cartWrite(0x0000, 0x00, opts); // EnableRAM(False) — defensive
    await bus.cartWrite(0x0000, 0x0a, opts); // EnableRAM(True)
    await bus.clkToggle(60, opts);
    await bus.cartWrite(0x0000, 0x0a, opts); // LatchRTC: EnableRAM (re-asserted)
    await bus.cartWrite(0x6000, 0x00, opts); // LatchRTC reset
    await bus.cartWrite(0x6000, 0x01, opts); // LatchRTC set
    for (let reg = 0x08; reg <= 0x0c; reg++) {
      await bus.clkToggle(60, opts);
      await bus.cartWrite(0x4000, reg, opts); // select each RTC register
      // Read 256 bytes from 0xA880 — the cart returns 256 copies of the
      // RTC byte; reading actively exercises the cart bus.
      await bus.bulkReadRam(0xa880, 0x100, opts);
    }
    await bus.cartWrite(0x0000, 0x00, opts); // DisableRAM
    await bus.cartWrite(0x4000, 0x00, opts); // reset to SRAM bank 0
  }
}

/** MBC5 (cart_type 0x19..0x1E). Standard EnableRAM. */
export class DmgMapperMbc5 extends DmgMapperNone {
  constructor(cartTypeByte: number) {
    super(cartTypeByte, 'MBC5');
  }
}

/** Stub for mapper IDs Pokemon doesn't use (TAMA5, MBC2, HuC1/3, MBC6/7,
 *  MAC-GBD, MMM01, etc.). All bus methods throw the verbatim
 *  user-facing UNSUPPORTED_CART message. `name` / `cartTypeByte` /
 *  `ramBankSize` / `hasRtc` are inert so callers can still log them. */
export class DmgMapperUnsupported implements DmgMapper {
  readonly name = 'Unsupported';
  readonly cartTypeByte: number;
  readonly ramBankSize = RAM_BANK_SIZE_8K;

  constructor(cartTypeByte: number) {
    this.cartTypeByte = cartTypeByte;
  }

  private throwError(): never {
    throw new CartError('UNSUPPORTED_CART', UNSUPPORTED_CART_MESSAGE, {
      headerByte: `0x${this.cartTypeByte.toString(16).padStart(2, '0')}`,
    });
  }

  enableRam(_enabled: boolean): readonly CartWriteCmd[] {
    void _enabled;
    this.throwError();
  }

  enableMapper(): readonly CartWriteCmd[] {
    this.throwError();
  }

  selectBankRam(_index: number): readonly CartWriteCmd[] {
    void _index;
    this.throwError();
  }

  hasRtc(): boolean {
    return false;
  }

  async exerciseRtc(_bus: MapperBus, _opts?: { signal?: AbortSignal }): Promise<void> {
    void _bus;
    void _opts;
    this.throwError();
  }
}
