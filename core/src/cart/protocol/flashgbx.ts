/**
 * Lesserkuma FlashGBX-firmware (CFW "L" extension) protocol implementation.
 *
 * Faithfully implements the subset of LK_Device.py needed to read DMG /
 * GBC / GBA cartridges via a GBxCart RW running stock firmware Rxx +Lyy
 * CFW (L12 or higher — what most contemporary boards ship with).
 *
 * Wire shape per upstream `lesserkuma/FlashGBX/FlashGBX/LK_Device.py`:
 *
 *   Set fw variable:  [0xA6][size][key u32 BE][value u32 BE] → ack u8 (0x01/0x03)
 *   Get fw variable:  [0xAD][size][key u32 BE]              → response u32 BE
 *   Voltage 5V:       [0xA5]                                 → ack
 *   Voltage 3.3V:     [0xA4]                                 → ack
 *   Cart power on:    [0xF2]                                 → ack
 *   Cart power off:   [0xF3]                                 → ack
 *   DMG MBC reset:    [0xB4]                                 → ack
 *   DMG cart write:   [0xB2][addr u32 BE][value u8]          → ack
 *   DMG cart read:    [0xB1]                                 → TRANSFER_SIZE bytes
 *                       (TRANSFER_SIZE / ADDRESS / DMG_ACCESS_MODE pre-set)
 *
 * Read flow (DMG ROM):
 *   1. set TRANSFER_SIZE = chunk
 *   2. set ADDRESS = absolute_addr
 *   3. set DMG_ACCESS_MODE = 1 (ROM)
 *   4. loop: send 0xB1, read TRANSFER_SIZE bytes  (firmware auto-increments)
 *
 * Read flow (DMG RAM):
 *   1. set TRANSFER_SIZE = chunk
 *   2. set ADDRESS = 0xA000 + relative_addr
 *   3. set DMG_ACCESS_MODE = 3 (RAM)
 *   4. set DMG_READ_CS_PULSE = 1
 *   5. loop: send 0xB1, read TRANSFER_SIZE bytes
 *   6. set DMG_READ_CS_PULSE = 0
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
import {
  AGB_FLASH_SECTOR_BYTES,
  agbFlashSectorPlan,
  flashErrorMeta,
  JedecFlash,
  type AgbFlashSector,
} from './agbFlash.js';

const FW_TIMEOUT_MS = 3000 as const;
const ACK_TIMEOUT_MS = 3000 as const;
const BLOCK_TIMEOUT_MS = 7000 as const;
/** Reads stay at 64 (per AMEND-S7a-11 — Chrome's USB CDC ReadableStream
 *  delivers overlapping sub-chunks at TRANSFER_SIZE > 64). */
const TRANSFER_CHUNK = 64 as const;
/**
 * Writes use 256 (per AMEND-S7b-3 + DECISION-6). AMEND-S7a-11's overlap
 * symptom is a *device→host* artefact; writes flow host→device through
 * `port.writable` which doesn't have it. Mirrors the FlashGBX trace at
 * `flashgbx-write-dmg-pokemon-red.log:1005-1115` and the AGB Flash trace
 * lines 223/253/283/313 etc. The `?cart-write-chunk=64` URL flag (see
 * `cartFlasher.ts`) downgrades to the read-symmetric 64 path for HIL
 * bisection.
 */
const WRITE_CHUNK_DEFAULT = 256 as const;

// Opcodes — LK_Device.DEVICE_CMD subset (the ones we actually use). Other
// opcodes (OP_AGB_CART_READ 0xC1, OP_AGB_CART_WRITE 0xC2, OP_CART_PWR_OFF
// 0xF3) are defined upstream but not needed by S7a's read-only flow; add
// here if S7b/S8 needs.
const OP_OFW_USART_1_0M_SPEED = 0x3c;
const OP_OFW_USART_1_5M_SPEED = 0x3e;
const OP_QUERY_FW_INFO = 0xa1;
const OP_SET_VOLTAGE_3_3V = 0xa4;
const OP_SET_VOLTAGE_5V = 0xa5;
const OP_SET_VARIABLE = 0xa6;
const OP_DMG_CART_READ = 0xb1;
const OP_DMG_CART_WRITE = 0xb2;
const OP_DMG_CART_WRITE_SRAM = 0xb3;
const OP_DMG_MBC_RESET = 0xb4;
const OP_AGB_CART_READ_SRAM = 0xc3;
const OP_AGB_CART_WRITE_SRAM = 0xc4;
// HIL: distinct opcode for AGB FLASH writes (Pokemon R/S/E/FR/LG carts).
// The firmware treats AGB_CART_WRITE_SRAM as a true SRAM bus write — fine
// for non-Flash GBA carts (32KB/64KB SRAM), but a silent no-op against
// the Flash chip in Pokemon Ruby etc. Per LK_Device.py:74 the right
// opcode is AGB_CART_WRITE_FLASH_DATA = 0xC7, followed by a method byte
// (1 for 1M Flash; 2 for 0x1F3D 512K Flash). Default to method=1.
const OP_AGB_CART_WRITE_FLASH_DATA = 0xc7;
const AGB_FLASH_WRITE_METHOD_DEFAULT = 1;
const OP_AGB_CART_READ = 0xc1;
const OP_AGB_BOOTUP_SEQUENCE = 0xc9;
const OP_CART_PWR_ON = 0xf2;

