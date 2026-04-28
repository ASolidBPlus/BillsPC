/**
 * AGB (Game Boy Advance) Flash chip helper — JEDEC sector erase + poll +
 * sector write. Shared between `FlashgbxProtocol` (LK CFW) and
 * `InsidegadgetsProtocol` (stock OFW) so the two firmwares produce
 * byte-identical wire traces for the same logical Flash op.
 *
 * Source of truth: `docs/flashgbx-reference/flashgbx-write-agb-pokemon-ruby-jp.log`
 * (Pokemon Ruby JP, Macronix MX29L010, 32 sectors × 4 KB = 128 KB).
 *
 * Per AMEND-S7b-3 + DECISION-6 the per-sector page write uses
 * TRANSFER_SIZE=256 (matching FlashGBX upstream traces). The host sends
 * 16 × 256-byte pages per 4 KB sector. A `?cart-write-chunk=64` URL flag
 * (handled by the controller, plumbed via the writer's `chunkBytes` opt)
 * forces the fallback 64-byte path for HIL bisection.
 *
 * Per AMEND-S7b-4 we issue the JEDEC chip-ID **exit** sequence
 * defensively before the per-bank loop (in case a previous tool / our
 * own crashed session left the chip in chip-ID mode), but skip the
 * chip-ID READ (we trust the cart-header's RAM-size byte).
 *
 * Per AMEND-S7b-5 the erase poll is a 2-byte u16 read at the sector base
 * compared against 0xFFFF, with MAX_POLL=120 attempts × 5ms inter-poll
 * delay → 600ms ceiling (Macronix worst-case 200ms × 3× safety margin).
 *
 * Per AMEND-S7b-11 the per-sector errors carry structured metadata
 * (sectorIndex / sectorAddress / withinSectorOffset / phase) so the
 * S7c+ recovery dialog can be more granular.
 */

import { CartError } from '../types.js';

/** Each Flash sector is 4 KB (0x1000 bytes). */
export const AGB_FLASH_SECTOR_BYTES = 0x1000 as const;
/** Each Flash bank is 64 KB (16 sectors × 4 KB). */
export const AGB_FLASH_BANK_BYTES = 0x10000 as const;
/** All Pokemon R/S/E/FR/LG carts ship 128 KB Flash = 2 banks. */
export const AGB_FLASH_BANK_COUNT = 2 as const;
export const AGB_FLASH_TOTAL_BYTES = AGB_FLASH_BANK_BYTES * AGB_FLASH_BANK_COUNT;

/** Per AMEND-S7b-5 — Macronix max sector erase 200ms; 120 polls × 5ms = 600ms. */
export const FLASH_ERASE_POLL_MAX = 120 as const;
export const FLASH_ERASE_POLL_DELAY_MS = 5 as const;

export type FlashWritePhase = 'exit' | 'erase' | 'erase_poll' | 'write' | 'ack';

/** Structured metadata on AGB Flash WRITE_FAILED errors per AMEND-S7b-11. */
export interface FlashErrorMeta {
  readonly sectorIndex: number;
  readonly sectorAddress: number;
  readonly withinSectorOffset: number;
  readonly phase: FlashWritePhase;
}

export function flashErrorMeta(meta: FlashErrorMeta): Record<string, string | number> {
  return {
    sectorIndex: meta.sectorIndex,
    sectorAddress: meta.sectorAddress,
    withinSectorOffset: meta.withinSectorOffset,
    phase: meta.phase,
  };
}

/** Pre-computed per-sector descriptor: bank, within-bank address. */
export interface AgbFlashSector {
  /** 0..31 globally — index within the 128 KB Flash. */
  readonly sectorIndex: number;
  /** 0 or 1 — Flash bank (the 64 KB window the chip currently exposes). */
  readonly bank: 0 | 1;
  /** Address within the bank (0x0000..0xF000) — what `cart_write_flash` uses. */
  readonly addressInBank: number;
  /** Absolute byte offset within the source bytes buffer (0..127 KB). */
  readonly absoluteOffset: number;
}

