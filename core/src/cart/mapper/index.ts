/**
 * DMG mapper-class hierarchy. Mirrors FlashGBX `Mapper.py` at
 * lesserkuma/FlashGBX — separates per-MBC bus-write semantics
 * (EnableRAM, SelectBankRAM, HasRTC) from the wire-level firmware
 * driver (`FlashgbxProtocol`). Pre-S9 the protocol carried both
 * concerns, gated on `family === 'gbc'` as a proxy for "MBC3+RTC" —
 * which silently mis-classified Pokemon Yellow JP (MBC5, family='gbc')
 * and any future GBC MBC1 cart.
 *
 * Public surface:
 *   - {@link CartWriteCmd}   — `[address, value]` shape mirrors `Mapper.py`'s
 *                              command-list shape so byte-for-byte audits
 *                              against the upstream stay trivial.
 *   - {@link MapperBus}      — minimal bus surface a mapper needs (cart-write,
 *                              clkToggle, bulk-read).
 *   - {@link DmgMapper}      — the per-MBC interface.
 *   - {@link detectMapper}   — header byte 0x147 → DmgMapper instance.
 */

import { CartError } from '../types.js';
import {
  DmgMapperNone,
  DmgMapperMbc1,
  DmgMapperMbc3,
  DmgMapperMbc3Rtc,
  DmgMapperMbc5,
  DmgMapperUnsupported,
} from './dmg.js';

/** A single MBC register write — `[address, value]`. */
export type CartWriteCmd = readonly [address: number, value: number];

/** The minimal cart-bus surface a mapper needs. The protocol implements
 *  these via its existing private primitives; test fakes log every call. */
export interface MapperBus {
  cartWrite(address: number, value: number, opts?: { signal?: AbortSignal }): Promise<void>;
  clkToggle(count: number, opts?: { signal?: AbortSignal }): Promise<void>;
  bulkReadRam(
    baseAddr: number,
    length: number,
    opts?: { signal?: AbortSignal },
  ): Promise<Uint8Array>;
}

export interface DmgMapper {
  readonly name: string;
  readonly cartTypeByte: number;
  /** RAM bank size in bytes. 0x2000 for every MBC Pokemon uses. */
  readonly ramBankSize: number;
  enableRam(enabled: boolean): readonly CartWriteCmd[];
  /** Empty `[]` for every Pokemon mapper — see Mapper.py:141-142. */
  enableMapper(): readonly CartWriteCmd[];
  selectBankRam(index: number): readonly CartWriteCmd[];
  hasRtc(): boolean;
  exerciseRtc(bus: MapperBus, opts?: { signal?: AbortSignal }): Promise<void>;
}

export {
  DmgMapperNone,
  DmgMapperMbc1,
  DmgMapperMbc3,
  DmgMapperMbc3Rtc,
  DmgMapperMbc5,
  DmgMapperUnsupported,
} from './dmg.js';

/** User-facing error message for unsupported mappers. Verbatim per
 *  PLAN.md §0 Q2 — the UI surfaces this string exactly. */
export const UNSUPPORTED_CART_MESSAGE = 'cart type unsupported at this time, please use FlashGBX';

/**
 * Pure factory — cart-header byte 0x147 → DmgMapper instance.
 *
 * Mapping per `Mapper.py:40-67`:
 *   0x00                                → DmgMapperNone
 *   0x01, 0x02, 0x03                    → DmgMapperMbc1
 *   0x0F, 0x10                          → DmgMapperMbc3Rtc (RTC subset)
 *   0x11, 0x12, 0x13                    → DmgMapperMbc3   (no RTC)
 *   0x19, 0x1A, 0x1B, 0x1C, 0x1D, 0x1E  → DmgMapperMbc5
 *   anything else                       → DmgMapperUnsupported (throws on use)
 *
 * The instance for an unsupported mapper is constructable so the caller
 * can probe its `name` / `cartTypeByte` for diagnostics; it throws
 * UNSUPPORTED_CART on the first attempt to invoke any bus operation.
 */
export function detectMapper(cartTypeByte: number): DmgMapper {
  switch (cartTypeByte) {
    case 0x00:
      return new DmgMapperNone(cartTypeByte);
    case 0x01:
    case 0x02:
    case 0x03:
      return new DmgMapperMbc1(cartTypeByte);
    case 0x0f:
    case 0x10:
      return new DmgMapperMbc3Rtc(cartTypeByte);
    case 0x11:
    case 0x12:
    case 0x13:
      return new DmgMapperMbc3(cartTypeByte);
    case 0x19:
    case 0x1a:
    case 0x1b:
    case 0x1c:
    case 0x1d:
    case 0x1e:
      return new DmgMapperMbc5(cartTypeByte);
    default:
      return new DmgMapperUnsupported(cartTypeByte);
  }
}

/** Helper for callers (`cartFlasher.ts` / `recovery.ts`) that want the
 *  detect-then-throw flow in one call. Throws the verbatim
 *  user-facing CartError for unsupported mappers; otherwise returns
 *  the mapper. The hex byte is preserved on `error.meta.headerByte`
 *  for diagnostics. */
export function detectMapperOrThrow(cartTypeByte: number): DmgMapper {
  const m = detectMapper(cartTypeByte);
  if (m instanceof DmgMapperUnsupported) {
    throw new CartError('UNSUPPORTED_CART', UNSUPPORTED_CART_MESSAGE, {
      headerByte: `0x${cartTypeByte.toString(16).padStart(2, '0')}`,
    });
  }
  return m;
}
