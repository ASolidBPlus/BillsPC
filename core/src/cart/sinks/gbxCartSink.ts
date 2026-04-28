/**
 * GbxCartSink — implements `SaveSink` over a `CartProtocol` + a fixed
 * `CartFamily`. Drives the family-appropriate write sequence:
 *
 *   DMG (Gen 1 / Gen 2):
 *     setMode(family) → prepareForWrite → setRamEnabled(true) →
 *       per-bank: setBank(b) → writeSram(family, bank-bytes) →
 *     setRamEnabled(false)
 *
 *   AGB (Gen 3 / Pokemon Flash carts):
 *     setMode('gba') → prepareForWrite → writeSram('gba', bytes)
 *     (writeSram internally bank-switches the 128 KB Flash chip)
 *
 * Per AMEND-S7b-2: the per-bank loop reads its bank count from the
 * passed-in `bytes.length` (with `length / 8KB` for DMG). The caller
 * (cartFlasher) gets the total length from the cart-header RAM byte
 * that S7a's read path parses — never hardcode "Gen 1 = 8 KB".
 *
 * Per AMEND-S7b-13: this sink implements the family-agnostic SaveSink,
 * not a Gen-3-specific subset. It composes cleanly under
 * `BackupSink → WriteAndVerifySink → GbxCartSink`.
 */

import type { CartProtocol, CartFamily } from '../protocol/index.js';
import type { SaveSink, SaveSinkOptions } from '../../sav/saveSink.js';

const DMG_BANK_BYTES = 8 * 1024;

export interface GbxCartSinkDeps {
  readonly protocol: CartProtocol;
  readonly family: CartFamily;
  /** Display label for the sink (used in `BackupSink` filenames + UI). */
  readonly label?: string;
}

export class GbxCartSink implements SaveSink {
  readonly label: string;
  constructor(private readonly deps: GbxCartSinkDeps) {
    this.label = deps.label ?? `GbxCart write (${deps.family})`;
  }

  async write(bytes: Uint8Array, opts: SaveSinkOptions = {}): Promise<void> {
    const { protocol, family } = this.deps;
    const signalOpts = opts.signal ? { signal: opts.signal } : {};

    await protocol.setMode(family, signalOpts);
    if (protocol.prepareForWrite) await protocol.prepareForWrite(family, signalOpts);

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
