/**
 * Gen 1 parser — per-mon OT TID test.
 *
 * Same regression as Gen 2: traded mons (OT TID ≠ player TID) were
 * silently relabeled. The per-mon OT TID lives at offset 0x0C
 * (`RB_MON_OT_TID`) of each mon record. Parser now reads from there
 * instead of using the cart's player TID.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGen1 } from '../parser.js';
import {
  RB_PARTY_RECORDS_OFFSET,
  RB_MON_OT_TID,
  GEN1_PARTY_MON_BYTES,
  RB_TRAINER_TID_OFFSET,
} from '../offsets.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO_RED = resolve(HERE, '../../../../../tests/fixtures/saves/demo-red.sav');

function loadSav(): Uint8Array {
  return new Uint8Array(readFileSync(DEMO_RED));
}

function writeBE16(bytes: Uint8Array, off: number, value: number): void {
  bytes[off] = (value >> 8) & 0xff;
  bytes[off + 1] = value & 0xff;
}

function readBE16(bytes: Uint8Array, off: number): number {
  return ((bytes[off]! << 8) | bytes[off + 1]!) >>> 0;
}

describe('parseGen1 — per-mon OT TID (regression)', () => {
  it('reads the OT TID from the mon record, not the cart trainer TID', () => {
    const sav = loadSav();
    const cartTid = readBE16(sav, RB_TRAINER_TID_OFFSET);
    expect(cartTid).toBeGreaterThan(0);

    const tradedTid = (cartTid ^ 0x5a5a) & 0xffff;
    expect(tradedTid).not.toBe(cartTid);
    const slot0Off = RB_PARTY_RECORDS_OFFSET + 0 * GEN1_PARTY_MON_BYTES;
    writeBE16(sav, slot0Off + RB_MON_OT_TID, tradedTid);

    // Parse the Gen 1 SRAM directly — bypass the format-detection
    // checksum gate (we deliberately corrupted the byte sequence with
    // the injected TID and don't care about checksum recomputation here).
    const parsed = parseGen1(sav, 'RBY-RED');
    expect(parsed.party[0]!.tid).toBe(tradedTid);
    if (parsed.party.length > 1) {
      expect(parsed.party[1]!.tid).toBe(cartTid);
    }
    expect(parsed.trainer.tid).toBe(cartTid);
  });
});
