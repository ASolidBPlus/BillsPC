/**
 * S9 — wire-byte fixture regression. Per PLAN §5.5.
 *
 * Replays the exact ops captured from pre-S9 main into
 * `__fixtures__/crystal-rtc-write-bytes.json`, but driven through the
 * NEW S9 mapper-aware path:
 *
 *   prepareForWrite('gbc', { skipMapperLogic: true })   // 5 setvars
 *   mapper.exerciseRtc(protocol.cartBus())              // HasRTC dance
 *   runCartWriteCommands(mapper.enableRam(true))        // MBC3: [0x0000=0x0a]
 *   runCartWriteCommands(mapper.selectBankRam(0))       // [0x4000=0x00]
 *   writeSram('gbc', 256-byte payload)                  // 1 batch / 1 page
 *
 * The byte stream the mapper-driven path emits MUST equal the fixture
 * byte-for-byte. A re-ordering or any spurious wire write fails this
 * test even if higher-level counters match.
 *
 * Frame-by-frame array comparison per the §5.5 / §6.8 amendment — NOT
 * counter checks like "count of CLK_TOGGLE opcodes = 6".
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlashgbxProtocol } from '../protocol/flashgbx.js';
import { makeMockPort, bytes } from '../protocol/__tests__/mockPort.js';
import { DmgMapperMbc3Rtc } from '../mapper/dmg.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, '__fixtures__/crystal-rtc-write-bytes.json');

describe('S9 wire-byte regression — mapper-driven Crystal path matches pre-S9 fixture', () => {
  it('byte-for-byte equals captured fixture', async () => {
    const expected: number[] = JSON.parse(readFileSync(FIXTURE, 'utf-8'));
    expect(expected.length).toBeGreaterThan(100);

    const port = makeMockPort();
    const ack = bytes(0x01);
    const queueAck = (n: number): void => {
      for (let i = 0; i < n; i++) port.enqueueRx(ack);
    };
    const enqueueBulkRead256 = (): void => {
      queueAck(4); // TRANSFER_SIZE/ADDRESS/DMG_ACCESS_MODE/DMG_READ_CS_PULSE=1
      for (let r = 0; r < 4; r++) port.enqueueRx(new Uint8Array(64));
      queueAck(1); // DMG_READ_CS_PULSE=0 cleanup
    };
    // prepareForWrite (skipMapperLogic): 5 setvar acks only.
    queueAck(5);
    // mapper.exerciseRtc:
    //   pre-loop: 5 cart-writes + 1 clk = 6 acks
    queueAck(6);
    //   5 iters: clk + cart-write + bulkRead 256 = 2 + (4+1) acks per iter
    for (let r = 0; r < 5; r++) {
      queueAck(2);
      enqueueBulkRead256();
    }
    //   post-loop: 2 cart-writes
    queueAck(2);
    // runCartWriteCommands(enableRam(true)): 1 cart-write
    queueAck(1);
    // runCartWriteCommands(selectBankRam(0)): 1 cart-write
    queueAck(1);
    // writeSram batch: 4 prelude + 1 SRAM-write + 2 cleanup = 7
    queueAck(7);

    const protocol = new FlashgbxProtocol(port, { setVarDelayMs: 0 });
    const mapper = new DmgMapperMbc3Rtc(0x10);
    await protocol.prepareForWrite('gbc', { skipMapperLogic: true });
    await mapper.exerciseRtc(protocol.cartBus());
    await protocol.runCartWriteCommands!(mapper.enableRam(true));
    await protocol.runCartWriteCommands!(mapper.selectBankRam(0));
    await protocol.writeSram('gbc', new Uint8Array(256).fill(0xa5));

    expect(port.txLog).toEqual(expected);
  });
});
