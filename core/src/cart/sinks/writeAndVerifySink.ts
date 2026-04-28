/**
 * WriteAndVerifySink — composable `SaveSink` decorator that:
 *   1. Forwards write to `inner.write(bytes, opts)`.
 *   2. Re-reads the cart's full SRAM via the supplied protocol+family.
 *   3. Diffs re-read against the bytes argument; throws WriteVerifyError
 *      on mismatch.
 *
 * Per AMEND-S7b-6: the verify-comparison `expected` is the SAME `bytes`
 * argument the sink received — captured by closure at call time, NOT
 * re-derived from the staging-store. Documented contract: the caller
 * MUST pass the exact buffer they want to be on the cart at the end of
 * the call. Don't shadow this with a "current state" lookup.
 *
 * Per AMEND-S7b-12: NO diff masking on AGB Flash. The strict full-range
 * diff is intentional — a real-hardware false-positive would surface as
 * a known-flapping byte range we'd then narrow specifically, NOT widen
 * blindly. AMEND-S6a-1's active-slot writeback policy means the
 * save_index footer doesn't auto-rotate from a flash-from-tool write,
 * so no false-positive is expected.
 */

import { CartError } from '../types.js';
import type { CartProtocol, CartFamily } from '../protocol/index.js';
import { diffBytes } from '../protocol/agbFlash.js';
import type { SaveSink, SaveSinkOptions } from '../../sav/saveSink.js';
import type { WriteVerifyMismatch } from './types.js';

/** Diagnostic shape of the verify failure — surfaced via WriteVerifyError. */
export type WriteVerifyDiagnosis =
  | { kind: 'real_corruption' }
  /** Every readback byte was the same single value (e.g. 0xFF / 0xF3
   *  / 0x00). Classic "RAM disabled / bus floating" signature, NOT a
   *  real corrupted-write pattern. */
  | { kind: 'all_same_byte_readback'; byte: number };

function diagnose(actual: Uint8Array): WriteVerifyDiagnosis {
  if (actual.length === 0) return { kind: 'real_corruption' };
  const first = actual[0]!;
  for (let i = 1; i < actual.length; i++) {
    if (actual[i] !== first) return { kind: 'real_corruption' };
  }
  return { kind: 'all_same_byte_readback', byte: first };
}

function diagnosisMessage(d: WriteVerifyDiagnosis, count: number, firstOff: number): string {
  const base = `WriteVerify: ${count} byte(s) mismatched (first @ offset 0x${firstOff.toString(16)})`;
  if (d.kind === 'all_same_byte_readback') {
    const hex = '0x' + d.byte.toString(16).padStart(2, '0');
    return (
      `${base}. Every readback byte = ${hex} — this is a stuck-bus / ` +
      `RAM-disabled signature, NOT a real write corruption. The cart ` +
      `either lost MBC RAM-enable state mid-op, lost power, or uses a ` +
      `save chip (FRAM / Flash) that needs a different write protocol ` +
      `than standard SRAM (some custom carts — e.g. insideGadgets FRAM ` +
      `with software write-protect — silently drop SRAM-style writes). ` +
      `Try unplugging + replugging the cart and retrying. If the same ` +
      `${hex}-everywhere pattern repeats, your cart isn't compatible ` +
      `with the standard MBC3 SRAM write path.`
    );
  }
  return base;
}

export class WriteVerifyError extends Error {
  readonly mismatch: WriteVerifyMismatch;
  /** Re-read bytes for the recovery dialog ("download what's on the cart now"). */
  readonly actual: Uint8Array;
  /** The bytes the sink TRIED to write — same as `expected`. Useful when
   *  the controller wants to attempt a re-write of the same buffer. */
  readonly expected: Uint8Array;
  /** Heuristic classification of the verify failure. */
  readonly diagnosis: WriteVerifyDiagnosis;
  constructor(args: { mismatch: WriteVerifyMismatch; actual: Uint8Array; expected: Uint8Array }) {
    const diagnosis = diagnose(args.actual);
    super(
      diagnosisMessage(diagnosis, args.mismatch.mismatchCount, args.mismatch.firstMismatchOffset),
    );
    this.name = 'WriteVerifyError';
    this.mismatch = args.mismatch;
    this.actual = args.actual;
    this.expected = args.expected;
    this.diagnosis = diagnosis;
  }
}

export function isWriteVerifyError(x: unknown): x is WriteVerifyError {
  return x instanceof WriteVerifyError;
}

export interface WriteAndVerifySinkDeps {
  readonly inner: SaveSink;
  readonly protocol: CartProtocol;
  readonly family: CartFamily;
  /**
   * Test seam — defaults to `protocol.readSram(family, length)`. The
   * round-trip integration test injects a deterministic mock.
   */
  readonly readback?: (length: number, opts: { signal?: AbortSignal }) => Promise<Uint8Array>;
}

const DMG_BANK_BYTES = 8 * 1024;

export class WriteAndVerifySink implements SaveSink {
  readonly label: string;
  constructor(private readonly deps: WriteAndVerifySinkDeps) {
    this.label = `Verify ${deps.inner.label}`;
  }

