/**
 * Firmware-family autodetect for the GBxCart RW.
 *
 * Per orchestrator decision Q1 (PLAN_EVAL): we support BOTH stock
 * insidegadgets firmware AND Lesserkuma's FlashGBX firmware. The user
 * shouldn't have to know which one their cart runs.
 *
 * Detection sequence at port-open:
 *  1. Send 'V' (single byte, NO newline). Stock firmware replies with one
 *     byte — the firmware version (uint8). Verified against upstream
 *     gbxcart_rw_console_v1.36/setup.c `request_value()` which sends one
 *     char and reads one byte back.
 *  2. If a sane firmware-version byte comes back (1..99) → stock
 *     insidegadgets.
 *  3. If the read times out, fall through to the LK QUERY_FW_INFO
 *     (0xA1 binary frame).
 *  4. If a length-prefixed banner comes back → Lesserkuma.
 *  5. Otherwise CartError('UNSUPPORTED_FIRMWARE').
 */

import { CartError, type Port } from '../types.js';
import { FrameReader, writeAll } from './framing.js';
import { InsidegadgetsProtocol } from './insidegadgets.js';
import { FlashgbxProtocol } from './flashgbx.js';
import { dlog } from './debug.js';
import type { CartProtocol } from './index.js';

const PROBE_TIMEOUT_MS = 3000 as const;

function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

export interface DetectResult {
  readonly protocol: CartProtocol;
  readonly banner: string;
}

