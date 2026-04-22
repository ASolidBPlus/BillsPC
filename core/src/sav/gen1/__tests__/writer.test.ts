/**
 * S6b — Gen 1 (RB) save writer (slot delete) tests.
 *
 * Round-trip strategy per the orchestrator brief:
 *   - take a real RB fixture
 *   - delete a slot via deleteMonGen1
 *   - re-parse the modified bytes via parseSave
 *   - assert the bucket is one shorter and the rest of the save is
 *     byte-identical except for the touched block + checksum byte.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSave, isSaveError, deleteMonGen1 } from '../../../index.js';
import {
  RB_CHECKSUM_OFFSET,
  RB_CHECKSUM_RANGE_END_INCLUSIVE,
  RB_CHECKSUM_RANGE_START,
  RB_BOX_BANK_OFFSETS,
  GEN1_BOX_STRIDE,
} from '../offsets.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO_RED = resolve(HERE, '../../../../../tests/fixtures/saves/demo-red.sav');

function load(): Uint8Array {
  return new Uint8Array(readFileSync(DEMO_RED));
}

describe('deleteMonGen1 — party delete', () => {
  it('drops the chosen slot and shifts the rest down', () => {
    const before = load();
    const beforeSave = parseSave(before);
    if (isSaveError(beforeSave)) throw new Error(beforeSave.message);
    const partyLen = beforeSave.party.length;
    expect(partyLen).toBeGreaterThan(1);
    const speciesAfterSlot1 = beforeSave.party.slice(2).map((m) => m.speciesGen2Id);

    const after = deleteMonGen1(before, 'RBY-RED', { bucket: 'party', slot: 1 });

    const reparsed = parseSave(after);
    if (isSaveError(reparsed)) throw new Error(reparsed.message);
    expect(reparsed.party.length).toBe(partyLen - 1);
    // The mons originally at indices 2..N now sit at 1..N-1.
    expect(reparsed.party.slice(1).map((m) => m.speciesGen2Id)).toEqual(speciesAfterSlot1);
    // No NEW warnings beyond what the original fixture produced.
    expect(reparsed.warnings).toEqual(beforeSave.warnings);
  });

  it('returns a fresh buffer; the input is unmodified', () => {
    const before = load();
    const snapshot = new Uint8Array(before);
    deleteMonGen1(before, 'RBY-RED', { bucket: 'party', slot: 0 });
    expect(Buffer.compare(Buffer.from(before), Buffer.from(snapshot))).toBe(0);
  });

  it('recomputes the 8-bit XOR checksum (otherwise the parser warns)', () => {
    const before = load();
    const after = deleteMonGen1(before, 'RBY-RED', { bucket: 'party', slot: 0 });
    let sum = 0;
    for (let i = RB_CHECKSUM_RANGE_START; i <= RB_CHECKSUM_RANGE_END_INCLUSIVE; i++) {
      sum = (sum + after[i]!) & 0xff;
    }
    expect((0xff - sum) & 0xff).toBe(after[RB_CHECKSUM_OFFSET]);
  });

  it('byte-equivalence: every byte outside the touched party regions + checksum byte is identical', () => {
    const before = load();
    // Touched ranges (per writer source): count, species, records, OT names.
    // Nicknames are intentionally NOT shifted in party (overlap caveat).
    const after = deleteMonGen1(before, 'RBY-RED', { bucket: 'party', slot: 1 });
    const PARTY_START = 0x2f2c;
    const PARTY_END = 0x3081; // OT names end (0x303F + 6*11)
    let diff = 0;
    for (let i = 0; i < before.length; i++) {
      if (i >= PARTY_START && i < PARTY_END) continue;
      if (i === RB_CHECKSUM_OFFSET) continue;
      if (before[i] !== after[i]) {
        diff++;
        if (diff > 3) break;
      }
    }
    expect(diff).toBe(0);
  });
});

describe('deleteMonGen1 — current box (PC) delete', () => {
  it('shrinks the current-box list by one and re-parses cleanly', () => {
    const before = load();
    const beforeSave = parseSave(before);
    if (isSaveError(beforeSave)) throw new Error(beforeSave.message);
    if (!beforeSave.currentBox || beforeSave.currentBox.length === 0) {
      // Fixture has no current-box mons — skip.
      return;
    }
    const len = beforeSave.currentBox.length;
    const after = deleteMonGen1(before, 'RBY-RED', { bucket: 'currentBox', slot: 0 });
    const reparsed = parseSave(after);
    if (isSaveError(reparsed)) throw new Error(reparsed.message);
    expect(reparsed.currentBox?.length).toBe(len - 1);
    expect(reparsed.warnings).toEqual(beforeSave.warnings);
  });

  it('also recomputes the checksum (current box at 0x30C0 sits inside the checksum range)', () => {
    const before = load();
    const beforeSave = parseSave(before);
    if (isSaveError(beforeSave) || !beforeSave.currentBox || beforeSave.currentBox.length === 0)
      return;
    const after = deleteMonGen1(before, 'RBY-RED', { bucket: 'currentBox', slot: 0 });
    let sum = 0;
    for (let i = RB_CHECKSUM_RANGE_START; i <= RB_CHECKSUM_RANGE_END_INCLUSIVE; i++) {
      sum = (sum + after[i]!) & 0xff;
    }
    expect((0xff - sum) & 0xff).toBe(after[RB_CHECKSUM_OFFSET]);
  });
});

describe('deleteMonGen1 — stored box delete (outside checksum range)', () => {
  it('decrements the count and shifts the species list', () => {
    const before = load();
    const beforeSave = parseSave(before);
    if (isSaveError(beforeSave)) throw new Error(beforeSave.message);
    // Find a stored box with at least 2 mons so we can delete slot 0 and
    // assert the next mon shifted down.
    let targetBox = -1;
    for (let i = 0; i < beforeSave.boxes.length; i++) {
      if (beforeSave.boxes[i]!.length >= 2) {
        targetBox = i;
        break;
      }
    }
    if (targetBox < 0) return; // fixture is too sparse to exercise this case
    const originalSlot1 = beforeSave.boxes[targetBox]![1]!.speciesGen2Id;
    const lenBefore = beforeSave.boxes[targetBox]!.length;

    const after = deleteMonGen1(before, 'RBY-RED', { bucket: 'box', boxIndex: targetBox, slot: 0 });
    const reparsed = parseSave(after);
    if (isSaveError(reparsed)) throw new Error(reparsed.message);
    expect(reparsed.boxes[targetBox]!.length).toBe(lenBefore - 1);
    expect(reparsed.boxes[targetBox]![0]!.speciesGen2Id).toBe(originalSlot1);
  });

  it('does NOT change the checksum byte (stored boxes sit outside the checksum range)', () => {
    const before = load();
    const beforeSave = parseSave(before);
    if (isSaveError(beforeSave)) throw new Error(beforeSave.message);
    let targetBox = -1;
    for (let i = 0; i < beforeSave.boxes.length; i++) {
      if (beforeSave.boxes[i]!.length >= 1) {
        targetBox = i;
        break;
      }
    }
    if (targetBox < 0) return;
    const after = deleteMonGen1(before, 'RBY-RED', { bucket: 'box', boxIndex: targetBox, slot: 0 });
    expect(after[RB_CHECKSUM_OFFSET]).toBe(before[RB_CHECKSUM_OFFSET]);
  });

  it('byte-equivalence outside the touched stored-box block', () => {
    const before = load();
    const beforeSave = parseSave(before);
    if (isSaveError(beforeSave)) throw new Error(beforeSave.message);
    // Use box 0 (bank 2 @ 0x4000, first slot) — we know its block range
    // because the bank/stride/box-content size are public constants.
    if (beforeSave.boxes[0]!.length === 0) return;
    const after = deleteMonGen1(before, 'RBY-RED', { bucket: 'box', boxIndex: 0, slot: 0 });
    const blockStart = RB_BOX_BANK_OFFSETS[0]!;
    const blockEnd = blockStart + GEN1_BOX_STRIDE;
    let diff = 0;
    for (let i = 0; i < before.length; i++) {
      if (i >= blockStart && i < blockEnd) continue;
      if (before[i] !== after[i]) {
        diff++;
        if (diff > 3) break;
      }
    }
    expect(diff).toBe(0);
  });
});

describe('deleteMonGen1 — last-slot edge cases', () => {
  it('deleting the last party slot lands the terminator at the new end', () => {
    const before = load();
    const beforeSave = parseSave(before);
    if (isSaveError(beforeSave)) throw new Error(beforeSave.message);
    const partyLen = beforeSave.party.length;
    const after = deleteMonGen1(before, 'RBY-RED', { bucket: 'party', slot: partyLen - 1 });
    const reparsed = parseSave(after);
    if (isSaveError(reparsed)) throw new Error(reparsed.message);
    expect(reparsed.party.length).toBe(partyLen - 1);
    // Species list at 0x2F2D: after delete, byte index `partyLen-1` (the new
    // count) should hold the 0xFF terminator.
    expect(after[0x2f2d + (partyLen - 1)]).toBe(0xff);
  });

  it('throws on out-of-range slot', () => {
    const before = load();
    expect(() => deleteMonGen1(before, 'RBY-RED', { bucket: 'party', slot: 99 })).toThrow();
  });
});
