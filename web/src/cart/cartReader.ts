/**
 * Top-level "read this cart" coordinator.
 *
 * Owns the port lifecycle for a single cart-read attempt:
 *   - calls the supplied `requestPort` helper to get a `Port`
 *   - runs `detectProtocol` to pick the firmware family
 *   - constructs a `GbxCartSource` and reads its bytes
 *   - dispatches the correct gen-1/2 vs gen-3 reader
 *   - closes the port (best-effort) when finished or aborted
 *
 * Returns either a successful CartReadResult or a CartError. Disconnect
 * mid-read surfaces as CartError('DISCONNECTED'); user-cancellation
 * surfaces as CartError('CANCELLED').
 */

import {
  CartError,
  detectProtocol,
  GbxCartSource,
  isCartError,
  isSaveError,
  isGen3SaveError,
  parseSave,
  parseGen3Save,
  type CartIdentity,
  type Gen3SaveContents,
  type Port,
  type SaveContents,
  type SaveError,
} from '@pokeportal/core';

export interface CartReadOk {
  readonly kind: 'gen12' | 'gen3';
  readonly bytes: Uint8Array;
  readonly identity: CartIdentity | null;
  readonly banner: string;
  readonly fileName: string;
  readonly gen12?: SaveContents;
  readonly gen3?: Gen3SaveContents;
}

export interface CartReadFail {
  readonly kind: 'error';
  readonly error: CartError | SaveError;
  /**
   * Raw bytes returned by the protocol layer if the failure happened in
   * the parser (not the cart-read itself). Lets the UI offer a "download
   * raw cart dump" button so the user can binary-diff against a known-good
   * read from FlashGBX or similar.
   */
  readonly rawBytes?: Uint8Array;
  /** Suggested filename for the raw dump (cart title or "cart"). */
  readonly rawFileName?: string;
}

export type CartReadResult = CartReadOk | CartReadFail;

export interface CartReadDeps {
  readonly requestPort: () => Promise<Port>;
}

export interface CartReadOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (p: { bytesRead: number; bytesTotal: number }) => void;
  readonly onPhase?: (phase: 'connecting' | 'detecting' | 'reading' | 'parsing') => void;
}

export async function readCart(
  deps: CartReadDeps,
  opts: CartReadOptions = {},
): Promise<CartReadResult> {
  let port: Port | null = null;
  let detectedProtocol: import('@pokeportal/core').CartProtocol | null = null;
  try {
    opts.onPhase?.('connecting');
    port = await deps.requestPort();

    opts.onPhase?.('detecting');
    const detected = await detectProtocol(port, opts.signal ? { signal: opts.signal } : {});
    detectedProtocol = detected.protocol;

    const onDisconnect = (): void => {
      // We can't synthesise an abort here without an AbortController held
      // by the caller. The session's bulk-read polls on the signal each
      // chunk, so the most we can do is rely on the underlying stream
      // surfacing a closed reader (which `framing.ts` translates to
      // CartError('DISCONNECTED')).
    };
    if (port.addEventListener) port.addEventListener('disconnect', onDisconnect);

    const source = new GbxCartSource({ protocol: detected.protocol, banner: detected.banner });
    opts.onPhase?.('reading');
    const result = await source.read({
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
    });

    opts.onPhase?.('parsing');
    const rawFileName = filenameFromIdentity(source.identity()).replace(/\.sav$/i, '.raw.sav');
    if (result.metadata.family === 'gen3') {
      const parsed = parseGen3Save(result.bytes);
      if (isGen3SaveError(parsed)) {
        return {
          kind: 'error',
          error: {
            kind: 'save_error',
            reason: parsed.reason === 'TOO_SHORT' ? 'TOO_SHORT' : 'CORRUPTED',
            message: parsed.message,
          },
          rawBytes: result.bytes,
          rawFileName,
        };
      }
      return {
        kind: 'gen3',
        bytes: result.bytes,
        identity: source.identity(),
        banner: detected.banner,
        fileName: filenameFromIdentity(source.identity()),
        gen3: parsed,
      };
    }
    const parsed = parseSave(result.bytes);
    if (isSaveError(parsed)) {
      return { kind: 'error', error: parsed, rawBytes: result.bytes, rawFileName };
    }
    return {
      kind: 'gen12',
      bytes: result.bytes,
      identity: source.identity(),
      banner: detected.banner,
      fileName: filenameFromIdentity(source.identity()),
      gen12: parsed,
    };
  } catch (e) {
    if (isCartError(e)) return { kind: 'error', error: e };
    return {
      kind: 'error',
      error: new CartError('DISCONNECTED', `cart read failed: ${(e as Error).message}`),
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
        /* ignore — port may already be torn down */
      }
    }
  }
}

function filenameFromIdentity(identity: CartIdentity | null): string {
  const safe = (identity?.title ?? 'cart').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${safe || 'cart'}.sav`;
}
