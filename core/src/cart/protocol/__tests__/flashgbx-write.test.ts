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

describe('FlashgbxProtocol — DMG SRAM writeSram (per LK_Device.py:1611-1638)', () => {
  it('writes one bank with setvar prelude ONCE before loop + cleanup ONCE after', async () => {
    const port = makeMockPort();
    // 4 setvar acks before the loop (TRANSFER_SIZE, ADDRESS, DMG_ACCESS_MODE,
    // DMG_WRITE_CS_PULSE=1) + 32 page-write acks + 2 cleanup setvars
    // (ADDRESS=0, DMG_WRITE_CS_PULSE=0).
    ack(port, 4 + 32 + 2);
    const proto = new FlashgbxProtocol(port, { setVarDelayMs: 0 });
    const data = new Uint8Array(8192).fill(0x42);
    await proto.writeSram('gb', data);
    // OP_DMG_CART_WRITE_SRAM opcode (0xB3) appears once per page = 32 times,
    // and shouldn't appear inside any setvar frame at this address (0xA000).
    const opcodeCount = port.txLog.filter((b) => b === 0xb3).length;
    expect(opcodeCount).toBe(32);
  });

  it('issues the prelude in the documented order (TRANSFER_SIZE→ADDRESS=0xA000→ACCESS_MODE=4→CS_PULSE=1)', async () => {
    const port = makeMockPort();
    // 4 prelude setvars + 1 page-write ack + 2 cleanup setvars.
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
    // 4 prelude + 4 page-write acks + 2 cleanup.
    ack(port, 4 + 4 + 2);
    const proto = new FlashgbxProtocol(port, { writeChunkBytes: 64, setVarDelayMs: 0 });
    await proto.writeSram('gb', new Uint8Array(256));
    expect(port.txLog.filter((b) => b === 0xb3).length).toBe(4);
  });

  it('aborts mid-write on signal', async () => {
    const port = makeMockPort();
    // Pre-ack the 4 prelude setvars + the 2 finally-block cleanup setvars
    // (the abort throws inside the loop, finally still runs).
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
  it('DMG: power-cycle + MBC reset + setvar prelude + chip-ID exit probe', async () => {
    const port = makeMockPort();
    // Order matters — the mock returns chunks in FIFO order:
    //   2 single-opcode acks for OP_CART_PWR_ON (0xF2) + OP_DMG_MBC_RESET (0xB4)
    // + 5 setvar prelude acks
    // + 2 cart_write probe acks (0x2000=0x00, 0x4000=0x90)
    // + 4 setvar acks for the 2-byte ROM read (TRANSFER_SIZE=64 →
    //   ADDRESS → DMG_ACCESS_MODE → TRANSFER_SIZE=2)
    // + 2 ROM-read data bytes
    // + 4 trailing cart_write acks (0x4000=0xF0, 0xFF; 0x2000=0x1; 0x4000=0)
    ack(port, 2 + 5 + 2 + 4);
    port.enqueueRx(bytes(0x00, 0x00));
    ack(port, 4);
    const proto = new FlashgbxProtocol(port, { setVarDelayMs: 0 });
    await proto.prepareForWrite('gb');
    // First two TX bytes: OP_CART_PWR_ON (0xF2), then OP_DMG_MBC_RESET (0xB4).
    expect(port.txLog[0]).toBe(0xf2);
    expect(port.txLog[1]).toBe(0xb4);
    // PULLUPS_ENABLED (size=1, key=0x000E, value=0).
    expect(port.txLog.slice(2, 2 + SET_VAR_FRAME)).toEqual([
      0xa6, 1, 0x00, 0x00, 0x00, 0x0e, 0x00, 0x00, 0x00, 0x00,
    ]);
    // STATUS_REGISTER_MASK (size=2, key=0x0005, value=0x80).
    expect(port.txLog.slice(2 + SET_VAR_FRAME, 2 + SET_VAR_FRAME * 2)).toEqual([
      0xa6, 2, 0x00, 0x00, 0x00, 0x05, 0x00, 0x00, 0x00, 0x80,
    ]);
    // After the 5 setvars, the chip-ID exit probe issues:
    //   _cart_write 0x2000=0x00, 0x4000=0x90, [2-byte ROM read],
    //   0x4000=0xF0, 0x4000=0xFF, 0x2000=0x01, 0x4000=0x00.
    // OP_DMG_CART_WRITE opcode is 0xB2 (1 + 4-byte addr + 1 value = 6 bytes per write).
    const probeStart = 2 + 5 * SET_VAR_FRAME;
    // First probe write: 0x2000 = 0x00.
    expect(port.txLog.slice(probeStart, probeStart + 6)).toEqual([
      0xb2, 0x00, 0x00, 0x20, 0x00, 0x00,
    ]);
    // Second probe write: 0x4000 = 0x90 (JEDEC chip-ID enter).
    expect(port.txLog.slice(probeStart + 6, probeStart + 12)).toEqual([
      0xb2, 0x00, 0x00, 0x40, 0x00, 0x90,
    ]);
    // OP_DMG_CART_READ (0xB1) should appear exactly once (the 2-byte chip-ID read).
    expect(port.txLog.filter((b) => b === 0xb1).length).toBe(1);
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