/**
 * Enumerate the per-sector plan for a given total length. For 128 KB this
 * returns 32 sectors across 2 banks (16 each, within-bank addresses
 * identical). Caller iterates and tracks bank-switch breakpoints.
 */
export function agbFlashSectorPlan(totalBytes: number): readonly AgbFlashSector[] {
  if (totalBytes <= 0 || totalBytes % AGB_FLASH_SECTOR_BYTES !== 0) {
    throw new CartError(
      'WRITE_FAILED',
      `agbFlashSectorPlan: totalBytes (${totalBytes}) must be a positive multiple of ${AGB_FLASH_SECTOR_BYTES}`,
    );
  }
  if (totalBytes > AGB_FLASH_TOTAL_BYTES) {
    throw new CartError(
      'UNSUPPORTED_CART',
      `agbFlashSectorPlan: ${totalBytes} bytes exceeds 128 KB Flash limit`,
    );
  }
  const out: AgbFlashSector[] = [];
  const sectorCount = totalBytes / AGB_FLASH_SECTOR_BYTES;
  for (let i = 0; i < sectorCount; i++) {
    const bank = (Math.floor(i / 16) === 0 ? 0 : 1) as 0 | 1;
    const addressInBank = (i % 16) * AGB_FLASH_SECTOR_BYTES;
    out.push({
      sectorIndex: i,
      bank,
      addressInBank,
      absoluteOffset: i * AGB_FLASH_SECTOR_BYTES,
    });
  }
  return out;
}

/**
 * The per-byte `cart_write_flash` primitive — caller-supplied so this
 * helper stays protocol-agnostic. Both `FlashgbxProtocol.cartWriteAgbByte`
 * and a future Insidegadgets equivalent satisfy this shape.
 */
export type CartWriteFlashByte = (address: number, value: number) => Promise<void>;

/**
 * Read a u16 BE at the given Flash address. Used for the sector-erase
 * poll. Caller wires this to `bulkReadAgb(OP_AGB_CART_READ_SRAM, addr,
 * 2)` (FlashGBX) or the OFW equivalent — same machinery as the rest of
 * the read path; do NOT introduce a one-off 2-byte reader.
 */
export type ReadFlashU16 = (address: number) => Promise<number>;

/**
 * Yields control for `ms` milliseconds. Test override point so tests can
 * advance fake timers instead of waiting wall-clock.
 */
export type Sleep = (ms: number) => Promise<void>;

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * JEDEC sector helper. Stateless; the protocol layer constructs one per
 * write call passing the cart-write primitive.
 */
export class JedecFlash {
  constructor(
    private readonly cartWrite: CartWriteFlashByte,
    private readonly readU16: ReadFlashU16,
    private readonly sleep: Sleep = defaultSleep,
  ) {}

  /**
   * Per AMEND-S7b-4: defensive chip-ID EXIT sequence. Cheap (~50ms) and
   * bullet-proofs us against a previous session leaving the chip in
   * chip-ID / erase mode. Skips the chip-ID READ — we trust the cart-
   * header's RAM-size byte for capacity.
   *
   * Per `flashgbx-write-agb-pokemon-ruby-jp.log` lines 165-188:
   *   pre-init: cart_write 0x4 = 0xFF, then 0x4 = 0x0
   *   exit:     cart_write 0x5555 = 0xAA, 0x2AAA = 0x55, 0x5555 = 0xF0
   *   trail:    cart_write 0x0    = 0xF0
   */
  async exitChipIdMode(): Promise<void> {
    try {
      await this.cartWrite(0x0004, 0xff);
      await this.cartWrite(0x0004, 0x00);
      await this.cartWrite(0x5555, 0xaa);
      await this.cartWrite(0x2aaa, 0x55);
      await this.cartWrite(0x5555, 0xf0);
      await this.cartWrite(0x0000, 0xf0);
    } catch (e) {
      throw new CartError(
        'WRITE_FAILED',
        `JEDEC exit-chip-id failed: ${(e as Error).message}`,
        flashErrorMeta({ sectorIndex: -1, sectorAddress: 0, withinSectorOffset: 0, phase: 'exit' }),
      );
    }
  }

