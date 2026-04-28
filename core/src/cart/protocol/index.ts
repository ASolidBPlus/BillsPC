/**
 * CartProtocol — the firmware-family abstraction.
 *
 * Two concrete impls live alongside this file:
 *
 *  - `InsidegadgetsProtocol` — stock insidegadgets firmware (ASCII opcodes).
 *  - `FlashgbxProtocol` — Lesserkuma's reflashed firmware (0xA0+ binary opcodes).
 *
 * Both honour `signal: AbortSignal` + `onProgress`. The `GbxCartSource`
 * constructor takes a `CartProtocol`; the `detectProtocol(port)` factory
 * does the V-banner autodetect dance and returns the correct impl.
 *
 * Notes on writeSram: defined here for completeness (the BackupSink
 * decorator in S7a uses any SaveSink, including future GbxCartSink) but
 * the staging-flash flow is S7b. The interface is fixed; the impls
 * surface 'WRITE_FAILED' on ack mismatch + delegate per-byte / per-page
 * cadence to the firmware variant.
 */

import type { CartIdentity, CartReadOptions, CartWriteOptions, FirmwareInfo } from '../types.js';
import type { CartWriteCmd, MapperBus } from '../mapper/index.js';

export type CartFamily = 'gb' | 'gbc' | 'gba';

export interface CartProtocol {
  readonly variant: 'insidegadgets' | 'lesserkuma';
  readFirmware(opts?: { signal?: AbortSignal }): Promise<FirmwareInfo>;
  /** Read raw ROM bytes starting at `address` for `length` bytes. Used
   *  for cart-header inspection (the GB/GBC header at 0x100..0x14F).
   *  GBA cart headers also live at the start of ROM but get a different
   *  voltage/mode setup — see `setMode`. */
  readRom(address: number, length: number, opts?: CartReadOptions): Promise<Uint8Array>;
  /** Read the cart's full SRAM. The caller passes the expected byte
   *  count (32 KB for Gen 1/2, 128 KB for Gen 3). */
  readSram(family: CartFamily, length: number, opts?: CartReadOptions): Promise<Uint8Array>;
  writeSram(family: CartFamily, bytes: Uint8Array, opts?: CartWriteOptions): Promise<void>;
  /**
   * S7b — one-shot pre-write setup. Per AMEND-S7b-1/-4: LK firmware needs
   * PULLUPS_ENABLED + STATUS_REGISTER setvars (DMG) and the JEDEC chip-ID
   * EXIT sequence (AGB Flash) before any sector erase. Optional on
   * protocols that don't need it (insidegadgets stock OFW). The `GbxCartSink`
   * calls this once before its bank loop.
   */
  prepareForWrite?(family: CartFamily, opts?: { signal?: AbortSignal }): Promise<void>;
  /** Set GBxCart mode + voltage for the cart family. Insidegadgets uses
   *  'G'/'g' + '5'/'3'; Lesserkuma uses 0xC0-family setup. */
  setMode(family: CartFamily, opts?: { signal?: AbortSignal }): Promise<void>;
  /** Switch SRAM bank for MBC3 / MBC5 carts (Gen 2 has 4 SRAM banks). */
  setBank(bank: number, opts?: { signal?: AbortSignal }): Promise<void>;
  /** Enable / disable cart RAM (the standard MBC unlock/lock sequence). */
  setRamEnabled(enabled: boolean, opts?: { signal?: AbortSignal }): Promise<void>;
  /** Optional async cleanup before the underlying port is closed. LK
   *  firmware uses this to downgrade baud back to 1M so the next session
   *  can re-handshake without requiring the user to power-cycle the cart. */
  cleanup?(): Promise<void>;
  /** S9 — run a flat list of mapper-emitted cart-write commands. The
   *  GbxCartSink calls this to execute `mapper.enableRam()` /
   *  `selectBankRam()` / `enableMapper()` output. Optional on protocols
   *  that don't support mapper-driven writes (insidegadgets stock OFW);
   *  if the sink is supplied a `mapper` and the protocol lacks this,
   *  the sink throws a clear error. */
  runCartWriteCommands?(
    cmds: readonly CartWriteCmd[],
    opts?: { signal?: AbortSignal },
  ): Promise<void>;
  /** S9 — MapperBus adapter so a DmgMapper can drive cart-write /
   *  CLK_TOGGLE / bulk-RAM-read without reaching into protocol
   *  internals. Optional for the same reason as `runCartWriteCommands`. */
  cartBus?(): MapperBus;
}

export interface CartFamilyMetadata {
  readonly family: CartFamily;
  readonly identity: CartIdentity;
}

// Re-export the impls + factory so callers can `import { detectProtocol } from
// '@pokeportal/core/cart/protocol'`.
export { detectProtocol } from './detect.js';
export { InsidegadgetsProtocol } from './insidegadgets.js';
export { FlashgbxProtocol } from './flashgbx.js';
export { parseCartHeader } from './cartHeader.js';
export type { CartHeader } from './cartHeader.js';
// S9: re-export mapper surface so callers can resolve a DmgMapper from
// the cart-header byte without reaching into ../mapper/ directly.
export { detectMapper, detectMapperOrThrow, UNSUPPORTED_CART_MESSAGE } from '../mapper/index.js';
export type { DmgMapper, MapperBus, CartWriteCmd } from '../mapper/index.js';
