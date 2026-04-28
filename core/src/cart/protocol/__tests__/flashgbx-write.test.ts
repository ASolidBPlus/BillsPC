/**
 * S7b — FlashgbxProtocol write-side tests. Covers DMG SRAM write,
 * AGB Flash bank-switch + JEDEC erase + sector write loop, and the
 * AMEND-S7b-1/-3/-4 register prelude.
 */

import { describe, it, expect } from 'vitest';
import { FlashgbxProtocol } from '../flashgbx.js';
import { makeMockPort, bytes } from './mockPort.js';
import { CartError } from '../../types.js';
import {
  AGB_FLASH_BANK_BYTES,
  AGB_FLASH_TOTAL_BYTES,
  AGB_FLASH_SECTOR_BYTES,
} from '../agbFlash.js';

function ack(port: ReturnType<typeof makeMockPort>, n = 1): void {
  for (let i = 0; i < n; i++) port.enqueueRx(bytes(0x01));
}

/** Number of TX bytes consumed by a single SET_VARIABLE call. */
const SET_VAR_FRAME = 1 /* opcode */ + 1 /* size */ + 4 /* key */ + 4; /* value */

describe('FlashgbxProtocol — DMG SRAM writeSram (per LK_Device.py:3286-3458 + :1611-1638)', () => {
  it('writes one bank in 512-byte batches (4 prelude + 2 page writes + 2 cleanup per batch)', async () => {
    const port = makeMockPort();
    // 8 KB bank / 512-byte batch = 16 batches; per batch: 4 prelude
    // setvar acks + 2 page-write acks + 2 cleanup setvar acks = 8 acks.
    // 16 × 8 = 128 acks total.
    ack(port, 16 * 8);
    const proto = new FlashgbxProtocol(port, { setVarDelayMs: 0 });
    const data = new Uint8Array(8192).fill(0x42);
    await proto.writeSram('gb', data);
    // OP_DMG_CART_WRITE_SRAM opcode (0xB3) appears once per page = 32 times.
    const opcodeCount = port.txLog.filter((b) => b === 0xb3).length;
    expect(opcodeCount).toBe(32);
  });

  it('issues the prelude per batch (TRANSFER_SIZE→ADDRESS=0xA000→ACCESS_MODE=4→CS_PULSE=1)', async () => {
    const port = makeMockPort();
    // Single 256-byte payload = 1 batch with 1 page: 4 prelude + 1 page + 2 cleanup.
    ack(port, 4 + 1 + 2);
    const proto = new FlashgbxProtocol(port, { setVarDelayMs: 0 });
    await proto.writeSram('gb', new Uint8Array(256).fill(0xa5));
    const tx = port.txLog;
    // First setvar: TRANSFER_SIZE (size=2, key=0x0000, value=0x0100).
    expect(tx.slice(0, SET_VAR_FRAME)).toEqual([
      0xa6, 2, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00,
    ]);
    // Second setvar: ADDRESS (size=4, key=0x0000, value=0xA000).
    expect(tx.slice(SET_VAR_FRAME, SET_VAR_FRAME * 2)).toEqual([
      0xa6, 4, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xa0, 0x00,
    ]);
    // Third setvar: DMG_ACCESS_MODE (size=1, key=0x0001, value=4).
    expect(tx.slice(SET_VAR_FRAME * 2, SET_VAR_FRAME * 3)).toEqual([
      0xa6, 1, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x04,
    ]);
    // Fourth setvar: DMG_WRITE_CS_PULSE = 1 (size=1, key=0x0009).
    expect(tx.slice(SET_VAR_FRAME * 3, SET_VAR_FRAME * 4)).toEqual([
      0xa6, 1, 0x00, 0x00, 0x00, 0x09, 0x00, 0x00, 0x00, 0x01,
    ]);
    // Then OP_DMG_CART_WRITE_SRAM (0xB3) + 256-byte payload.
    expect(tx[SET_VAR_FRAME * 4]).toBe(0xb3);
  });

  it('writes per writeChunkBytes=64 fallback when configured', async () => {
    const port = makeMockPort();
    // 256 bytes / 64-byte page = 4 pages. 256 ≤ BATCH_BYTES (512) → 1 batch.
    // Per batch: 4 prelude + 4 page-writes + 2 cleanup = 10 acks.
    ack(port, 4 + 4 + 2);
    const proto = new FlashgbxProtocol(port, { writeChunkBytes: 64, setVarDelayMs: 0 });
    await proto.writeSram('gb', new Uint8Array(256));
    expect(port.txLog.filter((b) => b === 0xb3).length).toBe(4);
  });

  it('aborts mid-write on signal', async () => {
    const port = makeMockPort();
    // Abort fires before the first page write: 4 prelude acks consumed
    // before the in-loop signal check; finally still runs the 2 cleanup setvars.
    ack(port, 4 + 2);
    const ctrl = new AbortController();
    ctrl.abort();
    const proto = new FlashgbxProtocol(port, { setVarDelayMs: 0 });
    await expect(
      proto.writeSram('gb', new Uint8Array(256), { signal: ctrl.signal }),
    ).rejects.toThrow(CartError);
  });
});

