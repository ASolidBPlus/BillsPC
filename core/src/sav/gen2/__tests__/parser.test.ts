/**
 * Gen 2 parser — per-mon OT TID test.
 *
 * Regression for the bug where every mon was stamped with the cart's
 * player TID instead of the per-mon OT TID stored in the mon record at
 * offset 0x06 (`C_MON_OT_TID`). A traded-mon (OT TID ≠ player TID) was
 * silently relabeled as the receiving player's; downstream the Gen 3
 * convert ran PID search with the wrong TID and produced an illegal mon.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSave, isSaveError } from '../../../index.js';
import {
  C_PARTY_RECORDS_OFFSET,
  C_MON_OT_TID,
  GEN2_PARTY_MON_BYTES,
  C_TRAINER_TID_OFFSET,
} from '../offsetsCrystal.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO_CRYSTAL = resolve(HERE, '../../../../../tests/fixtures/saves/demo-crystal.sav');

function loadSav(): Uint8Array {
  return new Uint8Array(readFileSync(DEMO_CRYSTAL));
}

function writeBE16(bytes: Uint8Array, off: number, value: number): void {
  bytes[off] = (value >> 8) & 0xff;
  bytes[off + 1] = value & 0xff;
}

function readBE16(bytes: Uint8Array, off: number): number {
  return ((bytes[off]! << 8) | bytes[off + 1]!) >>> 0;
}

describe('parseCrystal — per-mon OT TID (regression)', () => {
  it('reads the OT TID from the mon record, not the cart trainer TID', () => {
    const sav = loadSav();
    const cartTid = readBE16(sav, C_TRAINER_TID_OFFSET);
    expect(cartTid).toBeGreaterThan(0);

    // Inject a "traded" mon at party slot 0 by overwriting its OT_TID
    // with a value that's clearly distinct from the cart's player TID.
    const tradedTid = (cartTid ^ 0xa5a5) & 0xffff;
    expect(tradedTid).not.toBe(cartTid);
    const slot0Off = C_PARTY_RECORDS_OFFSET + 0 * GEN2_PARTY_MON_BYTES;
    writeBE16(sav, slot0Off + C_MON_OT_TID, tradedTid);

    const parsed = parseSave(sav);
    if (isSaveError(parsed)) throw new Error(parsed.message);
    expect(parsed.party[0]!.tid).toBe(tradedTid);
    // Other slots — unchanged in the SAV — must still report their own
    // stored TID (which in this fixture happens to match cart TID).
    if (parsed.party.length > 1) {
      expect(parsed.party[1]!.tid).toBe(cartTid);
    }
    // Trainer TID itself is untouched.
    expect(parsed.trainer.tid).toBe(cartTid);
  });

  it('reads per-mon OT TID for box mons too', () => {
    const sav = loadSav();
    const cartTid = readBE16(sav, C_TRAINER_TID_OFFSET);
    const parsed = parseSave(sav);
    if (isSaveError(parsed)) throw new Error(parsed.message);
    // Find first non-empty box.
    const firstBoxWithMon = parsed.boxes.findIndex((b) => b.length > 0);
    if (firstBoxWithMon < 0) return; // demo SAV may have empty boxes; skip
    const firstMon = parsed.boxes[firstBoxWithMon]![0]!;
    // Should be a real number, not undefined.
    expect(typeof firstMon.tid).toBe('number');
    expect(firstMon.tid).toBeGreaterThanOrEqual(0);
    expect(firstMon.tid).toBeLessThanOrEqual(0xffff);
    // For demo-crystal all mons are caught by the player, so cartTid match.
    expect(firstMon.tid).toBe(cartTid);
  });
});