/**
 * fw-variable map: name → [size_bytes, key_id]. Mirrors LK DEVICE_VAR
 * **byte-for-byte** from FlashGBX upstream (`LK_Device.py` `DEVICE_VAR`
 * dict — https://github.com/lesserkuma/FlashGBX).
 *
 * IMPORTANT — DO NOT INFER ENTRIES (per AMEND-S7b-1 + DECISION-1 + DECISION-8):
 *
 *   The LK firmware dispatches setvar/getvar by the `(size, key)` TUPLE,
 *   NOT by `key` alone. That's why some entries below share `key: 0x00`
 *   (ADDRESS u32 vs TRANSFER_SIZE u16 vs CART_MODE u8) — they're all
 *   distinct registers because their `size` byte differs. The firmware
 *   sees them as `(size=4, key=0)` / `(size=2, key=0)` / `(size=1, key=0)`.
 *
 *   When adding a new var: copy the `(size, key)` tuple from
 *   `LK_Device.py:90-118` verbatim. Inferring a key id from "the next
 *   number" or "what looks similar" can collide silently with an existing
 *   register and on a write path that means BUS DRIVING THE WRONG CS PULSE
 *   → CART CORRUPTION. The ~5 minutes saved is not worth one bricked save.
 *
 *   `size` in the upstream source is in BITS (8/16/32); we translate to
 *   bytes here (1/2/4) because that's what the OP_SET_VARIABLE wire byte
 *   needs.
 */
type VarSize = 1 | 2 | 4;
const VARS: Record<string, { size: VarSize; key: number }> = {
  ADDRESS: { size: 4, key: 0x00 },
  AUTO_POWEROFF_TIME: { size: 4, key: 0x01 },
  TRANSFER_SIZE: { size: 2, key: 0x00 },
  // Per AMEND-S7b-1 / DECISION-1: STATUS_REGISTER family for AGB Flash
  // pre-flash setup (see `flashgbx-write-agb-pokemon-ruby-jp.log:159-160`
  // and the DMG write log lines 984-985). All sized 16-bit per upstream.
  STATUS_REGISTER: { size: 2, key: 0x03 },
  STATUS_REGISTER_MASK: { size: 2, key: 0x05 },
  STATUS_REGISTER_VALUE: { size: 2, key: 0x06 },
  CART_MODE: { size: 1, key: 0x00 },
  DMG_ACCESS_MODE: { size: 1, key: 0x01 },
  DMG_READ_CS_PULSE: { size: 1, key: 0x08 },
  DMG_WRITE_CS_PULSE: { size: 1, key: 0x09 },
  DMG_READ_METHOD: { size: 1, key: 0x0b },
  AGB_READ_METHOD: { size: 1, key: 0x0c },
  // Per AMEND-S7b-1 / DECISION-1: PULLUPS_ENABLED for the DMG write path
  // pre-flash setup (`flashgbx-write-dmg-pokemon-red.log:983`).
  PULLUPS_ENABLED: { size: 1, key: 0x0e },
  AUTO_POWEROFF_ENABLED: { size: 1, key: 0x0f },
};

const CART_MODE_DMG = 1;
const CART_MODE_AGB = 2;
const DMG_ACCESS_ROM = 1;
const DMG_ACCESS_RAM = 3;

function packU32BE(n: number): Uint8Array {
  const b = new Uint8Array(4);
  b[0] = (n >>> 24) & 0xff;
  b[1] = (n >>> 16) & 0xff;
  b[2] = (n >>> 8) & 0xff;
  b[3] = n & 0xff;
  return b;
}

export interface FlashgbxOptions {
  readonly reader?: FrameReader;
  /**
   * Per AMEND-S7b-3 + DECISION-6 — write page size. Defaults to 256 to
   * mirror FlashGBX upstream traces. The `?cart-write-chunk=64` URL flag
   * (resolved by the controller and threaded through here) downgrades to
   * 64 for HIL bisection.
   */
  readonly writeChunkBytes?: 64 | 256;
  /**
   * Per-SET_VARIABLE post-write delay in ms. Mirrors FlashGBX's macOS
   * tcdrain workaround (~1.4ms; we use 5ms by default). Tests override
   * to 0 so the AGB Flash 128 KB suite (~12K setvars) finishes in
   * seconds rather than minutes.
   */
  readonly setVarDelayMs?: number;
}

export class FlashgbxProtocol implements CartProtocol {
  readonly variant = 'lesserkuma' as const;
  private reader: FrameReader;
  private disposed = false;
  private upgraded = false;
  private currentFamily: CartFamily = 'gb';
  private readonly writeChunkBytes: number;
  private readonly setVarDelayMs: number;
  constructor(
    private readonly port: import('../types.js').Port,
    opts: FlashgbxOptions = {},
  ) {
    this.reader = opts.reader ?? new FrameReader(port);
    this.writeChunkBytes = opts.writeChunkBytes ?? WRITE_CHUNK_DEFAULT;
    this.setVarDelayMs = opts.setVarDelayMs ?? 5;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.reader.release();
  }

