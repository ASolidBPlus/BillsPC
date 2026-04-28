/**
 * Recovery flow — re-flash a backup .sav onto the cart after a write
 * failure. Per AMEND-S7b-14 / DECISION-7: the controller caps recovery
 * at 3 attempts. After 3 failed attempts, the dialog switches to "use
 * FlashGBX manually" copy with no Retry button.
 *
 * Two backup-byte sources:
 *   1. In-memory — the controller still holds the pre-flash bytes
 *      (captured by `flashCart` and threaded into `cart_flash_failed`
 *      state). Preferred path.
 *   2. User re-upload — if the controller crashed and lost the in-memory
 *      ref, the recovery dialog includes a file-input; we rebuild from
 *      that.
 *
 * The recovery write uses the SAME `WriteAndVerifySink` decorator (so a
 * post-recovery verify still happens). It does NOT use BackupSink — we
 * don't backup the corrupted bytes; that would be useless.
 */

import {
  CartError,
  detectProtocol,
  detectMapperOrThrow,
  GbxCartSink,
  parseCartHeader,
  WriteAndVerifySink,
  WriteVerifyError,
  isCartError,
  type CartFamily,
  type CartProtocol,
  type DmgMapper,
  type Port,
  type SaveSinkProgress,
} from '@pokeportal/core';

export const MAX_RECOVERY_ATTEMPTS = 3 as const;

export interface RecoveryDeps {
  readonly requestPort: () => Promise<Port>;
  readonly writeChunkBytes?: 64 | 256;
}

export interface RecoveryOptions {
  readonly backupBytes: Uint8Array;
  readonly backupFilename: string;
  readonly family: CartFamily;
  readonly signal?: AbortSignal;
  readonly onProgress?: (p: SaveSinkProgress) => void;
}

export type RecoveryResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'failed'; readonly error: CartError | WriteVerifyError };

export async function restoreFromBackup(
  deps: RecoveryDeps,
  opts: RecoveryOptions,
): Promise<RecoveryResult> {
  let port: Port | null = null;
  let detectedProtocol: CartProtocol | null = null;
  const expected = new Uint8Array(opts.backupBytes);

  try {
    port = await deps.requestPort();
    const detected = await detectProtocol(port, opts.signal ? { signal: opts.signal } : {});
    detectedProtocol = detected.protocol;
    if (
      deps.writeChunkBytes &&
      typeof (detectedProtocol as { writeChunkBytes?: number }).writeChunkBytes === 'number'
    ) {
      (detectedProtocol as unknown as { writeChunkBytes: number }).writeChunkBytes =
        deps.writeChunkBytes;
    }

    // S9: detect the DmgMapper for the cart we're restoring onto. Same
    // approach as cartFlasher — read the ROM header and pass the
    // resulting mapper into the sink. UNSUPPORTED_CART surfaces the
    // verbatim Q2 user-facing message.
    let mapper: DmgMapper | undefined;
    if (opts.family !== 'gba') {
      await detectedProtocol.setMode(opts.family, opts.signal ? { signal: opts.signal } : {});
      const headerBytes = await detectedProtocol.readRom(
        0x0000,
        0x150,
        opts.signal ? { signal: opts.signal } : {},
      );
      const header = parseCartHeader(headerBytes);
      if (!header) {
        throw new CartError(
          'UNSUPPORTED_CART',
          'cart header could not be parsed for mapper detection',
        );
      }
      mapper = detectMapperOrThrow(header.cartType);
    }

    const inner = new GbxCartSink({
      protocol: detectedProtocol,
      family: opts.family,
      ...(mapper ? { mapper } : {}),
      label: `Recovery restore`,
    });
    const verifySink = new WriteAndVerifySink({
      inner,
      protocol: detectedProtocol,
      family: opts.family,
    });
    await verifySink.write(expected, {
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
    });
    return { kind: 'ok' };
  } catch (e) {
    if (e instanceof WriteVerifyError || isCartError(e)) {
      return { kind: 'failed', error: e };
    }
    return {
      kind: 'failed',
      error: new CartError('DISCONNECTED', `recovery failed: ${(e as Error).message}`),
    };
  } finally {
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

/** Read user-uploaded backup bytes from a File / Blob object. Falls back
 *  to FileReader if `arrayBuffer()` isn't on the prototype (older
 *  browsers, jsdom). */
export async function readBackupFile(file: Blob): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') {
    const buf = await file.arrayBuffer();
    return new Uint8Array(buf);
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (): void => {
      const r = reader.result;
      if (r instanceof ArrayBuffer) resolve(new Uint8Array(r));
      else reject(new Error('readBackupFile: FileReader did not return an ArrayBuffer'));
    };
    reader.onerror = (): void => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsArrayBuffer(file);
  });
}