  /**
   * Full-save readback for verify. For DMG/GBC carts we MUST bracket the
   * read with setRamEnabled(true/false) AND bank-switch per 8 KB chunk
   * — the cart's MBC only exposes 8 KB of SRAM at 0xA000..0xBFFF at a
   * time, and the GbxCartSink's write path ends with setRamEnabled(false)
   * so RAM is latched off until we re-enable it. Without both, reads
   * return 0xFF (RAM disabled) or walk past 0xBFFF into unmapped space.
   *
   * For AGB we just call readSram — Flash banking is handled inside the
   * protocol's readAgbFlashBanked helper.
   *
   * Mirrors the S7a read flow in `core/src/cart/gbxCartSource.ts:81-118`.
   */
  private async readFullSram(
    totalBytes: number,
    signalOpts: { signal?: AbortSignal },
    onProgress?: (p: { bytesWritten: number; bytesTotal: number }) => void,
  ): Promise<Uint8Array> {
    const { protocol, family } = this.deps;
    if (family === 'gba') {
      return protocol.readSram(family, totalBytes, {
        ...signalOpts,
        ...(onProgress
          ? {
              onProgress: (p) =>
                onProgress({
                  bytesWritten: Math.floor(
                    totalBytes * 0.8 + (p.bytesRead / p.bytesTotal) * (totalBytes * 0.2),
                  ),
                  bytesTotal: totalBytes,
                }),
            }
          : {}),
      });
    }

    await protocol.setRamEnabled(true, signalOpts);
    try {
      const out = new Uint8Array(totalBytes);
      const banks = Math.max(1, Math.ceil(totalBytes / DMG_BANK_BYTES));
      let off = 0;
      for (let b = 0; b < banks; b++) {
        if (banks > 1) await protocol.setBank(b, signalOpts);
        const want = Math.min(DMG_BANK_BYTES, totalBytes - off);
        const chunk = await protocol.readSram(family, want, {
          ...signalOpts,
          ...(onProgress
            ? {
                onProgress: (p) =>
                  onProgress({
                    bytesWritten: Math.floor(
                      totalBytes * 0.8 + ((off + p.bytesRead) / totalBytes) * (totalBytes * 0.2),
                    ),
                    bytesTotal: totalBytes,
                  }),
              }
            : {}),
        });
        out.set(chunk, off);
        off += chunk.length;
      }
      return out;
    } finally {
      try {
        await protocol.setRamEnabled(false, signalOpts);
      } catch {
        /* shutdown best-effort — cleanup hook handles port-close ordering */
      }
    }
  }

  async write(bytes: Uint8Array, opts: SaveSinkOptions = {}): Promise<void> {
    // Per AMEND-S7b-6: capture the reference at the start of the call so
    // a mid-write mutation of the source buffer (cosmic-ray, tab swap,
    // staging-store edit) doesn't change what we verify against.
    const expected = bytes;
    const totalBytes = expected.length;

    await this.deps.inner.write(expected, {
      ...opts,
      ...(opts.onProgress
        ? {
            onProgress: (p) =>
              opts.onProgress!({
                // Reserve the upper 20% of the bar for the verify pass so
                // the user sees forward progress through the slower phase.
                bytesWritten: Math.min(Math.floor(p.bytesWritten * 0.8), totalBytes - 1),
                bytesTotal: totalBytes,
              }),
          }
        : {}),
    });

    const signalOpts = opts.signal ? { signal: opts.signal } : {};
    const reread = this.deps.readback
      ? await this.deps.readback(totalBytes, signalOpts)
      : await this.readFullSram(totalBytes, signalOpts, opts.onProgress);

    if (reread.length !== expected.length) {
      throw new WriteVerifyError({
        mismatch: {
          expectedLength: expected.length,
          actualLength: reread.length,
          mismatchCount: Math.max(expected.length, reread.length),
          mismatches: [],
          firstMismatchOffset: -1,
        },
        actual: reread,
        expected,
      });
    }

    const diff = diffBytes(expected, reread);
    if (diff.mismatchCount === 0) {
      opts.onProgress?.({ bytesWritten: totalBytes, bytesTotal: totalBytes });
      return;
    }
    const firstMismatch = diff.mismatches[0];
    // HIL diagnostic: log the first ~10 mismatches with offset + expected/actual
    // values. Helps distinguish "bank-switch race" (bank-1 tail leaking into
    // bank-2 read) from "write didn't take" (cart shows pre-flash bytes) from
    // "checksum auto-recompute" (cart silently changed bytes after flash).
    if (typeof console !== 'undefined' && diff.mismatchCount > 0) {
      const sample = diff.mismatches.slice(0, 10).map((m) => ({
        offset: '0x' + m.offset.toString(16).padStart(8, '0'),
        expected: '0x' + m.expected.toString(16).padStart(2, '0'),
        actual: '0x' + m.actual.toString(16).padStart(2, '0'),
      }));
      console.error('[verify] mismatches', { count: diff.mismatchCount, first10: sample });
    }
    throw new WriteVerifyError({
      mismatch: {
        expectedLength: expected.length,
        actualLength: reread.length,
        mismatchCount: diff.mismatchCount,
        mismatches: diff.mismatches,
        firstMismatchOffset: firstMismatch ? firstMismatch.offset : -1,
      },
      actual: reread,
      expected,
    });
  }
}

/** Convenience type guard for callers that want to disambiguate error classes. */
export function isCartError(x: unknown): x is CartError {
  return x instanceof CartError;
}