  /**
   * Reset the cart's firmware-side UART back to 1M baud before the host
   * closes the port. Without this the next Web Serial session opens at
   * 1M but the firmware is still at 1.5M (our upgrade), all subsequent
   * commands are misframed, and the user has to physically power-cycle
   * the cart. Best-effort: any failure here is swallowed.
   */
  async cleanup(): Promise<void> {
    if (!this.upgraded) return;
    if (typeof this.port.reopenAtBaud !== 'function') return;
    try {
      dlog('LK cleanup: TX OFW_USART_1_0M_SPEED + reopen at 1M');
      await writeAll(this.port, new Uint8Array([OP_OFW_USART_1_0M_SPEED]));
      await new Promise((resolve) => setTimeout(resolve, 50));
      this.reader.release();
      await this.port.reopenAtBaud(1_000_000);
      this.upgraded = false;
    } catch {
      /* best-effort — fall through to port.close() */
    }
  }

  /**
   * Replicates FlashGBX's PCB-5/6/101 baud upgrade. Stays a no-op if the
   * underlying transport can't reopenAtBaud (mocks). Per upstream
   * `hw_GBxCartRW.ChangeBaudRate`: send the speed opcode (no ack) → close
   * the host-side port → reopen at the new baud. Without this, PCB 5/6
   * firmware silently drops every SET_VARIABLE we send at 1M.
   */
  private async upgradeBaudIfNeeded(_opts: { signal?: AbortSignal }): Promise<void> {
    void _opts;
    if (this.upgraded) return;
    this.upgraded = true;
    if (typeof this.port.reopenAtBaud !== 'function') return; // mock / unsupported

    dlog('LK upgrade: TX OFW_USART_1_5M_SPEED + reopen at 1.5M');
    this.reader.flush();
    await writeAll(this.port, new Uint8Array([OP_OFW_USART_1_5M_SPEED]));
    // Brief settle so the firmware's UART config takes before we close.
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Release the reader BEFORE close — Web Serial errors on close while
    // a reader holds the lock.
    this.reader.release();
    await this.port.reopenAtBaud(1_500_000);
    // Fresh streams; rebuild the FrameReader.
    this.reader = new FrameReader(this.port);
    dlog('LK upgrade: now at 1.5M baud');
  }

  /** Reverse of upgradeBaudIfNeeded — TX OFW_USART_1_0M_SPEED + reopen at 1M. */
  private async downgradeBaudTo1M(): Promise<void> {
    if (typeof this.port.reopenAtBaud !== 'function') return;
    this.reader.flush();
    await writeAll(this.port, new Uint8Array([OP_OFW_USART_1_0M_SPEED]));
    await new Promise((resolve) => setTimeout(resolve, 50));
    this.reader.release();
    await this.port.reopenAtBaud(1_000_000);
    this.reader = new FrameReader(this.port);
    this.upgraded = false;
    dlog('LK downgrade: now at 1M baud');
  }

  async readFirmware(opts: { signal?: AbortSignal } = {}): Promise<FirmwareInfo> {
    // QUERY_FW_INFO is a SINGLE-BYTE command (0xA1) per FlashGBX
    // hw_GBxCartRW.LoadFirmwareVersion. Sending extra zero bytes makes the
    // firmware interpret each one as a NUL no-op and emit an ack we'd
    // never consume — earlier impl had this wrong.
    // Returns: [size:u8=8][cfw_id:u8 'L'][fw_ver:u16 BE][pcb_ver:u8][fw_ts:u32 BE]
    // followed by [name_len:u8][name:bytes] for L>=12 plus 2 trailer bytes.
    await writeAll(this.port, new Uint8Array([OP_QUERY_FW_INFO]));
    const sizeByte = await this.reader.readExactly(1, this.timeoutOpts(FW_TIMEOUT_MS, opts));
    const metaSize = sizeByte[0] ?? 0;
    if (metaSize !== 8) {
      throw new CartError('CORRUPTED_RESPONSE', `LK QUERY_FW_INFO size=${metaSize}`);
    }
    const meta = await this.reader.readExactly(8, this.timeoutOpts(FW_TIMEOUT_MS, opts));
    const cfwId = String.fromCharCode(meta[0]!);
    const fwVer = (meta[1]! << 8) | meta[2]!;
    const pcbVer = meta[3]!;
    let name = '';
    if (cfwId === 'L' && fwVer >= 12) {
      const nameLen = await this.reader.readExactly(1, this.timeoutOpts(FW_TIMEOUT_MS, opts));
      const k = nameLen[0] ?? 0;
      if (k > 0 && k <= 64) {
        const nameBytes = await this.reader.readExactly(k, this.timeoutOpts(FW_TIMEOUT_MS, opts));
        for (const b of nameBytes) if (b !== 0) name += String.fromCharCode(b);
      }
      try {
        await this.reader.readExactly(2, this.timeoutOpts(FW_TIMEOUT_MS, opts));
      } catch {
        /* tolerate older fw without trailers */
      }
    }
    const banner = `${name || 'GBxCart RW'} ${cfwId}${fwVer} (PCB ${pcbVer})`;
    return { banner, variant: 'lesserkuma', majorRev: fwVer };
  }

