/**
 * Stock insidegadgets-firmware protocol implementation.
 *
 * Opcodes derived from upstream
 *   insidegadgets/GBxCart-RW
 *   Interface_Programs/GBxCart_RW_Console_Interface_v1.36/setup.h
 * (verified against the actual file via WebFetch at S7a authoring time).
 *
 *   READ_FIRMWARE_VERSION 'V' (0x56)
 *   READ_PCB_VERSION      'h' (0x68)
 *   SET_START_ADDRESS     'A' (0x41)
 *   READ_ROM_RAM          'R' (0x52)   -- bulk GB ROM/SRAM read
 *   WRITE_RAM             'W' (0x57)   -- per-byte GB SRAM write
 *   SET_BANK              'B' (0x42)
 *   GB_CART_MODE          'G' (0x47)
 *   GBA_CART_MODE         'g' (0x67)
 *   GBA_READ_SRAM         'm' (0x6D)
 *   GBA_WRITE_SRAM        'w' (0x77)
 *   VOLTAGE_3_3V          '3' (0x33)
 *   VOLTAGE_5V            '5' (0x35)
 *
 * Wire conventions (per setup.h + the v1.36 console-interface .c):
 *  - Single-byte commands; numeric parameters sent as ASCII hex (e.g.
 *    `A 4000\n`) or as the raw `0x00` continuation byte for bulk reads.
 *  - Bulk reads: host sends 'R'\n, firmware streams 64 bytes per
 *    SET_START_ADDRESS, then waits for `0x00` to advance another 64.
 *    Read terminates when the host stops sending continuation bytes.
 *  - Numeric tokens are space-separated and newline-terminated.
 *  - The banner reply to 'V' is an ASCII string ending in '\n', e.g.
 *    "GBxCart RW v1.4 PCB Firmware R26\n".
 */

import {
  CartError,
  type FirmwareInfo,
  type CartReadOptions,
  type CartWriteOptions,
} from '../types.js';
import { FrameReader, writeAll } from './framing.js';
import { dlog } from './debug.js';
import type { CartFamily, CartProtocol } from './index.js';

const CHUNK_BYTES = 1024 as const; // smooth onProgress granularity per AMEND-S7a-EVAL-9
const FW_TIMEOUT_MS = 3000 as const; // generous — first-after-open commands can be slow on some USB stacks
const BLOCK_TIMEOUT_MS = 7777 as const; // distinctive number so cache vs real-bug is obvious in user reports

function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function hex(n: number): string {
  return (n >>> 0).toString(16);
}

/** Issued before/after every command stream; sets the firmware's read
 *  cursor to `addr` so subsequent 'R' / 'm' calls return contiguous bytes.
 *
 *  Upstream `set_number()` (gbxcart_rw_console_v1.36/setup.c) sends:
 *    <command><lowercase-hex-of-number><NUL>
 *  i.e. "A4000\0" for addr 0x4000. The terminator is a NUL byte (0x00),
 *  NOT a newline — using \n leaves the firmware waiting for terminator
 *  and silently discards subsequent reads. */
async function setStartAddress(
  reader: FrameReader,
  port: { writable: WritableStream<Uint8Array> },
  addr: number,
): Promise<void> {
  void reader;
  await writeNumberCmd(port as never, 'A', addr);
}

/** Encode upstream `set_number(value, command)` — `<command><lowercase-hex><NUL>`. */
async function writeNumberCmd(
  port: import('../types.js').Port,
  command: string,
  value: number,
): Promise<void> {
  const head = ascii(`${command}${hex(value)}`);
  const out = new Uint8Array(head.length + 1);
  out.set(head, 0);
  out[head.length] = 0x00;
  await writeAll(port, out);
}

export class InsidegadgetsProtocol implements CartProtocol {
  readonly variant = 'insidegadgets' as const;
  private reader: FrameReader;
  private disposed = false;

  constructor(
    private readonly port: import('../types.js').Port,
    opts: { reader?: FrameReader } = {},
  ) {
    this.reader = opts.reader ?? new FrameReader(port);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.reader.release();
  }

