/**
 * GbxCartSink — implements `SaveSink` over a `CartProtocol` + a fixed
 * `CartFamily`. Drives the family-appropriate write sequence:
 *
 *   DMG (Gen 1 / Gen 2) — mapper-driven (S9, when `mapper` is supplied):
 *     setMode(family) → prepareForWrite(skipMapperLogic) →
 *       runCartWriteCommands(mapper.enableMapper()) →
 *       if mapper.hasRtc(): mapper.exerciseRtc(protocol.cartBus()) →
 *       runCartWriteCommands(mapper.enableRam(true)) →
 *       per-bank: runCartWriteCommands(mapper.selectBankRam(b)) → writeSram →
 *     runCartWriteCommands(mapper.enableRam(false))
 *
 *   DMG (Gen 1 / Gen 2) — legacy fallback (no `mapper` in deps):
 *     setMode → prepareForWrite (which runs the family='gbc' RTC dance)
 *      → setRamEnabled(true) → setBank/writeSram loop → setRamEnabled(false)
 *
 *   AGB (Gen 3 / Pokemon Flash carts):
 *     setMode('gba') → prepareForWrite → writeSram('gba', bytes)
 *     (writeSram internally bank-switches the 128 KB Flash chip;
 *      `mapper` is ignored)
 *
 * Per AMEND-S7b-2: the per-bank loop reads its bank count from the
 * passed-in `bytes.length` (with `length / 8KB` for DMG). The caller
 * (cartFlasher) gets the total length from the cart-header RAM byte
 * that S7a's read path parses — never hardcode "Gen 1 = 8 KB".
 *
 * Per AMEND-S7b-13: this sink implements the family-agnostic SaveSink,
 * not a Gen-3-specific subset. It composes cleanly under
 * `BackupSink → WriteAndVerifySink → GbxCartSink`.
 *
 * Stage-3 (S9) feature flag: the `mapper` dep is optional during the
 * dual-path period. When present the sink drives the mapper-based path;
 * when absent it falls through to the pre-S9 family-gated path. Stage 4
 * (separate sprint) makes `mapper` required for DMG and removes the
 * legacy fallback after the user HIL-validates the new path.
 */

import { CartError } from '../types.js';
import type { CartProtocol, CartFamily } from '../protocol/index.js';
import type { DmgMapper } from '../mapper/index.js';
import type { SaveSink, SaveSinkOptions } from '../../sav/saveSink.js';

const DMG_BANK_BYTES = 8 * 1024;

export interface GbxCartSinkDeps {
  readonly protocol: CartProtocol;
  readonly family: CartFamily;
  /**
   * S9 — DmgMapper for the cart's MBC. Optional during Stage 3 (the
   * legacy `protocol.setRamEnabled` / `protocol.setBank` /
   * family='gbc'-gated RTC dance still works when this is omitted).
   * Stage 4 makes this required for DMG. Ignored for AGB (the AGB
   * Flash path has its own mapper-equivalent in `agbFlash.ts`).
   */
  readonly mapper?: DmgMapper;
  /** Display label for the sink (used in `BackupSink` filenames + UI). */
  readonly label?: string;
}

export class GbxCartSink implements SaveSink {
  readonly label: string;
  constructor(private readonly deps: GbxCartSinkDeps) {
    this.label = deps.label ?? `GbxCart write (${deps.family})`;
  }

  async write(bytes: Uint8Array, opts: SaveSinkOptions = {}): Promise<void> {
    const { protocol, family, mapper } = this.deps;
    const signalOpts = opts.signal ? { signal: opts.signal } : {};

    await protocol.setMode(family, signalOpts);

    // When a mapper is supplied for a DMG cart, we own the mapper-side
    // logic and the protocol must skip its legacy family='gbc' RTC dance
    // (otherwise it runs twice). The 5-setvar prelude inside
    // prepareForWrite is family-level (not mapper-level) and stays.
    const useMapper = mapper !== undefined && family !== 'gba';
    if (protocol.prepareForWrite) {
      await protocol.prepareForWrite(family, {
        ...signalOpts,
        ...(useMapper ? { skipMapperLogic: true } : {}),
      });
    }

    if (family === 'gba') {
      await protocol.writeSram(family, bytes, {
        ...signalOpts,
        ...(opts.onProgress
          ? {
              onProgress: (p) =>
                opts.onProgress!({ bytesWritten: p.bytesWritten, bytesTotal: p.bytesTotal }),
            }
          : {}),
      });
      return;
    }

    if (useMapper) {
      return this.writeDmgViaMapper(bytes, mapper, opts, signalOpts);
    }

    // Legacy DMG path (no mapper supplied) — pre-S9 behaviour. Removed
    // in Stage 4 once every caller threads a mapper through.
    return this.writeDmgLegacy(bytes, opts, signalOpts);
  }