  async setMode(family: CartFamily, opts: { signal?: AbortSignal } = {}): Promise<void> {
    dlog(`LK setMode(${family})`);
    const isDMG = family === 'gb' || family === 'gbc';
    this.currentFamily = family;

    // Replicate FlashGBX's baud-upgrade dance before any SET_VARIABLE.
    await this.upgradeBaudIfNeeded(opts);

    // DMG_READ_METHOD / AGB_READ_METHOD aren't optional on L14 firmware:
    // their default is 0 which returns interleaved/every-other-byte data
    // (probably some Sachen / GB-Camera fast-read variant). Method 1
    // (DMG) and Method 2 (AGB) match what FlashGBX sets and what the
    // standard MBC read path expects.
    await this.setVar('DMG_READ_METHOD', 1, opts);
    await this.setVar('AGB_READ_METHOD', 2, opts);
    await this.setVar('CART_MODE', isDMG ? CART_MODE_DMG : CART_MODE_AGB, opts);

    // Voltage: 5V for original GB (Pokemon Red/Blue/Yellow); 3.3V for GBC + GBA.
    const volt = family === 'gb' ? OP_SET_VOLTAGE_5V : OP_SET_VOLTAGE_3_3V;
    await this.opAck(volt, opts);

    // Power the cart connector and let the rail settle.
    await this.opAck(OP_CART_PWR_ON, opts);
    await new Promise((resolve) => setTimeout(resolve, 100));

    if (isDMG) {
      await this.opAck(OP_DMG_MBC_RESET, opts);
    } else {
      await this.opAck(OP_AGB_BOOTUP_SEQUENCE, opts);
    }
  }

