/**
 * InsidegadgetsProtocol unit tests against a scripted mock port.
 */
import { describe, it, expect } from 'vitest';
import { InsidegadgetsProtocol } from '../insidegadgets.js';
import { makeMockPort, ascii, bytes } from './mockPort.js';
import { CartError } from '../../types.js';

describe('InsidegadgetsProtocol', () => {
  it('readFirmware sends V then h and reads two single-byte responses', async () => {
    const port = makeMockPort();
    // Stock firmware response: V → 26 (firmware), h → 5 (PCB v1.4).
    port.enqueueRx(bytes(26));
    port.enqueueRx(bytes(5));
    const proto = new InsidegadgetsProtocol(port);
    const fw = await proto.readFirmware();
    expect(fw.variant).toBe('insidegadgets');
    expect(fw.majorRev).toBe(26);
    expect(fw.banner).toContain('R26');
    expect(fw.banner).toContain('PCB 5');
    expect(port.txAscii()).toBe('Vh');
  });

  it('readFirmware tolerates PCB-query timeout (older firmware) and still returns the firmware version', async () => {
    const port = makeMockPort();
    port.enqueueRx(bytes(1)); // R1 firmware, no h support
    const proto = new InsidegadgetsProtocol(port);
    const fw = await proto.readFirmware();
    expect(fw.majorRev).toBe(1);
    expect(fw.banner).toContain('R1');
  });

  // R26+ firmware: voltage byte alone selects cart mode — no 'G' / 'g' afterwards.
  it('setMode("gb") writes only 5 (VOLTAGE_5V)', async () => {
    const port = makeMockPort();
    const proto = new InsidegadgetsProtocol(port);
    await proto.setMode('gb');
    expect(port.txAscii()).toBe('5');
  });

  it('setMode("gbc") writes only 3 (VOLTAGE_3_3V)', async () => {
    const port = makeMockPort();
    const proto = new InsidegadgetsProtocol(port);
    await proto.setMode('gbc');
    expect(port.txAscii()).toBe('3');
  });

  it('setMode("gba") writes only 3 (VOLTAGE_3_3V)', async () => {
    const port = makeMockPort();
    const proto = new InsidegadgetsProtocol(port);
    await proto.setMode('gba');
    expect(port.txAscii()).toBe('3');
  });

  // Multi-byte commands terminate with NUL (0x00), not newline — per upstream
  // `set_number()` in gbxcart_rw_console_v1.36/setup.c. Earlier impl had \n.
  it('setBank issues B4000 then Bxx with NUL terminators (bank-select via SET_BANK)', async () => {
    const port = makeMockPort();
    const proto = new InsidegadgetsProtocol(port);
    await proto.setBank(2);
    expect(port.txAscii()).toBe('B4000\x00B2\x00');
  });

  it('setRamEnabled(true) issues B0 then B0a with NUL terminators (MBC RAM enable)', async () => {
    const port = makeMockPort();
    const proto = new InsidegadgetsProtocol(port);
    await proto.setRamEnabled(true);
    expect(port.txAscii()).toBe('B0\x00Ba\x00');
  });

  it('readSram for GBA emits SET_START_ADDRESS + m, accumulates the requested length', async () => {
    const port = makeMockPort();
    // The protocol issues 'm' once, then waits for 64-byte-aligned chunks.
    // For 128-byte read we need 128 firmware-block bytes (2 blocks of 64).
    const payload = new Uint8Array(128);
    for (let i = 0; i < 128; i++) payload[i] = i & 0xff;
    port.enqueueRx(payload);
    const proto = new InsidegadgetsProtocol(port);
    const out = await proto.readSram('gba', 128);
    expect(Array.from(out)).toEqual(Array.from(payload));
    // Wire trace: must start with `A0\0` (NUL terminator on set_number) then
    // 'm', end with `'0'` (0x30) stop byte per upstream `com_read_stop`.
    const txt = port.txAscii();
    expect(txt.startsWith('A0\x00m')).toBe(true);
    expect(port.txLog[port.txLog.length - 1]).toBe(0x30);
  });

  it('writeSram for GBA acks with "1" per page', async () => {
    const port = makeMockPort();
    // 64-byte page ack is ASCII "1".
    port.enqueueRx(ascii('1'), ascii('1'));
    const data = new Uint8Array(128);
    const proto = new InsidegadgetsProtocol(port);
    await proto.writeSram('gba', data);
    expect(port.txLog.length).toBeGreaterThan(0);
  });

  it('writeSram throws WRITE_FAILED on non-ack response', async () => {
    const port = makeMockPort();
    port.enqueueRx(bytes(0x30)); // '0' → not the ack '1'
    const proto = new InsidegadgetsProtocol(port);
    await expect(proto.writeSram('gba', new Uint8Array(64))).rejects.toThrow(CartError);
  });
});
