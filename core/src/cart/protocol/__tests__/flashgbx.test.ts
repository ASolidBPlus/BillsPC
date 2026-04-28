import { describe, it, expect } from 'vitest';
import { FlashgbxProtocol } from '../flashgbx.js';
import { makeMockPort, bytes } from './mockPort.js';
import { CartError } from '../../types.js';

function asciiBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/**
 * Queue a SET_VAR ack (single 0x01 byte). Each setVar in the impl issues
 * exactly one ack read; bunch them up here for the readability of the tests.
 */
function ack(port: ReturnType<typeof makeMockPort>, n = 1): void {
  for (let i = 0; i < n; i++) port.enqueueRx(bytes(0x01));
}

describe('FlashgbxProtocol — LK firmware (L>=12)', () => {
  it('readFirmware parses the QUERY_FW_INFO struct (cfwId/fwVer/pcbVer + name)', async () => {
    const port = makeMockPort();
    // Real-cart response from a v1.4a/b/c R42+L14 cart (captured 2026-04-22):
    //   size=8, cfw='L', fwVer=14 BE, pcbVer=6, fwTs=...
    //   nameLen=11, name="GBxCart RW", trailers=2
    port.enqueueRx(bytes(0x08));
    port.enqueueRx(bytes(0x4c, 0x00, 0x0e, 0x06, 0x68, 0x30, 0x3d, 0x4c));
    port.enqueueRx(bytes(0x0b));
    port.enqueueRx(asciiBytes('GBxCart RW'), bytes(0x00));
    port.enqueueRx(bytes(0x01, 0x00));
    const proto = new FlashgbxProtocol(port);
    const fw = await proto.readFirmware();
    expect(fw.variant).toBe('lesserkuma');
    expect(fw.majorRev).toBe(14);
    expect(fw.banner).toContain('GBxCart RW');
    expect(fw.banner).toContain('L14');
    // QUERY_FW_INFO is a single-byte command — anything else and the
    // firmware treats the trailing zeros as NUL no-ops.
    expect(port.txLog[0]).toBe(0xa1);
    expect(port.txLog.length).toBe(1);
  });

  it('readFirmware throws on unexpected size byte', async () => {
    const port = makeMockPort();
    port.enqueueRx(bytes(0x07)); // size != 8
    const proto = new FlashgbxProtocol(port);
    await expect(proto.readFirmware()).rejects.toThrow(CartError);
  });

  it('setMode("gb") issues CART_MODE + voltage 5V + cart-power-on + MBC reset (all acked)', async () => {
    const port = makeMockPort();
    // 1 setVar ack (CART_MODE) + voltage ack + power ack + MBC reset ack.
    ack(port, 3 + 3);
    const proto = new FlashgbxProtocol(port);
    await proto.setMode('gb');
    expect(port.txLog).toContain(0xa5); // SET_VOLTAGE_5V
    expect(port.txLog).toContain(0xf2); // CART_PWR_ON
    expect(port.txLog).toContain(0xb4); // DMG_MBC_RESET
    expect(port.txLog.includes(0xa4)).toBe(false); // no 3.3V for plain gb
  });

  it('setMode("gbc") uses 5V (FlashGBX has no separate GBC voltage)', async () => {
    const port = makeMockPort();
    ack(port, 3 + 3);
    const proto = new FlashgbxProtocol(port);
    await proto.setMode('gbc');
    // Per LK_Device.py:842-844 — SetMode("DMG") always sends SET_VOLTAGE_5V.
    // GBC carts are 3.3V-spec but 5V-tolerant; FlashGBX runs them at 5V.
    expect(port.txLog).toContain(0xa5); // 5V
    expect(port.txLog.includes(0xa4)).toBe(false);
  });

  it('setMode("gba") uses 3.3V + AGB bootup sequence (no MBC reset)', async () => {
    const port = makeMockPort();
    // 1 setVar ack (CART_MODE) + voltage + power + AGB bootup.
    ack(port, 3 + 3);
    const proto = new FlashgbxProtocol(port);
    await proto.setMode('gba');
    expect(port.txLog).toContain(0xa4); // 3.3V
    expect(port.txLog).toContain(0xc9); // AGB_BOOTUP_SEQUENCE
    expect(port.txLog.includes(0xb4)).toBe(false); // no DMG MBC reset
  });

  it('setBank issues a DMG_CART_WRITE to 0x4000 with the bank number', async () => {
    const port = makeMockPort();
    ack(port); // for the cart_write ack
    const proto = new FlashgbxProtocol(port);
    await proto.setBank(2);
    expect(port.txLog[0]).toBe(0xb2); // OP_DMG_CART_WRITE
    expect(port.txLog.slice(1, 5)).toEqual([0x00, 0x00, 0x40, 0x00]); // addr 0x4000 BE
    expect(port.txLog[5]).toBe(0x02); // bank value
  });

  it('setRamEnabled(true) writes 0x0A to 0x0000 (MBC RAM enable)', async () => {
    const port = makeMockPort();
    ack(port);
    const proto = new FlashgbxProtocol(port);
    await proto.setRamEnabled(true);
    expect(port.txLog[0]).toBe(0xb2);
    expect(port.txLog.slice(1, 5)).toEqual([0x00, 0x00, 0x00, 0x00]);
    expect(port.txLog[5]).toBe(0x0a);
  });

  it('readRom sets TRANSFER_SIZE/ADDRESS/ACCESS_MODE then loops DMG_CART_READ', async () => {
    const port = makeMockPort();
    // 3 setVar acks (TRANSFER_SIZE, ADDRESS, DMG_ACCESS_MODE)
    ack(port, 3);
    // 64-byte chunk of cart data
    const data = new Uint8Array(64);
    for (let i = 0; i < 64; i++) data[i] = i;
    port.enqueueRx(data);
    const proto = new FlashgbxProtocol(port);
    const out = await proto.readRom(0x0000, 64);
    expect(Array.from(out)).toEqual(Array.from(data));
    // The DMG_CART_READ opcode should appear in the TX trace.
    expect(port.txLog).toContain(0xb1);
  });

  it('readSram for DMG enables RAM CS pulse, reads, then disables it', async () => {
    const port = makeMockPort();
    // 3 setVar acks for the setup + 1 for the RAM CS pulse on + chunk + 1 for off
    ack(port, 3 + 1);
    const data = new Uint8Array(64).fill(0x42);
    port.enqueueRx(data);
    ack(port, 1);
    const proto = new FlashgbxProtocol(port);
    const out = await proto.readSram('gb', 64);
    expect(Array.from(out)).toEqual(Array.from(data));
    expect(port.txLog).toContain(0xb1); // DMG_CART_READ
  });

  it('readSram for GBA uses AGB_CART_READ_SRAM (0xC3) without DMG-specific vars', async () => {
    const port = makeMockPort();
    // 2 acks: TRANSFER_SIZE=64 + ADDRESS (one chunk fills the 64-byte read).
    ack(port, 2);
    const data = new Uint8Array(64).fill(0x77);
    port.enqueueRx(data);
    const proto = new FlashgbxProtocol(port);
    const out = await proto.readSram('gba', 64);
    expect(Array.from(out)).toEqual(Array.from(data));
    expect(port.txLog).toContain(0xc3);
  });
});