describe('FlashgbxProtocol — prepareForWrite (AMEND-S7b-1, -4)', () => {
  it('DMG: 5-setvar prelude + full HasRTC dance with CLK_TOGGLE + reads', async () => {
    const port = makeMockPort();
    // Acks needed (in order the mock returns them):
    //   5 setvar prelude acks
    // + 2 cart_write acks (0x0000=0x00, 0x0000=0x0A initial)
    // + 1 CLK_TOGGLE ack
    // + 3 cart_write acks (0x0000=0x0A, 0x6000=0x00, 0x6000=0x01)
    // + 5 × (CLK_TOGGLE ack + cart_write ack + bulkRead acks/data)
    //     where each bulkRead(256) issues:
    //     4 setvar acks (TRANSFER_SIZE=64, ADDRESS, DMG_ACCESS_MODE, DMG_READ_CS_PULSE=1)
    //     + 4 OP_DMG_CART_READ (no ack — returns 64 bytes each, 256 total)
    //     + 1 setvar ack (DMG_READ_CS_PULSE=0)
    // + 2 cart_write acks (0x0000=0x00, 0x4000=0x00)
    ack(port, 5 + 2 + 1 + 3); // through LatchRTC
    // RTC register iteration × 5
    for (let i = 0; i < 5; i++) {
      ack(port, 1 + 1 + 4); // CLK_TOGGLE + cart_write + 4 setvar acks
      // 4 × 64-byte read responses
      for (let j = 0; j < 4; j++) port.enqueueRx(new Uint8Array(64));
      ack(port, 1); // DMG_READ_CS_PULSE=0
    }
    ack(port, 2); // tail cart_writes
    const proto = new FlashgbxProtocol(port, { setVarDelayMs: 0 });
    await proto.prepareForWrite('gb');
    // Sanity: PULLUPS_ENABLED first.
    expect(port.txLog.slice(0, SET_VAR_FRAME)).toEqual([
      0xa6, 1, 0x00, 0x00, 0x00, 0x0e, 0x00, 0x00, 0x00, 0x00,
    ]);
    // CLK_TOGGLE opcode (0xA9) appears 6 times: 1 initial + 5 per RTC reg iteration.
    expect(port.txLog.filter((b) => b === 0xa9).length).toBe(6);
    // The 5 RTC register selects (0x4000 = 0x08..0x0C) all appear.
    for (let reg = 0x08; reg <= 0x0c; reg++) {
      const frame = [0xb2, 0x00, 0x00, 0x40, 0x00, reg];
      let found = false;
      for (let i = 0; i + 6 <= port.txLog.length; i++) {
        if (frame.every((v, k) => port.txLog[i + k] === v)) {
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
    }
  });

  it('AGB: STATUS_REGISTER_MASK/VALUE + JEDEC chip-ID exit (AMEND-S7b-4)', async () => {
    const port = makeMockPort();
    // 2 setVar acks + 6 cartWriteAgbByte calls.
    // Each cartWriteAgbByte: 2 setvars (TRANSFER_SIZE, ADDRESS) + 1 byte + 1 ack.
    // Total acks: 2 + 6 × 3 = 20.
    ack(port, 2 + 6 * 3);
    const proto = new FlashgbxProtocol(port, { setVarDelayMs: 0 });
    await proto.prepareForWrite('gba');
    // After STATUS_REGISTER_MASK + STATUS_REGISTER_VALUE setvars, the
    // JEDEC exit calls 6 cart_write_flash bytes:
    //   0x4=0xFF, 0x4=0x0, 0x5555=0xAA, 0x2AAA=0x55, 0x5555=0xF0, 0x0=0xF0
    const cartWriteOpcodes = port.txLog.filter((b) => b === 0xc4 /* AGB_CART_WRITE_SRAM */).length;
    expect(cartWriteOpcodes).toBe(6);
  });
});

describe('FlashgbxProtocol — AGB Flash 128 KB writeSram (per AMEND-S7b-3, -4, -5, -11)', () => {
  function setupAgbWriteMock(port: ReturnType<typeof makeMockPort>): void {
    // Per cartWriteAgbByte (used by JEDEC + bank-switch helpers):
    //   2 setVar acks (TRANSFER_SIZE, ADDRESS) + 1 page-write ack = 3 acks.
    //
    // Per bank switch (4 cart_writes): 4 × 3 = 12 acks.
    // Per sector erase (6 cart_writes): 6 × 3 = 18 acks.
    // Per pollErased(): bulkReadAgb(2 bytes) issues 3 setVars
    //   (TRANSFER_SIZE=64, ADDRESS, TRANSFER_SIZE=2 because 2<64) + 2-byte read.
    // Per writeAgbFlashSector (HIL-fix): setvars happen ONCE before the
    //   16-page loop = 2 setvar acks + 16 page-write acks = 18 acks.
    //
    // Per sector total: 18 (erase) + 3 (poll setvars) + 2-byte poll + 18 (write).
    // Bank switches interleave: bank 0 before sector 0; bank 1 before sector 16.
    const sectors = 32;
    for (let s = 0; s < sectors; s++) {
      if (s === 0 || s === 16) {
        for (let i = 0; i < 12; i++) port.enqueueRx(bytes(0x01));
      }
      for (let i = 0; i < 18; i++) port.enqueueRx(bytes(0x01));
      port.enqueueRx(bytes(0x01));
      port.enqueueRx(bytes(0x01));
      port.enqueueRx(bytes(0x01));
      port.enqueueRx(bytes(0xff, 0xff));
      for (let i = 0; i < 18; i++) port.enqueueRx(bytes(0x01));
    }
  }

  it('writes 128 KB across 32 sectors with 2 bank switches', { timeout: 60_000 }, async () => {
    const port = makeMockPort();
    setupAgbWriteMock(port);
    const proto = new FlashgbxProtocol(port, { setVarDelayMs: 0 });
    const data = new Uint8Array(AGB_FLASH_TOTAL_BYTES).fill(0xab);
    let lastProgress = 0;
    await proto.writeSram('gba', data, {
      onProgress: (p) => {
        lastProgress = p.bytesWritten;
      },
    });
    expect(lastProgress).toBe(AGB_FLASH_TOTAL_BYTES);
    // Spot-check: setVar opcode (0xA6) appears for every JEDEC byte-
    // write (2 setvars each: TRANSFER_SIZE + ADDRESS) plus the per-
    // sector poll (3) and per-sector write setup (2 setvars at sector
    // start, then 16 page writes share that setup per HIL-fix).
    // Per sector: 6 erase × 2 + 3 poll + 2 write = 17 setvars.
    // Plus 4 × 2 = 8 per bank-switch (s=0,16). Total: 32×17 + 2×8 = 560.
    expect(port.txLog.filter((b) => b === 0xa6).length).toBeGreaterThan(500);
  });

  it('uses ≤64 KB AGB SRAM flat-write (no JEDEC) when length is small', async () => {
    const port = makeMockPort();
    // Single 256-byte chunk: 2 setVar acks + 1 page ack.
    const total = 256;
    ack(port, 3);
    const proto = new FlashgbxProtocol(port, { setVarDelayMs: 0 });
    await proto.writeSram('gba', new Uint8Array(total));
    // Should use OP_AGB_CART_WRITE_SRAM exactly once (no JEDEC sequence).
    expect(port.txLog.filter((b) => b === 0xc4).length).toBe(1);
  });

  it('surfaces erase-poll timeout with structured WRITE_FAILED metadata', async () => {
    const port = makeMockPort();
    // Bank switch 0 (4 cart_writes × 3 acks = 12 acks).
    ack(port, 12);
    // Erase sector 0 (18 acks).
    ack(port, 18);
    // 120 polls — each: 3 setvars + 2-byte data. Always return 0xC4 0xC4.
    for (let p = 0; p < 120; p++) {
      ack(port, 3);
      port.enqueueRx(bytes(0xc4, 0xc4));
    }
    const proto = new FlashgbxProtocol(port, { setVarDelayMs: 0 });
    let caught: CartError | null = null;
    try {
      await proto.writeSram('gba', new Uint8Array(AGB_FLASH_TOTAL_BYTES));
    } catch (e) {
      caught = e as CartError;
    }
    expect(caught).toBeInstanceOf(CartError);
    expect(caught!.reason).toBe('WRITE_FAILED');
    expect(caught!.meta?.phase).toBe('erase_poll');
    expect(caught!.meta?.sectorIndex).toBe(0);
  });
});

describe('FlashgbxProtocol — AGB Flash sector boundaries', () => {
  it('writes 17 sectors when given 1 bank + 1 sector of payload (68 KB)', async () => {
    const sectors = 17;
    const port = makeMockPort();
    // Bank 0 switch (12 acks) — sectors 0..15 (16 sectors stay in bank 0).
    ack(port, 12);
    for (let s = 0; s < 16; s++) {
      ack(port, 18); // erase
      ack(port, 3); // poll setvars (TRANSFER_SIZE=64, ADDRESS, TRANSFER_SIZE=2)
      port.enqueueRx(bytes(0xff, 0xff));
      ack(port, 18); // write: 2 setvars + 16 page acks (HIL-fix: setvars once per sector)
    }
    // Bank 1 switch + sector 16.
    ack(port, 12);
    ack(port, 18);
    ack(port, 3);
    port.enqueueRx(bytes(0xff, 0xff));
    ack(port, 18); // write: 2 setvars + 16 page acks (HIL-fix)
    const proto = new FlashgbxProtocol(port, { setVarDelayMs: 0 });
    await proto.writeSram('gba', new Uint8Array(sectors * AGB_FLASH_SECTOR_BYTES));
    // 0xC4 (AGB_CART_WRITE_SRAM) is still used for JEDEC commands +
    // bank-switch via cartWriteAgbByte. Page-write data now uses 0xC7
    // (AGB_CART_WRITE_FLASH_DATA) per the LK_Device.py per-save-type
    // command map.
    // 0xC4 count: 8 (bank-switch cart_writes) + 6 × sectors (erase) ≥ 110.
    // 0xC7 count: at least one per page write = 16 × 17 = 272.
    expect(port.txLog.filter((b) => b === 0xc4).length).toBeGreaterThanOrEqual(8 + 6 * sectors);
    expect(port.txLog.filter((b) => b === 0xc7).length).toBeGreaterThanOrEqual(16 * sectors);
  });

  it('refuses non-sector-aligned AGB Flash sizes', async () => {
    const port = makeMockPort();
    const proto = new FlashgbxProtocol(port, { setVarDelayMs: 0 });
    await expect(proto.writeSram('gba', new Uint8Array(AGB_FLASH_BANK_BYTES + 1))).rejects.toThrow(
      CartError,
    );
  });
});
