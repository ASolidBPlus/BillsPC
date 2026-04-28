/**
 * Top-level "flash this cart with these bytes" coordinator (mirror of
 * cartReader.ts but for writes). Owns the port lifecycle for a single
 * write attempt:
 *
 *   1. Open port via deps.requestPort.
 *   2. detectProtocol → pick LK / OFW.
 *   3. Construct sink stack: BackupSink → WriteAndVerifySink → GbxCartSink.
 *   4. Run sink.write(bytes) — this fires backup → write → verify.
 *   5. On any error, route to the right cart_flash_failed state with
 *      `recoveryAvailable` populated when the backup landed.
 *   6. Finally: protocol.cleanup() (per AMEND-S7b-20 cleanup hook MUST
 *      fire — downgrades baud back to 1M) THEN port.close().
 *
 * Per AMEND-S7b-6: the bytes argument MUST be a copy made at commit-
 * click time (the controller copies before calling). The wrapper here
 * threads the same reference through both BackupSink (preWriteBytes)
 * and the inner write call so the recovery path can re-use the backup.
 *
 * Per AMEND-S7b-7: BackupSink failure → cart_flash_failed with
 * `recoveryAvailable: null` (no flash happened, nothing to recover from).
 *
 * Per AMEND-S7b-19 / -20: writes happen at the same baud as reads
 * (1.5M post-S7a-3 upgrade). The cleanup() call in the finally block
 * downgrades the firmware UART back to 1M before close so the next
 * session can re-handshake without a physical cart power-cycle.
 */

import {
  CartError,
  detectProtocol,
  GbxCartSink,
  WriteAndVerifySink,
  WriteVerifyError,
  isCartError,
  type CartFamily,
  type CartProtocol,
  type Port,
  type SaveSinkProgress,
} from '@pokeportal/core';
import { BackupSink, type BackupSinkDeps } from './backupSink.js';

export interface CartFlasherDeps {
  readonly requestPort: () => Promise<Port>;
  readonly backupSinkDeps?: BackupSinkDeps;
  /**
   * Per AMEND-S7b-3 + DECISION-6: HIL bisection lever. When set, the
   * FlashgbxProtocol uses 64-byte page writes instead of the upstream
   * 256-byte default. Resolved by the controller from
   * `?cart-write-chunk=64`.
   */
  readonly writeChunkBytes?: 64 | 256;
  /**
   * Per AMEND-S7b-19 #2: HIL bisection lever for the write-side baud
   * rate. Default behaviour (undefined or 1_500_000) keeps the
   * post-S7a-3 1.5M upgrade. Setting `1_000_000` instructs the
   * protocol to skip the 1.5M upgrade entirely so writes happen at
   * 1M, mirroring FlashGBX's pre-PCB-5 path. Resolved by the
   * controller from `?cart-write-baud=1m`.
   */
  readonly writeBaud?: 1_000_000 | 1_500_000;
}

export type CartFlashPhase = 'connecting' | 'detecting' | 'backup' | 'flashing' | 'verifying';

export interface CartFlashOptions {
  readonly bytes: Uint8Array;
  /**
   * The cart's CURRENT (pre-write) bytes, captured by the initial S7a
   * read at session start. Used as the backup file content. Avoids a
   * redundant cart re-read at flash time (which would cost ~3-10s and
   * add a new failure point — especially since the cart's already in a
   * known-readable state from when it was first parsed). Per AMEND-S7b-6
   * the controller is responsible for this buffer being correct at the
   * moment commit is clicked.
   */
  readonly cartCurrentBytes: Uint8Array;
  readonly family: CartFamily;
  readonly cartLabel: string;
  readonly tid: number;
  /**
   * Backup filename used by `BackupSink` (caller computes it from
   * `backupFilename(cartLabel, tid)`).
   */
  readonly backupFilename: string;
  readonly signal?: AbortSignal;
  readonly onPhase?: (phase: CartFlashPhase) => void;
  readonly onProgress?: (p: SaveSinkProgress) => void;
}

export type CartFlashResult =
  | {
      readonly kind: 'ok';
      /** Bytes confirmed on the cart (by definition === options.bytes). */
      readonly verifiedBytes: Uint8Array;
    }
  | {
      readonly kind: 'failed';
      readonly error: CartError | WriteVerifyError;
      /** Populated iff the BackupSink succeeded — i.e. there's a file on
       *  disk the user can re-flash. null if backup itself failed (per
       *  AMEND-S7b-7). */
      readonly recoveryAvailable: { backupFilename: string; backupBytes: Uint8Array } | null;
    };

/**
 * `flashCart` — the cart-write equivalent of `readCart`. The controller
 * wraps it with state-dispatches (see `web/src/ui.ts handleCartFlash`).
 */