  private async writeDmgViaMapper(
    bytes: Uint8Array,
    mapper: DmgMapper,
    opts: SaveSinkOptions,
    signalOpts: { signal?: AbortSignal },
  ): Promise<void> {
    const { protocol, family } = this.deps;
    if (!protocol.runCartWriteCommands || !protocol.cartBus) {
      throw new CartError(
        'UNSUPPORTED_FIRMWARE',
        `protocol ${protocol.variant} does not support mapper-driven writes`,
      );
    }

    // Once per write session: enableMapper() — empty `[]` for every
    // mapper Pokemon uses, so zero bytes hit the wire. Specifying the
    // call site now means MMM01 / G-MMC1 support is purely a class
    // addition. Mirrors LK_Device.py's once-per-write-session call site
    // for `_mbc.EnableMapper()`.
    await protocol.runCartWriteCommands(mapper.enableMapper(), signalOpts);

    // Order pin: RTC unstick must happen while RAM is still locked,
    // i.e. STRICTLY BEFORE enableRam(true). Same ordering as the legacy
    // `dmgRtcExerciseAndReset` running from `prepareForWrite` ahead of
    // the sink's `setRamEnabled(true)`.
    if (mapper.hasRtc()) {
      await mapper.exerciseRtc(protocol.cartBus(), signalOpts);
    }

    await protocol.runCartWriteCommands(mapper.enableRam(true), signalOpts);
    try {
      const totalLen = bytes.length;
      const banks = Math.max(1, Math.ceil(totalLen / DMG_BANK_BYTES));
      let off = 0;
      for (let b = 0; b < banks; b++) {
        if (banks > 1) {
          await protocol.runCartWriteCommands(mapper.selectBankRam(b), signalOpts);
        }
        const want = Math.min(DMG_BANK_BYTES, totalLen - off);
        const slice = bytes.subarray(off, off + want);
        await protocol.writeSram(family, slice, {
          ...signalOpts,
          ...(opts.onProgress
            ? {
                onProgress: (p) =>
                  opts.onProgress!({ bytesWritten: off + p.bytesWritten, bytesTotal: totalLen }),
              }
            : {}),
        });
        off += want;
      }
    } finally {
      try {
        await protocol.runCartWriteCommands(mapper.enableRam(false), signalOpts);
      } catch {
        /* shutdown best-effort — the cleanup hook handles port-close ordering */
      }
    }
  }

  private async writeDmgLegacy(
    bytes: Uint8Array,
    opts: SaveSinkOptions,
    signalOpts: { signal?: AbortSignal },
  ): Promise<void> {
    const { protocol, family } = this.deps;
    // DMG / GBC bank loop. AMEND-S7b-2: bank count from bytes.length, NOT
    // a per-family hardcoded value (Gen 1 carts can ship 8 KB OR 32 KB
    // SRAM chips even though the game only uses 8 KB; FlashGBX writes the
    // full chip).
    await protocol.setRamEnabled(true, signalOpts);
    try {
      const totalLen = bytes.length;
      const banks = Math.max(1, Math.ceil(totalLen / DMG_BANK_BYTES));
      let off = 0;
      for (let b = 0; b < banks; b++) {
        if (banks > 1) await protocol.setBank(b, signalOpts);
        const want = Math.min(DMG_BANK_BYTES, totalLen - off);
        const slice = bytes.subarray(off, off + want);
        await protocol.writeSram(family, slice, {
          ...signalOpts,
          ...(opts.onProgress
            ? {
                onProgress: (p) =>
                  opts.onProgress!({ bytesWritten: off + p.bytesWritten, bytesTotal: totalLen }),
              }
            : {}),
        });
        off += want;
      }
    } finally {
      try {
        await protocol.setRamEnabled(false, signalOpts);
      } catch {
        /* shutdown best-effort — the cleanup hook handles port-close ordering */
      }
    }
  }
}
