/**
 * One-shot fixture-capture script (NOT a test). Run via:
 *   bun core/src/cart/__tests__/__fixtures__/capture-fixture.ts
 *
 * Captures the wire-byte sequence the CURRENT (pre-S9) code path emits
 * for Pokemon Crystal (cart_type=0x10, MBC3+RTC, family='gbc'):
 *
 *   prepareForWrite('gbc')
 *     → 5-setvar prelude
 *     → dmgRtcExerciseAndReset (the HasRTC dance)
 *   setRamEnabled(true)
 *   setBank(0)
 *   writeSram('gbc', 256-byte payload)  // single batch, single page
 *
 * The byte stream is dumped to crystal-rtc-write-bytes.json so the
 * Stage-3 mapper-driven path can be regression-tested against it.
 */

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlashgbxProtocol } from '../../protocol/flashgbx.js';
import { makeMockPort, bytes } from '../../protocol/__tests__/mockPort.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, 'crystal-rtc-write-bytes.json');

async function main(): Promise<void> {
  const port = makeMockPort();
  const ack = bytes(0x01);
  // Per-iteration RTC bulk-read response: 4 setvar acks, then 4
  // read-chunk responses of 64 bytes each, then 1 setvar ack.
  const enqueueBulkRead256 = (): void => {
    for (let i = 0; i < 4; i++) port.enqueueRx(ack); // TRANSFER_SIZE/ADDR/MODE/CS_PULSE=1
    for (let r = 0; r < 4; r++) port.enqueueRx(new Uint8Array(64)); // 4×64=256
    port.enqueueRx(ack); // CS_PULSE=0 cleanup
  };
  // prepareForWrite('gbc'):
  //   5 setvar acks (PULLUPS, STATUS_MASK, STATUS_VAL, WRITE_CS, READ_CS)
  for (let i = 0; i < 5; i++) port.enqueueRx(ack);
  //   dmgRtcExerciseAndReset:
  //     4 cart-write acks (EnableRAM false, true, then re-asserted true)
  //     no — re-read: 0,0=00; 0,0=0a; CLK; 0,0=0a; 6000=00; 6000=01; ...
  //     pre-loop: 2 cart-write + 1 clk + 3 cart-write = 6 acks
  for (let i = 0; i < 6; i++) port.enqueueRx(ack);
  //     5 iterations of (1 clk + 1 cart-write + 1 bulkRead 256B)
  for (let r = 0; r < 5; r++) {
    port.enqueueRx(ack); // clk
    port.enqueueRx(ack); // cart-write 0x4000=reg
    enqueueBulkRead256();
  }
  //     post-loop: 2 cart-writes (DisableRAM, reset bank 0)
  for (let i = 0; i < 2; i++) port.enqueueRx(ack);
  // setRamEnabled(true): 1 cart-write ack
  port.enqueueRx(ack);
  // setBank(0): 1 cart-write ack
  port.enqueueRx(ack);
  // writeSram batch: 4 prelude + 1 SRAM-write + 2 cleanup
  for (let i = 0; i < 7; i++) port.enqueueRx(ack);

  const proto = new FlashgbxProtocol(port, { setVarDelayMs: 0 });
  await proto.prepareForWrite('gbc');
  await proto.setRamEnabled(true);
  await proto.setBank(0);
  await proto.writeSram('gbc', new Uint8Array(256).fill(0xa5));

  const out = port.txLog;
  if (out.length < 100) {
    throw new Error(`fixture too short: got ${out.length} bytes`);
  }
  writeFileSync(OUT, JSON.stringify(out));
  console.log(`captured ${out.length} bytes to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