  /**
   * Issue the 6-step JEDEC sector-erase command for a single sector. Per
   * `flashgbx-write-agb-pokemon-ruby-jp.log` lines 196..201 (sector 0 example):
   *   cart_write_flash 0x5555 = 0xAA
   *   cart_write_flash 0x2AAA = 0x55
   *   cart_write_flash 0x5555 = 0x80
   *   cart_write_flash 0x5555 = 0xAA
   *   cart_write_flash 0x2AAA = 0x55
   *   cart_write_flash <sector_addr> = 0x30
   */
  async eraseSector(sector: AgbFlashSector): Promise<void> {
    try {
      await this.cartWrite(0x5555, 0xaa);
      await this.cartWrite(0x2aaa, 0x55);
      await this.cartWrite(0x5555, 0x80);
      await this.cartWrite(0x5555, 0xaa);
      await this.cartWrite(0x2aaa, 0x55);
      await this.cartWrite(sector.addressInBank, 0x30);
    } catch (e) {
      throw new CartError('WRITE_FAILED', `JEDEC erase failed: ${(e as Error).message}`, {
        ...flashErrorMeta({
          sectorIndex: sector.sectorIndex,
          sectorAddress: sector.addressInBank,
          withinSectorOffset: 0,
          phase: 'erase',
        }),
      });
    }
  }

  /**
   * Poll the sector start until it reads 0xFFFF (erase complete). Per
   * AMEND-S7b-5: 2-byte u16 read, MAX_POLL=120, 5ms inter-poll delay.
   * Test traces show the typical Macronix erase finishes in ~6 polls
   * (~30ms); 120 × 5ms = 600ms ceiling for worst-case 200ms erase + 3×
   * safety margin.
   */
  async pollErased(sector: AgbFlashSector): Promise<void> {
    for (let attempt = 0; attempt < FLASH_ERASE_POLL_MAX; attempt++) {
      const value = await this.readU16(sector.addressInBank);
      if ((value & 0xffff) === 0xffff) return;
      if (attempt < FLASH_ERASE_POLL_MAX - 1) {
        await this.sleep(FLASH_ERASE_POLL_DELAY_MS);
      }
    }
    throw new CartError(
      'WRITE_FAILED',
      `flash erase timeout @ sector ${sector.sectorIndex} (addr 0x${sector.addressInBank.toString(16)})`,
      flashErrorMeta({
        sectorIndex: sector.sectorIndex,
        sectorAddress: sector.addressInBank,
        withinSectorOffset: 0,
        phase: 'erase_poll',
      }),
    );
  }
}

/**
 * Diff two byte arrays. Used by `WriteAndVerifySink` and exposed here so
 * tests can share the reference impl. Returns the offsets that differ
 * (capped at `limit` to avoid huge allocations on a totally-mismatched
 * read).
 */
export interface DiffEntry {
  readonly offset: number;
  readonly expected: number;
  readonly actual: number;
}

export function diffBytes(
  expected: Uint8Array,
  actual: Uint8Array,
  limit = 1024,
): { mismatches: DiffEntry[]; mismatchCount: number } {
  if (expected.length !== actual.length) {
    return {
      mismatches: [{ offset: -1, expected: expected.length, actual: actual.length }],
      mismatchCount: Math.max(expected.length, actual.length),
    };
  }
  const mismatches: DiffEntry[] = [];
  let count = 0;
  for (let i = 0; i < expected.length; i++) {
    if (expected[i] !== actual[i]) {
      count++;
      if (mismatches.length < limit) {
        mismatches.push({ offset: i, expected: expected[i] ?? 0, actual: actual[i] ?? 0 });
      }
    }
  }
  return { mismatches, mismatchCount: count };
}