export async function detectProtocol(
  port: Port,
  opts: { signal?: AbortSignal } = {},
): Promise<DetectResult> {
  const reader = new FrameReader(port);
  try {
    // Step 1: stock-firmware probe — single byte 'V', single byte back.
    reader.flush();
    await writeAll(port, ascii('V'));
    let stockFwByte: number | null = null;
    try {
      const fw = await reader.readExactly(1, {
        timeoutMs: PROBE_TIMEOUT_MS,
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      stockFwByte = fw[0] ?? null;
    } catch (e) {
      // TIMEOUT here just means stock didn't respond — fall through to LK.
      // Anything else (DISCONNECTED, CANCELLED) bubbles up below.
      if (e instanceof CartError && e.reason !== 'TIMEOUT') throw e;
    }
    dlog('detect: V probe got', stockFwByte === null ? '(timeout)' : `byte 0x${stockFwByte.toString(16)} (${stockFwByte})`);
    // Carts with Lesserkuma's CFW (firmware "Rxx+Lyy") respond to V with
    // the stock OFW byte for back-compat, BUT only fully respond to
    // bulk-read operations via the LK binary protocol. So we ALWAYS probe
    // for LK after a successful V. If LK responds, use LK. If LK times
    // out, fall back to pure stock.
    dlog('detect: probing for LK QUERY_FW_INFO (in case +Lxx CFW is layered)');
    // LK QUERY_FW_INFO response framing per FlashGBX `hw_GBxCartRW.py`:
    //   byte 0     : metadata-block length (always 8)
    //   bytes 1..8 : struct(">cHBI"):
    //                  cfw_id  (1 byte char,   'L' for Lesserkuma)
    //                  fw_ver  (2 bytes BE u16, e.g. 14 for L14)
    //                  pcb_ver (1 byte u8,     6 for v1.4 a/b/c)
    //                  fw_ts   (4 bytes BE u32, build-date Unix timestamp)
    //   if cfw_id == 'L' and fw_ver >= 12, an extension block follows:
    //     byte n    : name-length k
    //     n+1..n+k  : ASCII device name
    //     +1 byte   : cart_power_ctrl flag
    //     +1 byte   : bootloader_reset flag
    reader.flush();
    // QUERY_FW_INFO is a SINGLE-BYTE command (0xA1). Earlier impl sent a
    // 9-byte frame with 8 zero pad bytes; the firmware interpreted each
    // pad as a NUL no-op and emitted 8 acks that polluted subsequent reads.
    await writeAll(port, new Uint8Array([0xa1]));
    let metaSize: number | null = null;
    try {
      const sizeByte = await reader.readExactly(1, {
        timeoutMs: PROBE_TIMEOUT_MS,
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      metaSize = sizeByte[0] ?? null;
    } catch (e) {
      if (e instanceof CartError && e.reason !== 'TIMEOUT') throw e;
    }
    dlog('detect: LK probe metaSize =', metaSize);
    if (metaSize === 8) {
      const meta = await reader.readExactly(8, {
        timeoutMs: PROBE_TIMEOUT_MS,
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      const cfwId = String.fromCharCode(meta[0]!);
      const fwVer = (meta[1]! << 8) | meta[2]!; // big-endian u16
      const pcbVer = meta[3]!;
      // fwTs at meta[4..7] is informational only — skip for now.
      let name = '';
      if (cfwId === 'L' && fwVer >= 12) {
        const nameLen = await reader.readExactly(1, {
          timeoutMs: PROBE_TIMEOUT_MS,
          ...(opts.signal ? { signal: opts.signal } : {}),
        });
        const k = nameLen[0] ?? 0;
        if (k > 0 && k <= 64) {
          const nameBytes = await reader.readExactly(k, {
            timeoutMs: PROBE_TIMEOUT_MS,
            ...(opts.signal ? { signal: opts.signal } : {}),
          });
          for (const b of nameBytes) {
            if (b !== 0) name += String.fromCharCode(b);
          }
        }
        // cart_power_ctrl + bootloader_reset trailers — drain them.
        try {
          await reader.readExactly(2, {
            timeoutMs: PROBE_TIMEOUT_MS,
            ...(opts.signal ? { signal: opts.signal } : {}),
          });
        } catch {
          /* tolerate older fw without trailers */
        }
      }
      // Newer L-firmware versions append undocumented metadata bytes after
      // the documented trailers (observed: 3 extra bytes on L14/PCB 6 — the
      // FlashGBX desktop client just leaves them in the buffer for the
      // next read). Wait briefly for stragglers to arrive then drain
      // anything that lands so the first SET_VARIABLE ack-read isn't polluted.
      await new Promise((resolve) => setTimeout(resolve, 100));
      for (let drain = 0; drain < 16; drain++) {
        try {
          await reader.readExactly(1, { timeoutMs: 25 });
        } catch {
          break; // timeout = no more bytes in transit
        }
      }
      reader.flush();
      const banner = `${name || 'GBxCart RW'} ${cfwId}${fwVer} (PCB ${pcbVer}, OFW R${stockFwByte ?? '?'})`;
      const proto = new FlashgbxProtocol(port, { reader });
      dlog('detect: → FlashgbxProtocol', banner);
      return { protocol: proto, banner };
    }
    if (stockFwByte !== null && stockFwByte >= 1 && stockFwByte <= 99) {
      const proto = new InsidegadgetsProtocol(port, { reader });
      const banner = `GBxCart RW Firmware R${stockFwByte}`;
      dlog('detect: → InsidegadgetsProtocol (no LK extension found)', banner);
      return { protocol: proto, banner };
    }
    throw new CartError(
      'UNSUPPORTED_FIRMWARE_VARIANT',
      `neither stock nor LK firmware probe yielded a usable response`,
      { stockFwByte: stockFwByte === null ? '(timeout)' : String(stockFwByte) },
    );
  } catch (e) {
    reader.release();
    if (e instanceof CartError) throw e;
    const msg = (e as Error).message ?? String(e);
    // Disambiguate the common "device has been lost" Web Serial error:
    // the OS yanked the port (DTR-reset, ModemManager probing, hub flake).
    if (msg.toLowerCase().includes('device has been lost')) {
      throw new CartError(
        'DISCONNECTED',
        'cart disconnected during firmware probe — try unplugging and re-inserting; on Linux make sure ModemManager is not probing the device',
      );
    }
    throw new CartError('UNSUPPORTED_FIRMWARE', `firmware probe failed: ${msg}`);
  }
}
