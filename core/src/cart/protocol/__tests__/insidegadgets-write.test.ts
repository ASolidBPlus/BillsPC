/**
 * S7b — Insidegadgets (stock OFW) write-side tests. The OFW path is
 * limited per AMEND-S7b-1 / PLAN §1.3 OOS: 128 KB AGB Flash needs LK
 * CFW; OFW only supports flat ≤64 KB AGB SRAM + per-byte DMG SRAM.
 */

import { describe, it, expect } from 'vitest';
import { InsidegadgetsProtocol } from '../insidegadgets.js';
import { makeMockPort, ascii, bytes } from './mockPort.js';
import { CartError } from '../../types.js';

describe('InsidegadgetsProtocol — DMG per-byte writeSram', () => {
  it('issues one W frame + ack per byte', async () => {
    const port = makeMockPort();
    const total = 128;
    // 'A a000\0' setStartAddress + per-byte 'W' + ack.
    for (let i = 0; i < total; i++) port.enqueueRx(bytes(0x31)); // '1' = ack
    const proto = new InsidegadgetsProtocol(port);
    await proto.writeSram('gb', new Uint8Array(total).fill(0xa5));
    // Count 'W' opcodes in the TX trace.
    const wCount = port.txAscii().split('W').length - 1;
    expect(wCount).toBe(total);
  });

  it('throws WRITE_FAILED on non-1 ack byte', async () => {
    const port = makeMockPort();
    port.enqueueRx(bytes(0x30)); // '0' = NOT ack
    const proto = new InsidegadgetsProtocol(port);
    await expect(proto.writeSram('gb', new Uint8Array([0x77]))).rejects.toThrow(CartError);
  });
});

describe('InsidegadgetsProtocol — AGB SRAM ≤64 KB writeSram', () => {
  it('writes pages of 64 bytes via the w opcode + ack 1', async () => {
    const port = makeMockPort();
    const total = 256; // 4 pages
    for (let i = 0; i < 4; i++) port.enqueueRx(bytes(0x31));
    const proto = new InsidegadgetsProtocol(port);
    await proto.writeSram('gba', new Uint8Array(total).fill(0xab));
    // Lower-case 'w' is the AGB SRAM page-write opcode.
    expect(port.txLog.filter((b) => b === 0x77 /* 'w' */).length).toBe(4);
  });
});

describe('InsidegadgetsProtocol — AGB Flash 128 KB refused on OFW (per AMEND-S7b-1 / PLAN §1.3)', () => {
  it('throws UNSUPPORTED_FIRMWARE pointing the user to LK CFW', async () => {
    const port = makeMockPort();
    const proto = new InsidegadgetsProtocol(port);
    let caught: CartError | null = null;
    try {
      await proto.writeSram('gba', new Uint8Array(128 * 1024));
    } catch (e) {
      caught = e as CartError;
    }
    expect(caught).toBeInstanceOf(CartError);
    expect(caught!.reason).toBe('UNSUPPORTED_FIRMWARE');
    expect(caught!.message).toMatch(/Lesserkuma/);
  });
});

describe('InsidegadgetsProtocol — prepareForWrite is a no-op', () => {
  it('does not write anything to the port (OFW has no register prelude)', async () => {
    const port = makeMockPort();
    const proto = new InsidegadgetsProtocol(port);
    await proto.prepareForWrite('gba');
    expect(port.txLog.length).toBe(0);
    void ascii;
  });
});
