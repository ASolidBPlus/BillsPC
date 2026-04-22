/**
 * S6b — Gen 2 (Crystal) save writer (slot delete) tests.
 *
 * Layout under test (per offsetsCrystal.ts + empirical check on
 * demo-crystal.sav):
 *   primary main-save block  : 0x2009..0x2B82, checksum @0x2D69 (LE16)
 *   backup mirror            : 0x1209..0x1D82, checksum @0x1F0D (LE16)
 *   PC box banks             : 0x4000 (boxes 1-7), 0x6000 (boxes 8-14) —
 *                              outside both checksum ranges
 *   current box live buffer  : 0x2D10 — outside both checksum ranges
 *   party                    : 0x2865 — INSIDE primary range
 *
 * So party deletes update the primary checksum, the backup mirror, and
 * the backup checksum. Box and current-box deletes don't touch any
 * checksum.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSave, isSaveError, deleteMonGen2 } from '../../../index.js';
import {
  C_BOX_BANK_OFFSETS,
  C_CHECKSUM_OFFSET,
  C_CHECKSUM_RANGE_END_INCLUSIVE,
  C_CHECKSUM_RANGE_START,
  C_CURRENT_BOX_OFFSET,
  GEN2_BOX_STRIDE,
} from '../offsetsCrystal.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO_CRYSTAL = resolve(HERE, '../../../../../tests/fixtures/saves/demo-crystal.sav');

const C_BACKUP_MIRROR_OFFSET = 0x1209;
const C_BACKUP_CHECKSUM_OFFSET = 0x1f0d;

function load(): Uint8Array {
  return new Uint8Array(readFileSync(DEMO_CRYSTAL));
}

function readU16LE(b: Uint8Array, off: number): number {
  return (b[off]! | (b[off + 1]! << 8)) >>> 0;
}

function sumU16(b: Uint8Array, lo: number, hi: number): number {
  let s = 0;
  for (let i = lo; i <= hi; i++) s = (s + b[i]!) & 0xffff;
  return s;
}

describe('deleteMonGen2 — party delete', () => {
  it('shrinks the party and re-parses cleanly with no warnings', () => {
    const before = load();
    const beforeSave = parseSave(before);
    if (isSaveError(beforeSave)) throw new Error(beforeSave.message);
    const len = beforeSave.party.length;
    expect(len).toBeGreaterThan(1);
    const speciesAfterSlot1 = beforeSave.party.slice(2).map((m) => m.speciesGen2Id);

    const after = deleteMonGen2(before, 'CRYSTAL', { bucket: 'party', slot: 1 });

    const reparsed = parseSave(after);
    if (isSaveError(reparsed)) throw new Error(reparsed.message);
    expect(reparsed.party.length).toBe(len - 1);
    expect(reparsed.party.slice(1).map((m) => m.speciesGen2Id)).toEqual(speciesAfterSlot1);
    // The fixture's stored primary checksum is dead (emulator save state),
    // so it has 'checksum_mismatch' baseline. After our delete we recompute
    // and write the correct primary checksum, which means the reparse will
    // NOT produce 'checksum_mismatch' anymore — the warnings list shrinks.
    expect(reparsed.warnings).not.toContain('checksum_mismatch');
  });

  it('updates BOTH checksums and keeps the backup mirror byte-equal to the primary', () => {
    const before = load();
    const after = deleteMonGen2(before, 'CRYSTAL', { bucket: 'party', slot: 0 });

    const primary = sumU16(after, C_CHECKSUM_RANGE_START, C_CHECKSUM_RANGE_END_INCLUSIVE);
    expect(readU16LE(after, C_CHECKSUM_OFFSET)).toBe(primary);

    const len = C_CHECKSUM_RANGE_END_INCLUSIVE - C_CHECKSUM_RANGE_START + 1;
    const backupSum = sumU16(
      after,
      C_BACKUP_MIRROR_OFFSET,
      C_BACKUP_MIRROR_OFFSET + len - 1,
    );
    expect(readU16LE(after, C_BACKUP_CHECKSUM_OFFSET)).toBe(backupSum);

    // The backup mirror is a verbatim copy of the primary block.
    for (let i = 0; i < len; i++) {
      expect(after[C_BACKUP_MIRROR_OFFSET + i]).toBe(after[C_CHECKSUM_RANGE_START + i]);
    }
  });

  it('input bytes are unmodified (writer returns a fresh buffer)', () => {
    const before = load();
    const snapshot = new Uint8Array(before);
    deleteMonGen2(before, 'CRYSTAL', { bucket: 'party', slot: 0 });
    expect(Buffer.compare(Buffer.from(before), Buffer.from(snapshot))).toBe(0);
  });
});

describe('deleteMonGen2 — stored (non-current) box delete', () => {
  it('decrements the count and shifts the species list down', () => {
    const before = load();
    const beforeSave = parseSave(before);
    if (isSaveError(beforeSave)) throw new Error(beforeSave.message);
    // Pick a stored box that is NOT the current box (the parser tells us
    // currentBoxIndex; pick anything with ≥ 2 mons that isn't it).
    const cur = beforeSave.currentBoxIndex;
    let target = -1;
    for (let i = 0; i < beforeSave.boxes.length; i++) {
      if (i !== cur && beforeSave.boxes[i]!.length >= 2) {
        target = i;
        break;
      }
    }
    if (target < 0) return;
    const lenBefore = beforeSave.boxes[target]!.length;
    const slot1Species = beforeSave.boxes[target]![1]!.speciesGen2Id;

    const after = deleteMonGen2(before, 'CRYSTAL', { bucket: 'box', boxIndex: target, slot: 0 });
    const reparsed = parseSave(after);
    if (isSaveError(reparsed)) throw new Error(reparsed.message);
    expect(reparsed.boxes[target]!.length).toBe(lenBefore - 1);
    expect(reparsed.boxes[target]![0]!.speciesGen2Id).toBe(slot1Species);
  });

  it('does NOT touch the primary or backup checksum bytes (boxes are outside both ranges)', () => {
    const before = load();
    const beforeSave = parseSave(before);
    if (isSaveError(beforeSave)) throw new Error(beforeSave.message);
    let target = -1;
    for (let i = 0; i < beforeSave.boxes.length; i++) {
      if (i !== beforeSave.currentBoxIndex && beforeSave.boxes[i]!.length >= 1) {
        target = i;
        break;
      }
    }
    if (target < 0) return;
    const after = deleteMonGen2(before, 'CRYSTAL', { bucket: 'box', boxIndex: target, slot: 0 });
    expect(after[C_CHECKSUM_OFFSET]).toBe(before[C_CHECKSUM_OFFSET]);
    expect(after[C_CHECKSUM_OFFSET + 1]).toBe(before[C_CHECKSUM_OFFSET + 1]);
    expect(after[C_BACKUP_CHECKSUM_OFFSET]).toBe(before[C_BACKUP_CHECKSUM_OFFSET]);
    expect(after[C_BACKUP_CHECKSUM_OFFSET + 1]).toBe(before[C_BACKUP_CHECKSUM_OFFSET + 1]);
  });

  it('byte-equivalence outside the touched stored-box block', () => {
    const before = load();
    const beforeSave = parseSave(before);
    if (isSaveError(beforeSave)) throw new Error(beforeSave.message);
    let target = -1;
    for (let i = 0; i < beforeSave.boxes.length; i++) {
      if (i !== beforeSave.currentBoxIndex && beforeSave.boxes[i]!.length >= 1) {
        target = i;
        break;
      }
    }
    if (target < 0) return;
    const after = deleteMonGen2(before, 'CRYSTAL', { bucket: 'box', boxIndex: target, slot: 0 });
    const bank = Math.floor(target / 7);
    const within = target % 7;
    const blockStart = C_BOX_BANK_OFFSETS[bank]! + within * GEN2_BOX_STRIDE;
    const blockEnd = blockStart + GEN2_BOX_STRIDE;
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

describe('deleteMonGen2 — current box delete', () => {
  it('shrinks the current-box list and re-parses cleanly', () => {
    const before = load();
    const beforeSave = parseSave(before);
    if (isSaveError(beforeSave)) throw new Error(beforeSave.message);
    if (!beforeSave.currentBox || beforeSave.currentBox.length === 0) return;
    const len = beforeSave.currentBox.length;
    const after = deleteMonGen2(before, 'CRYSTAL', { bucket: 'currentBox', slot: 0 });
    const reparsed = parseSave(after);
    if (isSaveError(reparsed)) throw new Error(reparsed.message);
    expect(reparsed.currentBox?.length).toBe(len - 1);
    // Current-box delete sits outside the primary checksum range, so we
    // don't recompute. The fixture's pre-existing dead-checksum warning
    // therefore carries through unchanged.
    expect(reparsed.warnings).toEqual(beforeSave.warnings);
  });

  it('byte-equivalence outside the current-box buffer', () => {
    const before = load();
    const beforeSave = parseSave(before);
    if (isSaveError(beforeSave)) throw new Error(beforeSave.message);
    if (!beforeSave.currentBox || beforeSave.currentBox.length === 0) return;
    const after = deleteMonGen2(before, 'CRYSTAL', { bucket: 'currentBox', slot: 0 });
    const blockStart = C_CURRENT_BOX_OFFSET;
    const blockEnd = blockStart + GEN2_BOX_STRIDE;
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

describe('deleteMonGen2 — error cases', () => {
  it('throws on out-of-range slot', () => {
    const before = load();
    expect(() => deleteMonGen2(before, 'CRYSTAL', { bucket: 'party', slot: 99 })).toThrow();
  });

  it('refuses GS format (deferred to a later sprint)', () => {
    const before = load();
    expect(() => deleteMonGen2(before, 'GS', { bucket: 'party', slot: 0 })).toThrow();
  });

  it('throws on out-of-range boxIndex', () => {
    const before = load();
    expect(() =>
      deleteMonGen2(before, 'CRYSTAL', { bucket: 'box', boxIndex: 99, slot: 0 }),
    ).toThrow();
  });
});