  async setBank(bank: number, opts: { signal?: AbortSignal } = {}): Promise<void> {
    // MBC RAM bank select — write the bank number to register 0x4000.
    // Most Gen 1/2 carts (MBC1/MBC3/MBC5) accept this directly. The
    // upstream driver does the same MBC-aware bus write via _cart_write.
    //
    // HIL-discovered: a small post-write settle is required before the
    // next SRAM access on Pokemon Red MBC3. Without it the FIRST page
    // of the new bank lands against the OLD bank's address space (the
    // firmware's bank-select latch hasn't propagated to the cart bus
    // yet). Symptom: 2 bytes mismatched at the start of bank N during
    // verify (the bytes our delete actually changed; the rest of the
    // page coincidentally matched because they were unchanged anyway).
    dlog(`LK setBank(${bank})`);
    await this.dmgCartWrite(0x4000, bank & 0xff, opts);
    if (this.setVarDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.setVarDelayMs * 4));
    }
  }

  async setRamEnabled(enabled: boolean, opts: { signal?: AbortSignal } = {}): Promise<void> {
    dlog(`LK setRamEnabled(${enabled})`);
    await this.dmgCartWrite(0x0000, enabled ? 0x0a : 0x00, opts);
  }

  async readRom(address: number, length: number, opts: CartReadOptions = {}): Promise<Uint8Array> {
    if (this.currentFamily === 'gba') {
      // GBA: ADDRESS is in 16-bit words (cart bus is 16-bit), and the
      // read opcode is AGB_CART_READ — NOT DMG_CART_READ. No
      // DMG_ACCESS_MODE setvar (DMG-only). Per FlashGBX `ReadROM`.
      return this.bulkReadAgb(OP_AGB_CART_READ, address >> 1, length, opts);
    }
    return this.bulkRead({ accessMode: DMG_ACCESS_ROM, baseAddr: address, length, opts });
  }

  async readSram(
    family: CartFamily,
    length: number,
    opts: CartReadOptions = {},
  ): Promise<Uint8Array> {
    if (family === 'gba') {
      // For >64 KB carts (Pokemon Ruby/Sapphire/Emerald/FRLG = 128 KB
      // Flash) we have to split the read across 2 × 64 KB Flash banks
      // with explicit bank-switch commands in between. The Flash chip's
      // address bus only exposes 64 KB at a time; reading 0xA000..0xFFFF
      // (CPU-mapped) returns whichever bank was last selected.
      // For ≤64 KB carts (real SRAM, no Flash) we read flat.
      if (length > 0x10000) {
        return this.readAgbFlashBanked(length, opts);
      }
      return this.bulkReadAgb(OP_AGB_CART_READ_SRAM, 0, length, opts);
    }
    // DMG SRAM lives at 0xA000 with DMG_ACCESS_MODE=3 + DMG_READ_CS_PULSE=1.
    return this.bulkRead({
      accessMode: DMG_ACCESS_RAM,
      baseAddr: 0xa000,
      length,
      opts,
      ramPulse: true,
    });
  }

  /**
   * Pre-write one-shot setup. Per AMEND-S7b-1 the LK firmware needs the
   * full pre-flash register prelude that FlashGBX issues before any DMG
   * SRAM page write or AGB Flash sector erase. Per AMEND-S7b-4 we also
   * issue the JEDEC chip-ID **exit** sequence on AGB so a previous
   * crashed session that left the chip in chip-ID mode doesn't corrupt
   * our writes. Idempotent — safe to call multiple times.
   */
  async prepareForWrite(family: CartFamily, opts: { signal?: AbortSignal } = {}): Promise<void> {
    if (family === 'gba') {
      // AGB pre-flash setvars per `flashgbx-write-agb-pokemon-ruby-jp.log:159-160`.
      await this.setVar('STATUS_REGISTER_MASK', 0x80, opts);
      await this.setVar('STATUS_REGISTER_VALUE', 0x80, opts);
      // Defensive JEDEC chip-ID exit per AMEND-S7b-4 — bullet-proofs us
      // against a previous tool/session leaving the chip in ID/erase mode.
      const jedec = this.makeJedec(opts);
      await jedec.exitChipIdMode();
      return;
    }
    // DMG pre-flash setvars per `flashgbx-write-dmg-pokemon-red.log:983-987`.
    await this.setVar('PULLUPS_ENABLED', 0, opts);
    await this.setVar('STATUS_REGISTER_MASK', 0x80, opts);
    await this.setVar('STATUS_REGISTER_VALUE', 0x80, opts);
    await this.setVar('DMG_WRITE_CS_PULSE', 0, opts);
    await this.setVar('DMG_READ_CS_PULSE', 0, opts);
  }

  async writeSram(
    family: CartFamily,
    bytes: Uint8Array,
    opts: CartWriteOptions = {},
  ): Promise<void> {
    if (family === 'gba') {
      // For >64 KB carts (Pokemon R/S/E/FR/LG = 128 KB Flash) we drive
      // the JEDEC sector-erase + poll + page write loop, banked across
      // the two 64 KB Flash banks. For ≤64 KB carts (true SRAM, not
      // Flash) we fall back to the flat per-page bulk SRAM writer.
      if (bytes.length > 0x10000) {
        await this.writeAgbFlashBanked(bytes, opts);
        return;
      }
      await this.bulkWriteSram(OP_AGB_CART_WRITE_SRAM, 0, bytes, opts);
      return;
    }
    // DMG SRAM write — per FlashGBX trace
    // (`flashgbx-write-dmg-pokemon-red.log:998..1500`).
    //
    // Per-page cadence (one bank's worth of bytes; the GbxCartSink does
    // setRamEnabled/setBank around this call):
    //
    //   for each page (256 bytes per AMEND-S7b-3):
    //     SET_VAR TRANSFER_SIZE = 256
    //     SET_VAR ADDRESS       = 0xA000 + offset_within_bank
    //     SET_VAR DMG_ACCESS_MODE = 4               (SRAM-write mode!)
    //     SET_VAR DMG_WRITE_CS_PULSE = 1            (raise pulse for the page)
    //     SET_VAR ADDRESS       = 0                 (reset before payload)
    //     SET_VAR DMG_WRITE_CS_PULSE = 0            (lower before payload)
    //     OP_DMG_CART_WRITE_SRAM (0xB3) + payload   → ack 0x01
    //
    // The DMG_ACCESS_MODE=4 setvar is critical — without it the firmware
    // is still in whatever mode the last reader left it (likely 3 = SRAM
    // read), and bytes write to the wrong bus state. Was the silent
    // bug-source in the previous writeSram impl per PLAN §4.4.
    // HIL-fix: previous impl did `ADDRESS=0` + `DMG_WRITE_CS_PULSE=0`
    // BEFORE the data write, deasserting CS before any bytes hit the
    // bus. Re-reading WriteRAM in LK_Device.py:1617-1636 carefully: the
    // python `_set_fw_variable("ADDRESS", 0)` + `("DMG_WRITE_CS_PULSE", 0)`
    // calls fire AFTER the iteration loop, NOT before each write. The
    // FlashGBX trace prints the cleanup setvars at lines 1241-1242 but
    // the data writes between them aren't logged at python level.
    // Symptom of the wrong order: writes ack but the cart's SRAM is
    // unchanged (CS deasserted means no bus activity reaches the cart).
    const PAGE = this.writeChunkBytes;
    for (let off = 0; off < bytes.length; off += PAGE) {
      if (opts.signal?.aborted) throw new CartError('CANCELLED', 'write aborted');
      const slice = bytes.subarray(off, Math.min(off + PAGE, bytes.length));
      await this.setVar('TRANSFER_SIZE', slice.length, opts);
      await this.setVar('ADDRESS', 0xa000 + off, opts);
      await this.setVar('DMG_ACCESS_MODE', 4, opts);
      await this.setVar('DMG_WRITE_CS_PULSE', 1, opts);
      await writeAll(this.port, new Uint8Array([OP_DMG_CART_WRITE_SRAM]));
      await writeAll(this.port, slice);
      await this.readAck(opts, 'DMG SRAM write');
      opts.onProgress?.({ bytesWritten: off + slice.length, bytesTotal: bytes.length });
    }
    // Cleanup once at the end — mirrors LK_Device.py:1634-1636.
    await this.setVar('ADDRESS', 0x0000, opts);
    await this.setVar('DMG_WRITE_CS_PULSE', 0, opts);
  }

  // --- helpers ---

  private timeoutOpts(
    ms: number,
    opts: { signal?: AbortSignal },
  ): { timeoutMs: number; signal?: AbortSignal } {
    return opts.signal ? { timeoutMs: ms, signal: opts.signal } : { timeoutMs: ms };
  }

  private async setVar(
    name: keyof typeof VARS,
    value: number,
    opts: { signal?: AbortSignal },
  ): Promise<void> {
    const v = VARS[name]!;
    const buf = new Uint8Array(2 + 4 + 4);
    buf[0] = OP_SET_VARIABLE;
    buf[1] = v.size;
    buf.set(packU32BE(v.key), 2);
    buf.set(packU32BE(value), 6);
    await writeAll(this.port, buf);
    // FlashGBX adds a ~1.4ms delay after every write on macOS — Web
    // Serial similarly doesn't guarantee tcdrain semantics. A small
    // pause lets the firmware finish processing before the next op.
    if (this.setVarDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.setVarDelayMs));
    }
    await this.readAck(opts, `SET_VAR ${name}=${value}`);
  }

  private async opAck(opcode: number, opts: { signal?: AbortSignal }): Promise<void> {
    await writeAll(this.port, new Uint8Array([opcode]));
    if (this.setVarDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.setVarDelayMs));
    }
    await this.readAck(opts, `op 0x${opcode.toString(16)}`);
  }

  private async readAck(opts: { signal?: AbortSignal }, label: string): Promise<void> {
    const ack = await this.reader.readExactly(1, this.timeoutOpts(ACK_TIMEOUT_MS, opts));
    const a = ack[0]!;
    // 0x01 = ok; 0x03 = ok-with-data-pending. Anything else is an error.
    if (a !== 0x01 && a !== 0x03) {
      throw new CartError('CORRUPTED_RESPONSE', `${label}: bad ack 0x${a.toString(16)}`);
    }
  }

  private async dmgCartWrite(
    address: number,
    value: number,
    opts: { signal?: AbortSignal },
  ): Promise<void> {
    const buf = new Uint8Array(1 + 4 + 1);
    buf[0] = OP_DMG_CART_WRITE;
    buf.set(packU32BE(address), 1);
    buf[5] = value & 0xff;
    await writeAll(this.port, buf);
    await this.readAck(
      opts,
      `DMG_CART_WRITE addr=0x${address.toString(16)} val=0x${value.toString(16)}`,
    );
  }

  private async bulkRead(args: {
    accessMode: number;
    baseAddr: number;
    length: number;
    opts: CartReadOptions;
    ramPulse?: boolean;
  }): Promise<Uint8Array> {
    if (args.length <= 0) return new Uint8Array(0);
    dlog(
      `LK bulkRead start mode=${args.accessMode} addr=0x${args.baseAddr.toString(16)} len=${args.length}`,
    );
    const out = new Uint8Array(args.length);
    let off = 0;
    await this.setVar('TRANSFER_SIZE', TRANSFER_CHUNK, args.opts);
    await this.setVar('ADDRESS', args.baseAddr, args.opts);
    await this.setVar('DMG_ACCESS_MODE', args.accessMode, args.opts);
    if (args.ramPulse) await this.setVar('DMG_READ_CS_PULSE', 1, args.opts);
    try {
      while (off < args.length) {
        if (args.opts.signal?.aborted) throw new CartError('CANCELLED', 'read aborted');
        const want = Math.min(TRANSFER_CHUNK, args.length - off);
        if (want < TRANSFER_CHUNK) {
          // Final tail — re-set TRANSFER_SIZE to the smaller value so the
          // firmware doesn't over-send.
          await this.setVar('TRANSFER_SIZE', want, args.opts);
        }
        await writeAll(this.port, new Uint8Array([OP_DMG_CART_READ]));
        const chunk = await this.reader.readExactly(
          want,
          this.timeoutOpts(BLOCK_TIMEOUT_MS, args.opts),
        );
        out.set(chunk, off);
        off += want;
        args.opts.onProgress?.({ bytesRead: off, bytesTotal: args.length });
      }
    } finally {
      if (args.ramPulse) await this.setVar('DMG_READ_CS_PULSE', 0, args.opts);
    }
    return out;
  }

  /**
   * AGB bulk read — shared between ROM (OP_AGB_CART_READ) and SRAM
   * (OP_AGB_CART_READ_SRAM). Unlike DMG, there's no DMG_ACCESS_MODE
   * setvar; the opcode itself determines the bus routing. ADDRESS for
   * ROM is in 16-bit words (caller pre-shifts); for SRAM it's the raw
   * byte offset into SRAM — both fit the same code path.
   *
   * Uses TRANSFER_CHUNK=64 to match FlashGBX exactly. Bigger chunks
   * confuse Chrome's Web Serial stream delivery (we observed duplicated
   * bytes between chunks at TRANSFER_SIZE=1024).
   */
  private async bulkReadAgb(
    opcode: number,
    baseAddr: number,
    length: number,
    opts: CartReadOptions,
  ): Promise<Uint8Array> {
    if (length <= 0) return new Uint8Array(0);
    dlog(
      `LK bulkReadAgb op=0x${opcode.toString(16)} base=0x${baseAddr.toString(16)} len=${length}`,
    );
    const out = new Uint8Array(length);
    let off = 0;
    await this.setVar('TRANSFER_SIZE', TRANSFER_CHUNK, opts);
    await this.setVar('ADDRESS', baseAddr, opts);
    while (off < length) {
      if (opts.signal?.aborted) throw new CartError('CANCELLED', 'read aborted');
      const want = Math.min(TRANSFER_CHUNK, length - off);
      if (want < TRANSFER_CHUNK) {
        await this.setVar('TRANSFER_SIZE', want, opts);
      }
      await writeAll(this.port, new Uint8Array([opcode]));
      const chunk = await this.reader.readExactly(want, this.timeoutOpts(BLOCK_TIMEOUT_MS, opts));
      out.set(chunk, off);
      off += want;
      opts.onProgress?.({ bytesRead: off, bytesTotal: length });
    }
    return out;
  }

  private async bulkWriteSram(
    opcode: number,
    baseAddr: number,
    bytes: Uint8Array,
    opts: CartWriteOptions,
  ): Promise<void> {
    const PAGE = this.writeChunkBytes;
    for (let off = 0; off < bytes.length; off += PAGE) {
      if (opts.signal?.aborted) throw new CartError('CANCELLED', 'write aborted');
      const slice = bytes.subarray(off, Math.min(off + PAGE, bytes.length));
      await this.setVar('TRANSFER_SIZE', slice.length, opts);
      await this.setVar('ADDRESS', baseAddr + off, opts);
      await writeAll(this.port, new Uint8Array([opcode]));
      await writeAll(this.port, slice);
      await this.readAck(opts, `LK SRAM write @ 0x${(baseAddr + off).toString(16)}`);
      opts.onProgress?.({ bytesWritten: off + slice.length, bytesTotal: bytes.length });
    }
  }

  // --- AGB Flash chip support ---
  // Pokemon Ruby/Sapphire/Emerald/FireRed/LeafGreen all use 128 KB Flash
  // exposed via a 64 KB-window bank-switched interface. Flash chips on
  // these carts (Macronix MX29L010 / Sanyo LE26FV10N1TS / SST39VF512 /
  // Atmel AT29LV512) all respond to the JEDEC-standard cmd sequence.
  //
  // To read 128 KB:
  //   1. Switch to bank 0 (4-byte cmd: AA/55/B0/00 to addrs 5555/2AAA/5555/0000)
  //   2. Read 64 KB via AGB_CART_READ_SRAM at offsets 0..0xFFFF
  //   3. Switch to bank 1 (4-byte cmd, last byte = 01)
  //   4. Read another 64 KB
  // Each "cart write" goes through the LK SRAM-write path:
  //   set TRANSFER_SIZE=1, set ADDRESS=<flash addr>, send AGB_CART_WRITE_SRAM
  //   opcode + 1 byte value, expect ack.

  private async cartWriteAgbByte(
    address: number,
    value: number,
    opts: { signal?: AbortSignal },
  ): Promise<void> {
    await this.setVar('TRANSFER_SIZE', 1, opts);
    await this.setVar('ADDRESS', address, opts);
    await writeAll(this.port, new Uint8Array([OP_AGB_CART_WRITE_SRAM]));
    await writeAll(this.port, new Uint8Array([value & 0xff]));
    await this.readAck(opts, `cart_write 0x${address.toString(16)}=0x${value.toString(16)}`);
  }

  private async switchAgbFlashBank(bank: number, opts: { signal?: AbortSignal }): Promise<void> {
    dlog(`LK switch AGB flash bank → ${bank}`);
    // JEDEC bank-select sequence for GBA Flash chips: AA/55/B0 followed
    // by the bank index at addr 0x0.
    await this.cartWriteAgbByte(0x5555, 0xaa, opts);
    await this.cartWriteAgbByte(0x2aaa, 0x55, opts);
    await this.cartWriteAgbByte(0x5555, 0xb0, opts);
    await this.cartWriteAgbByte(0x0000, bank & 0xff, opts);
  }

  /**
   * Per-sector AGB Flash write loop. Per
   * `flashgbx-write-agb-pokemon-ruby-jp.log:158..1305` and AMEND-S7b-3/4/5/11.
   *
   * For each of the (up to 32) sectors:
   *   1. (Bank-switch on bank-boundary crossings.)
   *   2. JEDEC sector erase (6-step cmd).
   *   3. Poll until sector reads 0xFFFF (MAX_POLL=120 × 5ms).
   *   4. Write the 4 KB sector body in `writeChunkBytes`-sized pages
   *      (default 256 per AMEND-S7b-3).
   *
   * On any failure surfaces a structured `CartError('WRITE_FAILED', ...)`
   * carrying `{sectorIndex, sectorAddress, withinSectorOffset, phase}`
   * per AMEND-S7b-11.
   */
  private async writeAgbFlashBanked(bytes: Uint8Array, opts: CartWriteOptions): Promise<void> {
    const plan = agbFlashSectorPlan(bytes.length);
    if (plan.length === 0) return;

    const jedec = this.makeJedec(opts);
    let currentBank = -1;

    for (const sector of plan) {
      if (opts.signal?.aborted) {
        throw new CartError(
          'CANCELLED',
          'AGB Flash write aborted',
          flashErrorMeta({
            sectorIndex: sector.sectorIndex,
            sectorAddress: sector.addressInBank,
            withinSectorOffset: 0,
            phase: 'erase',
          }),
        );
      }
      if (sector.bank !== currentBank) {
        await this.switchAgbFlashBank(sector.bank, opts);
        currentBank = sector.bank;
      }
      await jedec.eraseSector(sector);
      await jedec.pollErased(sector);
      await this.writeAgbFlashSector(sector, bytes, opts);
      opts.onProgress?.({
        bytesWritten: sector.absoluteOffset + AGB_FLASH_SECTOR_BYTES,
        bytesTotal: bytes.length,
      });
    }
  }

  /**
   * Write one 4 KB sector's body. `bytes[sector.absoluteOffset .. +4096]`
   * is the source; we slice into `writeChunkBytes`-sized pages (default
   * 256 per AMEND-S7b-3 / DECISION-6) and ship each via
   * AGB_CART_WRITE_SRAM with the `(TRANSFER_SIZE + ADDRESS)` prelude.
   * Address is the within-bank Flash byte address (NOT word-shifted —
   * SRAM-path writes use byte addresses, unlike AGB ROM reads).
   */
  private async writeAgbFlashSector(
    sector: AgbFlashSector,
    bytes: Uint8Array,
    opts: CartWriteOptions,
  ): Promise<void> {
    const page = this.writeChunkBytes;
    // HIL-fix: match FlashGBX WriteRAM exactly (LK_Device.py:1614-1638).
    // Setvars happen ONCE before the per-page loop; firmware auto-
    // increments ADDRESS between writes. AND we MUST readAck after each
    // page payload — the DMG path does this, the AGB path was missing
    // it. Without ack consumption the firmware's ack byte (0x01) lingers
    // in the read buffer and the NEXT setvar's response gets read as
    // an off-by-one stale byte. Symptom on real hardware: erase happens
    // (cart goes to all 0xFF) but page writes silently no-op against
    // the Flash chip — cart stays blank after the entire flash op.
    await this.setVar('TRANSFER_SIZE', page, opts);
    await this.setVar('ADDRESS', sector.addressInBank, opts);
    for (let i = 0; i < AGB_FLASH_SECTOR_BYTES; i += page) {
      if (opts.signal?.aborted) {
        throw new CartError(
          'CANCELLED',
          'AGB Flash write aborted',
          flashErrorMeta({
            sectorIndex: sector.sectorIndex,
            sectorAddress: sector.addressInBank,
            withinSectorOffset: i,
            phase: 'write',
          }),
        );
      }
      const slice = bytes.subarray(sector.absoluteOffset + i, sector.absoluteOffset + i + page);
      try {
        await writeAll(
          this.port,
          new Uint8Array([OP_AGB_CART_WRITE_FLASH_DATA, AGB_FLASH_WRITE_METHOD_DEFAULT]),
        );
        await writeAll(this.port, slice);
        await this.readAck(opts, `AGB Flash page write s${sector.sectorIndex}+0x${i.toString(16)}`);
      } catch (e) {
        throw new CartError(
          'WRITE_FAILED',
          `AGB Flash page write @ sector ${sector.sectorIndex} +${i}: ${(e as Error).message}`,
          flashErrorMeta({
            sectorIndex: sector.sectorIndex,
            sectorAddress: sector.addressInBank,
            withinSectorOffset: i,
            phase: 'write',
          }),
        );
      }
    }
  }

  /**
   * Construct a JedecFlash helper bound to this protocol's cart-write +
   * 2-byte-read primitives. Per AMEND-S7b-5 the poll uses the existing
   * `bulkReadAgb` machinery (TRANSFER_SIZE=2 + ADDRESS + AGB_CART_READ_SRAM)
   * — DO NOT introduce a one-off 2-byte reader.
   */
  private makeJedec(opts: { signal?: AbortSignal }): JedecFlash {
    return new JedecFlash(
      (address, value) => this.cartWriteAgbByte(address, value, opts),
      async (address) => {
        const buf = await this.bulkReadAgb(OP_AGB_CART_READ_SRAM, address, 2, opts);
        // Per AMEND-S7b-5: treat as u16 BE check == 0xFFFF — equivalent
        // to (byte0 << 8) | byte1 when both are 0xFF, but the wider
        // formulation guards against accidental "byte0 == 0xFF" early-exit.
        return ((buf[0] ?? 0) << 8) | (buf[1] ?? 0);
      },
    );
  }

  private async readAgbFlashBanked(length: number, opts: CartReadOptions): Promise<Uint8Array> {
    const BANK_SIZE = 0x10000; // 64 KB per bank
    if (length > 2 * BANK_SIZE) {
      throw new CartError('UNSUPPORTED_CART', `AGB Flash > 128 KB not supported (got ${length})`);
    }
    const out = new Uint8Array(length);
    let off = 0;
    for (let bank = 0; off < length; bank++) {
      const remaining = length - off;
      const want = Math.min(BANK_SIZE, remaining);
      const signalOpts = opts.signal ? { signal: opts.signal } : {};
      await this.switchAgbFlashBank(bank, signalOpts);
      const chunk = await this.bulkReadAgb(OP_AGB_CART_READ_SRAM, 0, want, {
        ...opts,
        onProgress: (p) => {
          opts.onProgress?.({ bytesRead: off + p.bytesRead, bytesTotal: length });
        },
      });
      out.set(chunk, off);
      off += chunk.length;
    }
    return out;
  }
}
