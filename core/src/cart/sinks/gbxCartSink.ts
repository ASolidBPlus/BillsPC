/**
 * GbxCartSink — implements `SaveSink` over a `CartProtocol` + a fixed
 * `CartFamily`. Drives the family-appropriate write sequence:
 *
 *   DMG (Gen 1 / Gen 2) — mapper-driven (S9, required post-Stage-4):
 *     setMode(family) → prepareForWrite →
 *       runCartWriteCommands(mapper.enableMapper()) →
 *       if mapper.hasRtc(): mapper.exerciseRtc(protocol.cartBus()) →
 *       runCartWriteCommands(mapper.enableRam(true)) →
 *       per-bank: runCartWriteCommands(mapper.selectBankRam(b)) → writeSram →
 *     runCartWriteCommands(mapper.enableRam(false))
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
 * S9 Stage 4: `mapper` is REQUIRED for DMG (gb/gbc). The legacy
 * `protocol.setRamEnabled` / `protocol.setBank` / family='gbc'-gated
 * RTC dance has been removed; sink throws `UNSUPPORTED_CART` if a DMG
 * cart is wired without a mapper. Read path (`gbxCartSource.ts`) still
 * uses the legacy methods per Q4.
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
   * S9 — DmgMapper for the cart's MBC. REQUIRED for DMG (gb/gbc); the
   * sink throws `UNSUPPORTED_CART` if a DMG cart is wired without one.
   * Ignored for AGB (the AGB Flash path has its own mapper-equivalent
   * in `agbFlash.ts`).
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

    if (protocol.prepareForWrite) {
      await protocol.prepareForWrite(family, signalOpts);
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

    // DMG path — mapper is mandatory after Stage 4.
    if (!mapper) {
      throw new CartError('UNSUPPORTED_CART', 'mapper required for DMG');
    }
    return this.writeDmgViaMapper(bytes, mapper, opts, signalOpts);
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
    // i.e. STRICTLY BEFORE enableRam(true). Same ordering as the
    // pre-Stage-4 family-gated dance ran from `prepareForWrite` ahead
    // of the sink's `setRamEnabled(true)`.
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
}