export async function flashCart(
  deps: CartFlasherDeps,
  opts: CartFlashOptions,
): Promise<CartFlashResult> {
  let port: Port | null = null;
  let detectedProtocol: CartProtocol | null = null;
  // Per AMEND-S7b-6: preserve a snapshot of the bytes-at-call-time so
  // the recovery path verifies against the exact buffer the user
  // committed (not a post-mutation staging-store view).
  const expected = new Uint8Array(opts.bytes);
  // HIL-fix: the BACKUP must contain the cart's CURRENT (pre-write)
  // state — NOT a copy of the bytes we're about to write. The original
  // impl treated `opts.bytes` as both the write target AND the backup,
  // which made restore-from-backup a no-op (the backup would re-flash
  // the same buggy/intended state, never the actual pre-write cart
  // contents). Read the cart fresh below; backupBytesSnapshot is set
  // from that read before BackupSink construction.
  let backupBytesSnapshot: Uint8Array | null = null;
  let backupSucceeded = false;

  try {
    opts.onPhase?.('connecting');
    port = await deps.requestPort();
    opts.onPhase?.('detecting');
    const detected = await detectProtocol(
      port,
      opts.signal ? { signal: opts.signal } : {},
      // detectProtocol's options object is { signal? }; the writeChunkBytes
      // hint is set on the protocol AFTER construction via cast — the
      // FlashgbxProtocol constructor accepts it. Stock detect.ts always
      // builds with default opts so we mutate post-detect.
    );
    detectedProtocol = detected.protocol;
    if (
      deps.writeChunkBytes &&
      typeof (detectedProtocol as { writeChunkBytes?: number }).writeChunkBytes === 'number'
    ) {
      // Best-effort runtime override — the protocol's writeChunkBytes is
      // private but we set it via a cast for the HIL bisection lever.
      (detectedProtocol as unknown as { writeChunkBytes: number }).writeChunkBytes =
        deps.writeChunkBytes;
    }
    // AMEND-S7b-19 #2: when the user requests `?cart-write-baud=1m`,
    // suppress the 1.5M upgrade by marking the protocol as "already
    // upgraded" before any setMode/write call runs. The flag is private
    // on FlashgbxProtocol so we set it via a cast — same pattern as the
    // writeChunkBytes lever above. The protocol's `cleanup()` early-
    // returns when `upgraded === false`, so no spurious downgrade fires.
    if (
      deps.writeBaud === 1_000_000 &&
      typeof (detectedProtocol as { upgraded?: boolean }).upgraded === 'boolean'
    ) {
      (detectedProtocol as unknown as { upgraded: boolean }).upgraded = true;
    }

    // HIL-fix: backup is the cart's CURRENT bytes from the initial S7a
    // read (passed in by the controller). NOT a copy of `opts.bytes`
    // (which is the post-mutation buffer we're about to write). NOT a
    // fresh re-read here either (would add ~3-10s + a new failure
    // point — the redundancy was already exposed by a 3000ms timeout
    // on the second read attempt). Defensive copy in case the caller's
    // buffer mutates after handoff.
    backupBytesSnapshot = new Uint8Array(opts.cartCurrentBytes);

    const inner = new GbxCartSink({
      protocol: detectedProtocol,
      family: opts.family,
      label: `${opts.cartLabel} write`,
    });
    const verifySink = new WriteAndVerifySink({
      inner,
      protocol: detectedProtocol,
      family: opts.family,
    });
    const backupSink = new BackupSink(
      verifySink,
      backupBytesSnapshot,
      opts.backupFilename,
      deps.backupSinkDeps,
    );

    opts.onPhase?.('backup');
    // Hooked through-write wraps phase emissions: backup before
    // sink.write call (the BackupSink hits its persistBackup before
    // delegating). For finer-grained phase signalling, controllers can
    // wrap the BackupSink + onProgress directly.
    let phaseEmitted: CartFlashPhase = 'backup';
    await backupSink.write(expected, {
      ...(opts.signal ? { signal: opts.signal } : {}),
      onProgress: (p) => {
        if (phaseEmitted === 'backup') {
          phaseEmitted = 'flashing';
          opts.onPhase?.('flashing');
          backupSucceeded = true;
        }
        // The WriteAndVerifySink reserves the upper 20% for verify; we
        // emit a 'verifying' phase signal at the boundary.
        const ratio = p.bytesTotal > 0 ? p.bytesWritten / p.bytesTotal : 0;
        if (ratio >= 0.8 && phaseEmitted === 'flashing') {
          phaseEmitted = 'verifying';
          opts.onPhase?.('verifying');
        }
        opts.onProgress?.(p);
      },
    });
    return { kind: 'ok', verifiedBytes: expected };
  } catch (e) {
    if (e instanceof WriteVerifyError) {
      return {
        kind: 'failed',
        error: e,
        // Backup definitely succeeded if we got past it.
        recoveryAvailable: backupSucceeded
          ? { backupFilename: opts.backupFilename, backupBytes: backupBytesSnapshot! }
          : null,
      };
    }
    if (isCartError(e)) {
      // AMEND-S7b-7: BACKUP_FAILED → no recovery available.
      const recoveryAvailable =
        e.reason === 'BACKUP_FAILED' || !backupBytesSnapshot
          ? null
          : backupSucceeded
            ? { backupFilename: opts.backupFilename, backupBytes: backupBytesSnapshot }
            : null;
      return { kind: 'failed', error: e, recoveryAvailable };
    }
    return {
      kind: 'failed',
      error: new CartError('DISCONNECTED', `cart flash failed: ${(e as Error).message}`),
      recoveryAvailable:
        backupSucceeded && backupBytesSnapshot
          ? { backupFilename: opts.backupFilename, backupBytes: backupBytesSnapshot }
          : null,
    };
  } finally {
    // Per AMEND-S7b-20: cleanup() runs BEFORE port.close() regardless of
    // success/failure, because its job (downgrade baud back to 1M) needs
    // a still-open port to send the OFW_USART_1_0M_SPEED byte.
    if (detectedProtocol?.cleanup) {
      try {
        await detectedProtocol.cleanup();
      } catch {
        /* best-effort */
      }
    }
    if (port) {
      try {
        await port.close();
      } catch {
        /* best-effort */
      }
    }
  }
}