  async readFirmware(opts: { signal?: AbortSignal } = {}): Promise<FirmwareInfo> {
    // Stock insidegadgets firmware: 'V' is a single-byte command and
    // returns a SINGLE BYTE (the firmware version as a uint8). NOT a
    // banner string — the original plan was wrong about this. The PCB
    // version is read separately via 'h' with the same single-byte
    // pattern. Verified against the upstream
    // gbxcart_rw_console_v1.36/setup.c `request_value()` impl.
    //
    // No trailing newline on the command, and no newline in the response.
    // Flush any garbage left over from boot/previous session before V.
    this.reader.flush();
    await writeAll(this.port, ascii('V'));
    const fw = await this.reader.readExactly(1, {
      timeoutMs: FW_TIMEOUT_MS,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    const majorRev = fw[0] ?? 0;
    // PCB version (also single-byte response). 1=v1.0, 2=v1.1, 4=v1.3, 5=v1.4, 90=GBxMas.
    let pcb = 0;
    try {
      await writeAll(this.port, ascii('h'));
      const pcbBuf = await this.reader.readExactly(1, {
        timeoutMs: FW_TIMEOUT_MS,
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      pcb = pcbBuf[0] ?? 0;
    } catch {
      // PCB query is informational; tolerate timeout on older firmware.
    }
    const banner = `GBxCart RW PCB ${pcb} Firmware R${majorRev}`;
    return { banner, variant: 'insidegadgets', majorRev };
  }

  async setMode(family: CartFamily, opts: { signal?: AbortSignal } = {}): Promise<void> {
    void opts;
    dlog(`setMode(${family})`);
    // Upstream R26+ firmware (gbxcart_rw_console_v1.36 main.c, PCB v1.4)
    // selects cart mode IMPLICITLY via the voltage byte alone — no separate
    // 'G' / 'g' is sent. Sending the legacy GB_CART_MODE / GBA_CART_MODE
    // bytes after the voltage confuses newer firmware and silently returns
    // zero data on subsequent R/m reads.
    //   '5' (VOLTAGE_5V)   → GB mode  (Pokemon Red/Blue/Yellow)
    //   '3' (VOLTAGE_3_3V) → GBC mode (Pokemon Crystal/Gold/Silver) AND all GBA carts
    if (family === 'gba' || family === 'gbc') {
      await writeAll(this.port, ascii('3'));
    } else {
      await writeAll(this.port, ascii('5'));
    }
    // Cart needs time to power up on the newly-selected rail before the
    // first read attempt, otherwise the bus is still floating and we get
    // back all-zero data. Upstream's per-command 1 ms delay is too short
    // for the initial rail switch — bump to 100 ms here just for setMode.
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  async setBank(bank: number, opts: { signal?: AbortSignal } = {}): Promise<void> {
    void opts;
    // SET_BANK addr, value. For SRAM-bank selection on MBC3/MBC5 the
    // bank index is written to memory address 0x4000. Same NUL-terminator
    // convention as setStartAddress (upstream `set_number`).
    await writeNumberCmd(this.port, 'B', 0x4000);
    await writeNumberCmd(this.port, 'B', bank & 0xff);
  }

  async setRamEnabled(enabled: boolean, opts: { signal?: AbortSignal } = {}): Promise<void> {
    void opts;
    // RAM enable / disable via MBC: write 0x0A to 0x0000 to enable, 0x00 to disable.
    await writeNumberCmd(this.port, 'B', 0x0000);
    await writeNumberCmd(this.port, 'B', enabled ? 0x0a : 0x00);
  }

  async readRom(address: number, length: number, opts: CartReadOptions = {}): Promise<Uint8Array> {
    return this.bulkRead(address, length, /* gba= */ false, opts);
  }

  async readSram(
    family: CartFamily,
    length: number,
    opts: CartReadOptions = {},
  ): Promise<Uint8Array> {
    if (family === 'gba') {
      return this.bulkRead(0x0000, length, /* gba= */ true, opts);
    }
    // GB / GBC SRAM lives at $A000-$BFFF (bank-switched by SET_BANK).
    return this.bulkRead(0xa000, length, /* gba= */ false, opts);
  }

  /**
   * S7b — no-op on stock OFW. Per AMEND-S7b-1/-4 the LK firmware needs a
   * pre-write register prelude + JEDEC chip-ID exit; OFW has no analogue
   * (the stock Flash-write firmware path doesn't expose a register
   * interface). Defined for protocol symmetry so the GbxCartSink doesn't
   * have to special-case OFW.
   */
  async prepareForWrite(family: CartFamily, opts: { signal?: AbortSignal } = {}): Promise<void> {
    void family;
    void opts;
  }

  async writeSram(
    family: CartFamily,
    bytes: Uint8Array,
    opts: CartWriteOptions = {},
  ): Promise<void> {
    const total = bytes.length;
    if (family === 'gba') {
      // S7b: 128 KB AGB Flash writes through stock OFW are not supported
      // — the stock firmware's 'w' opcode targets flat SRAM; Flash-cart
      // erase/program needs JEDEC plumbing the OFW doesn't expose
      // cleanly. Direct user to LK CFW (`cart-write-baud=1m` URL flag is
      // a separate bisection lever per AMEND-S7b-19; the firmware swap
      // is the actual fix).
      if (total > 0x10000) {
        throw new CartError(
          'UNSUPPORTED_FIRMWARE',
          'AGB Flash writes (128 KB) require Lesserkuma CFW (L12+). Stock OFW is read-only for >64 KB carts in this tool.',
        );
      }
      // Per-page 64-byte SRAM writes via 'w'.
      const PAGE = 64;
      for (let off = 0; off < total; off += PAGE) {
        if (opts.signal?.aborted) throw new CartError('CANCELLED', 'write aborted');
        await setStartAddress(this.reader, this.port, off);
        await writeAll(this.port, ascii('w'));
        const slice = bytes.subarray(off, Math.min(off + PAGE, total));
        await writeAll(this.port, slice);
        const ack = await this.reader.readExactly(1, {
          timeoutMs: BLOCK_TIMEOUT_MS,
          ...(opts.signal ? { signal: opts.signal } : {}),
        });
        if (ack[0] !== 0x31 /* '1' */) {
          throw new CartError('WRITE_FAILED', `GBA page write @ ${off} not acked (got ${ack[0]})`);
        }
        opts.onProgress?.({ bytesWritten: Math.min(off + PAGE, total), bytesTotal: total });
      }
      return;
    }
    // GB per-byte SRAM write via 'W'. Slow but matches stock firmware. The
    // S7b cart-mode UI gates DMG writes to LK firmware only (per PLAN §1.3
    // OOS) so this path mostly exists for the conformance swap-test +
    // anyone running a stock-only board for development.
    await setStartAddress(this.reader, this.port, 0xa000);
    for (let off = 0; off < total; off++) {
      if (opts.signal?.aborted) throw new CartError('CANCELLED', 'write aborted');
      await writeNumberCmd(this.port, 'W', bytes[off]!);
      const ack = await this.reader.readExactly(1, {
        timeoutMs: BLOCK_TIMEOUT_MS,
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      if (ack[0] !== 0x31 /* '1' */) {
        throw new CartError('WRITE_FAILED', `GB byte write @ ${off} not acked (got ${ack[0]})`);
      }
      if ((off & 0xff) === 0xff || off === total - 1) {
        opts.onProgress?.({ bytesWritten: off + 1, bytesTotal: total });
      }
    }
  }

  /**
   * Bulk read N bytes from the firmware's current cursor. The firmware
   * streams EXACTLY 64 bytes per command, then waits for a continuation
   * byte before sending the next 64. So the read loop is strictly:
   *
   *   send 'R' or 'm'        // start stream — first 64 bytes will arrive
   *   for each 64-byte block:
   *     readExactly(64)
   *     if more wanted: send '1' (continue)
   *     else:           send '0' (stop)
   *
   * Verified against upstream gbxcart_rw_console_v1.36 main.c
   * `com_read_bytes` / `com_read_cont` / `com_read_stop`. We accumulate
   * 64-byte blocks into `CHUNK_BYTES`-sized progress hops to avoid
   * spamming `onProgress` callbacks.
   */
  private async bulkRead(
    startAddr: number,
    length: number,
    gba: boolean,
    opts: CartReadOptions,
  ): Promise<Uint8Array> {
    if (length <= 0) return new Uint8Array(0);
    const FIRMWARE_BLOCK = 64;
    const totalBlocks = Math.ceil(length / FIRMWARE_BLOCK);
    dlog(
      `bulkRead start addr=0x${startAddr.toString(16)} len=${length} blocks=${totalBlocks} gba=${gba}`,
    );
    const out = new Uint8Array(totalBlocks * FIRMWARE_BLOCK);
    let off = 0;
    await setStartAddress(this.reader, this.port, startAddr);
    await writeAll(this.port, ascii(gba ? 'm' : 'R'));
    let blocksRead = 0;
    let lastProgressAt = 0;
    while (blocksRead < totalBlocks) {
      if (opts.signal?.aborted) throw new CartError('CANCELLED', 'read aborted');
      const block = await this.reader.readExactly(FIRMWARE_BLOCK, {
        timeoutMs: BLOCK_TIMEOUT_MS,
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      out.set(block, off);
      off += FIRMWARE_BLOCK;
      blocksRead++;
      const isLast = blocksRead === totalBlocks;
      await writeAll(this.port, new Uint8Array([isLast ? 0x30 : 0x31]));
      if (off - lastProgressAt >= CHUNK_BYTES || isLast) {
        opts.onProgress?.({ bytesRead: Math.min(off, length), bytesTotal: length });
        lastProgressAt = off;
      }
    }
    // Truncate any padding from the final block if length wasn't 64-aligned.
    return off === length ? out : out.subarray(0, length);
  }
}
