/**
 * GbxCartSource — `SaveSource` impl that reads SRAM from a connected
 * GBxCart RW via a `CartProtocol`.
 *
 * The flow:
 *  1. `setMode('gb')` and read 0x150 bytes from ROM 0x0 → cart header.
 *  2. If header parses as GBA → `setMode('gba')` and read again to
 *     re-establish ROM-cursor for the GBA voltage path.
 *  3. Compute SRAM size from the header. Gen 1/2 carts are 8 KB or 32 KB
 *     and may need 4× bank switches (Crystal). Gen 3 carts are 128 KB
 *     linear.
 *  4. Read SRAM in 1 KB chunks (per AMEND-S7a-EVAL-9 — smoother UI),
 *     emit `onProgress` after each chunk.
 *  5. Return raw bytes + metadata; the controller dispatches to
 *     `parseSave` or `parseGen3Save` based on `metadata.family`.
 */

import { CartError, type CartIdentity, type Port } from './types.js';
import type { CartProtocol } from './protocol/index.js';
import { parseCartHeader, type CartHeader } from './protocol/cartHeader.js';
import type { SaveSource, SaveSourceOptions, SaveSourceResult } from './saveSource.js';

export interface GbxCartSourceDeps {
  readonly protocol: CartProtocol;
  readonly banner: string;
}

export class GbxCartSource implements SaveSource {
  readonly label: string;
  private cachedIdentity: CartIdentity | null = null;
  constructor(private readonly deps: GbxCartSourceDeps) {
    this.label = `GBxCart RW (${deps.protocol.variant})`;
  }

  identity(): CartIdentity | null {
    return this.cachedIdentity;
  }

  async read(opts: SaveSourceOptions = {}): Promise<SaveSourceResult> {
    const { protocol } = this.deps;
    const signalOpts = opts.signal ? { signal: opts.signal } : {};

    // Step 1: probe in GB mode first (the cheaper voltage). Read header.
    await protocol.setMode('gb', signalOpts);
    let headerBytes = await protocol.readRom(0x0000, 0x150, signalOpts);
    let header = parseCartHeader(headerBytes);
    if (!header) {
      // Step 2: re-probe in GBA mode.
      await protocol.setMode('gba', signalOpts);
      headerBytes = await protocol.readRom(0x0000, 0x150, signalOpts);
      header = parseCartHeader(headerBytes);
    }
    if (!header) {
      throw new CartError(
        'UNSUPPORTED_CART',
        'unrecognised cart header (no Nintendo logo, no GBA game code)',
      );
    }

    const identity = identityOf(header);
    this.cachedIdentity = identity;

    if (header.kind === 'gba') {
      await protocol.setMode('gba', signalOpts);
      const length = header.ramSizeBytes || 128 * 1024;
      const bytes = await protocol.readSram('gba', length, opts);
      const family =
        bytes.length === 65536 || bytes.length === 131072 ? ('gen3' as const) : undefined;
      return {
        bytes,
        metadata: {
          name: identity.label,
          ...(family ? { family } : {}),
          deviceId: this.deps.banner,
        },
      };
    }

    // GB / GBC SRAM. Crystal (MBC3+RTC) has 4 × 8 KB banks; we read
    // them sequentially when the header reports 32 KB.
    await protocol.setRamEnabled(true, signalOpts);
    try {
      const totalLen = header.ramSizeBytes;
      if (totalLen === 0) {
        throw new CartError('UNSUPPORTED_CART', `cart reports 0 bytes of SRAM (${header.title})`);
      }
      const out = new Uint8Array(totalLen);
      const banks = totalLen <= 8 * 1024 ? 1 : Math.ceil(totalLen / (8 * 1024));
      const perBank = Math.min(8 * 1024, totalLen);
      let off = 0;
      for (let b = 0; b < banks; b++) {
        if (banks > 1) await protocol.setBank(b, signalOpts);
        const want = Math.min(perBank, totalLen - off);
        const chunk = await protocol.readSram(header.kind, want, {
          ...opts,
          onProgress: (p) => {
            opts.onProgress?.({ bytesRead: off + p.bytesRead, bytesTotal: totalLen });
          },
        });
        out.set(chunk, off);
        off += chunk.length;
      }
      const family = out.length === 32 * 1024 ? ('gen2' as const) : ('gen1' as const);
      return {
        bytes: out,
        metadata: {
          name: identity.label,
          family,
          deviceId: this.deps.banner,
        },
      };
    } finally {
      try {
        await protocol.setRamEnabled(false, signalOpts);
      } catch {
        /* shutdown best-effort */
      }
    }
  }
}

function identityOf(header: CartHeader): CartIdentity {
  const kb = header.ramSizeBytes / 1024;
  return {
    kind: header.kind,
    title: header.title,
    cartType: header.cartType,
    ramSizeBytes: header.ramSizeBytes,
    label: `${header.title || '(unknown)'} (${kb} KB)`,
  };
}

/**
 * Convenience factory: opens a session via `detectProtocol(port)` and
 * wraps the resulting `CartProtocol` in a `GbxCartSource`. The caller
 * still owns the `Port` lifecycle — close it when done.
 */
export async function openGbxCartSource(
  port: Port,
  opts: { signal?: AbortSignal } = {},
): Promise<GbxCartSource> {
  const { detectProtocol } = await import('./protocol/detect.js');
  const result = await detectProtocol(port, opts);
  return new GbxCartSource({ protocol: result.protocol, banner: result.banner });
}
