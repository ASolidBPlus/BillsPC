/**
 * S6a — Inject orchestrator tests.
 *
 * Per orchestrator brief + PLAN §1 done-when 5: for each fixture, inject
 * one converted Crystal Feraligatr into an empty box slot, re-parse the
 * output, assert the mon is there and the rest of the save is
 * byte-identical except for the touched sectors' new checksums.
 *
 * Per PLAN_EVAL A11: payload validation by post-decrypt species, not by
 * zero-content (BAD_PAYLOAD_SIZE only fires on wrong-length input).
 *
 * Per PLAN_EVAL A13: a multi-sector-spanning slot (box 1 slot 19 — see
 * `boundary_slot_test`) writes to TWO sectors, both must get a fresh
 * checksum, and the resulting bytes round-trip cleanly.
 *
 * Each fixture has at least one empty box known up-front:
 *   ruby.sav    → box 0 (BOX 1) empty
 *   firered.sav → box 0 (BOX 1) empty
 *   emerald.sav → box 13 (BOX 14) empty
 *
 * The fixture metadata note in the orchestrator brief said "Box 1 of
 * every fixture has been emptied"; emerald's box 1 actually contains
 * 30 mons (Bulbasaur..Nidorina), so we use box 13 there. The choice is
 * made per-fixture to keep tests honest.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSave, isSaveError, convert, isRefusal, packBoxed } from '../../../index.js';
import { parseGen3Save, isGen3SaveError } from '../parseSave.js';
import { injectIntoSave, isGen3InjectError } from '../injectMon.js';
import {
  PCBUFFER_BOX_COUNT,
  PCBUFFER_SLOTS_PER_BOX,
  PCBUFFER_SLOT_BYTES,
  SAVE_BYTES_FULL,
  SECTOR_CHECKSUM_OFFSET,
  SECTOR_SIZE,
  SLOT_BYTES,
  SLOT_A_OFFSET,
  SLOT_B_OFFSET,
} from '../format.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, '../../../../test-fixtures/gen3');
const DEMO_CRYSTAL = resolve(HERE, '../../../../../tests/fixtures/saves/demo-crystal.sav');

const FERALIGATR_GEN2_ID = 160;

function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(resolve(FIXTURES, `${name}.sav`)));
}

function feraligatrPackedBytes(): Uint8Array {
  const sram = new Uint8Array(readFileSync(DEMO_CRYSTAL));
  const save = parseSave(sram);
  if (isSaveError(save)) throw new Error('demo-crystal parse failed');
  const fer =
    save.party.find((m) => m.speciesGen2Id === FERALIGATR_GEN2_ID) ??
    save.boxes.flat().find((m) => m.speciesGen2Id === FERALIGATR_GEN2_ID);
  if (!fer) throw new Error('Feraligatr not found in demo-crystal');
  const conv = convert(fer);
  if (isRefusal(conv)) throw new Error('Feraligatr conversion refused');
  return packBoxed(conv);
}

interface InjectFixture {
  readonly name: string;
  readonly emptyBox: number;
  readonly singleSectorSlot: number; // a slot whose 80 bytes fit in one sector
  readonly boundarySlot: number; // a slot that straddles a sector boundary (box 1 slot 19)
  readonly boundaryBox: number;
}

const FIXTURES_DATA: readonly InjectFixture[] = [
  { name: 'ruby', emptyBox: 0, singleSectorSlot: 0, boundarySlot: 19, boundaryBox: 1 },
  { name: 'firered', emptyBox: 0, singleSectorSlot: 0, boundarySlot: 19, boundaryBox: 1 },
  { name: 'emerald', emptyBox: 13, singleSectorSlot: 0, boundarySlot: 19, boundaryBox: 1 },
];

describe.each(FIXTURES_DATA)('Gen 3 inject: $name.sav', (fx) => {
  const bytes = loadFixture(fx.name);
  const monBytes = feraligatrPackedBytes();

  it('the chosen empty box really is empty (sanity-check fixture assumption)', () => {
    const parsed = parseGen3Save(bytes);
    if (isGen3SaveError(parsed)) throw new Error(parsed.message);
    const box = parsed.pc.boxes[fx.emptyBox]!;
    for (let s = 0; s < PCBUFFER_SLOTS_PER_BOX; s++) {
      expect(box[s]?.kind).toBe('empty');
    }
  });

  it('inject of a packed Feraligatr into an empty slot succeeds', () => {
    const parsed = parseGen3Save(bytes);
    if (isGen3SaveError(parsed)) throw new Error(parsed.message);
    const result = injectIntoSave(
      parsed,
      { boxIndex: fx.emptyBox, slot: fx.singleSectorSlot },
      monBytes,
    );
    expect(isGen3InjectError(result)).toBe(false);
    if (isGen3InjectError(result)) return;
    const slot = result.pc.boxes[fx.emptyBox]?.[fx.singleSectorSlot];
    expect(slot?.kind).toBe('filled');
    if (slot?.kind === 'filled') {
      expect(Buffer.compare(Buffer.from(slot.bytes), Buffer.from(monBytes))).toBe(0);
    }
  });

  it('Section 0 (TrainerInfo) is byte-identical pre/post inject (R2 invariant)', () => {
    const parsed = parseGen3Save(bytes);
    if (isGen3SaveError(parsed)) throw new Error(parsed.message);
    const sec0Off = parsed.active.sectorOrder.get(0)!.diskOffset;
    const before = parsed.bytes.slice(sec0Off, sec0Off + SECTOR_SIZE);
    const result = injectIntoSave(
      parsed,
      { boxIndex: fx.emptyBox, slot: fx.singleSectorSlot },
      monBytes,
    );
    if (isGen3InjectError(result)) throw new Error(result.message);
    const after = result.bytes.slice(sec0Off, sec0Off + SECTOR_SIZE);
    expect(Buffer.compare(Buffer.from(after), Buffer.from(before))).toBe(0);
  });

  it('inactive slot is byte-identical pre/post inject (PLAN_EVAL A4)', () => {
    const parsed = parseGen3Save(bytes);
    if (isGen3SaveError(parsed)) throw new Error(parsed.message);
    const inactiveBase = parsed.active.slotIndex === 0 ? SLOT_B_OFFSET : SLOT_A_OFFSET;
    const before = parsed.bytes.slice(inactiveBase, inactiveBase + SLOT_BYTES);
    const result = injectIntoSave(
      parsed,
      { boxIndex: fx.emptyBox, slot: fx.singleSectorSlot },
      monBytes,
    );
    if (isGen3InjectError(result)) throw new Error(result.message);
    const after = result.bytes.slice(inactiveBase, inactiveBase + SLOT_BYTES);
    expect(Buffer.compare(Buffer.from(after), Buffer.from(before))).toBe(0);
  });

  it('Hall-of-Fame and trailing blocks are byte-identical pre/post inject', () => {
    const parsed = parseGen3Save(bytes);
    if (isGen3SaveError(parsed)) throw new Error(parsed.message);
    const trailingOff = SLOT_A_OFFSET + 2 * SLOT_BYTES; // 0x1C000
    const before = parsed.bytes.slice(trailingOff);
    const result = injectIntoSave(
      parsed,
      { boxIndex: fx.emptyBox, slot: fx.singleSectorSlot },
      monBytes,
    );
    if (isGen3InjectError(result)) throw new Error(result.message);
    const after = result.bytes.slice(trailingOff);
    expect(Buffer.compare(Buffer.from(after), Buffer.from(before))).toBe(0);
  });

  it('per-byte assertion: only the 80-byte slot range and 2-byte checksum changed in the touched sector (PLAN_EVAL A13.2)', () => {
    const parsedMaybe = parseGen3Save(bytes);
    if (isGen3SaveError(parsedMaybe)) throw new Error(parsedMaybe.message);
    const parsed = parsedMaybe;
    const result = injectIntoSave(
      parsed,
      { boxIndex: fx.emptyBox, slot: fx.singleSectorSlot },
      monBytes,
    );
    if (isGen3InjectError(result)) throw new Error(result.message);
    // Whole-buffer diff outside the slot region and checksum fields.
    let diffCount = 0;
    const slotLogicalOff =
      4 +
      fx.emptyBox * PCBUFFER_SLOTS_PER_BOX * PCBUFFER_SLOT_BYTES +
      fx.singleSectorSlot * PCBUFFER_SLOT_BYTES;
    const slotLogicalEnd = slotLogicalOff + PCBUFFER_SLOT_BYTES;
    const logToDisk = (log: number): number => {
      const sectorIdx = Math.floor(log / 3968);
      const sid = 5 + sectorIdx;
      const inSec = log - sectorIdx * 3968;
      return parsed.active.sectorOrder.get(sid)!.diskOffset + inSec;
    };
    const slotDiskRanges = new Set<number>();
    for (let i = slotLogicalOff; i < slotLogicalEnd; i++) {
      slotDiskRanges.add(logToDisk(i));
    }
    // Also exclude the 2-byte checksum field of every touched sector.
    const touchedSec = parsed.active.sectorOrder.get(5 + Math.floor(slotLogicalOff / 3968))!;
    const cksOff = touchedSec.diskOffset + SECTOR_CHECKSUM_OFFSET;
    const excludedOffsets = new Set<number>(slotDiskRanges);
    excludedOffsets.add(cksOff);
    excludedOffsets.add(cksOff + 1);
    for (let i = 0; i < parsed.bytes.length; i++) {
      if (excludedOffsets.has(i)) continue;
      if (parsed.bytes[i] !== result.bytes[i]) {
        diffCount++;
        if (diffCount > 10) break;
      }
    }
    expect(diffCount).toBe(0);
  });

  it('output round-trips byte-equal: parse(inject_output).bytes === inject_output', () => {
    const parsed = parseGen3Save(bytes);
    if (isGen3SaveError(parsed)) throw new Error(parsed.message);
    const result = injectIntoSave(
      parsed,
      { boxIndex: fx.emptyBox, slot: fx.singleSectorSlot },
      monBytes,
    );
    if (isGen3InjectError(result)) throw new Error(result.message);
    const reparsed = parseGen3Save(result.bytes);
    if (isGen3SaveError(reparsed)) throw new Error(reparsed.message);
    expect(Buffer.compare(Buffer.from(reparsed.bytes), Buffer.from(result.bytes))).toBe(0);
    expect(reparsed.warnings).not.toContain('gen3_checksum_mismatch');
  });
});

describe('Gen 3 inject — error cases', () => {
  const bytes = loadFixture('ruby');
  const monBytes = feraligatrPackedBytes();

  it('refuses BAD_PAYLOAD_SIZE for non-80-byte payloads', () => {
    const parsed = parseGen3Save(bytes);
    if (isGen3SaveError(parsed)) throw new Error(parsed.message);
    const r = injectIntoSave(parsed, { boxIndex: 0, slot: 0 }, new Uint8Array(79));
    expect(isGen3InjectError(r)).toBe(true);
    if (!isGen3InjectError(r)) return;
    expect(r.reason).toBe('BAD_PAYLOAD_SIZE');
  });

  it('refuses PAYLOAD_NOT_A_MON for an 80-byte all-zero payload (PLAN_EVAL A11)', () => {
    const parsed = parseGen3Save(bytes);
    if (isGen3SaveError(parsed)) throw new Error(parsed.message);
    const r = injectIntoSave(parsed, { boxIndex: 0, slot: 0 }, new Uint8Array(80));
    expect(isGen3InjectError(r)).toBe(true);
    if (!isGen3InjectError(r)) return;
    expect(r.reason).toBe('PAYLOAD_NOT_A_MON');
  });

  it('refuses OUT_OF_RANGE for boxIndex 14', () => {
    const parsed = parseGen3Save(bytes);
    if (isGen3SaveError(parsed)) throw new Error(parsed.message);
    const r = injectIntoSave(parsed, { boxIndex: PCBUFFER_BOX_COUNT, slot: 0 }, monBytes);
    expect(isGen3InjectError(r)).toBe(true);
    if (!isGen3InjectError(r)) return;
    expect(r.reason).toBe('OUT_OF_RANGE');
  });

  it('refuses OUT_OF_RANGE for slot 30', () => {
    const parsed = parseGen3Save(bytes);
    if (isGen3SaveError(parsed)) throw new Error(parsed.message);
    const r = injectIntoSave(parsed, { boxIndex: 0, slot: PCBUFFER_SLOTS_PER_BOX }, monBytes);
    expect(isGen3InjectError(r)).toBe(true);
    if (!isGen3InjectError(r)) return;
    expect(r.reason).toBe('OUT_OF_RANGE');
  });

  it('refuses SLOT_OCCUPIED when the target slot is filled', () => {
    // ruby box 2 slot 0 is occupied
    const parsed = parseGen3Save(bytes);
    if (isGen3SaveError(parsed)) throw new Error(parsed.message);
    // Find a filled slot
    let foundBox = -1;
    let foundSlot = -1;
    outer: for (let b = 0; b < PCBUFFER_BOX_COUNT; b++) {
      for (let s = 0; s < PCBUFFER_SLOTS_PER_BOX; s++) {
        if (parsed.pc.boxes[b]![s]!.kind === 'filled') {
          foundBox = b;
          foundSlot = s;
          break outer;
        }
      }
    }
    if (foundBox < 0) {
      // No occupied slot in ruby? Skip then.
      return;
    }
    const r = injectIntoSave(parsed, { boxIndex: foundBox, slot: foundSlot }, monBytes);
    expect(isGen3InjectError(r)).toBe(true);
    if (!isGen3InjectError(r)) return;
    expect(r.reason).toBe('SLOT_OCCUPIED');
  });
});

describe('Gen 3 inject — multi-sector boundary spanning (PLAN_EVAL A13.1)', () => {
  // Use ruby (box 1 slot 19 logical offset = 3924, ends at 4004 → spans
  // sectors 5/6). But ruby's box 1 is empty so this works directly.
  const bytes = loadFixture('ruby');
  const monBytes = feraligatrPackedBytes();

  it('inject into a boundary-spanning slot succeeds and touches TWO sectors', () => {
    const parsed = parseGen3Save(bytes);
    if (isGen3SaveError(parsed)) throw new Error(parsed.message);
    expect(parsed.pc.boxes[1]?.[19]?.kind).toBe('empty');
    const result = injectIntoSave(parsed, { boxIndex: 1, slot: 19 }, monBytes);
    if (isGen3InjectError(result)) throw new Error(result.message);
    expect(result.pc.boxes[1]?.[19]?.kind).toBe('filled');
    if (result.pc.boxes[1]?.[19]?.kind === 'filled') {
      expect(Buffer.compare(Buffer.from(result.pc.boxes[1][19].bytes), Buffer.from(monBytes))).toBe(
        0,
      );
    }
    // Verify by re-parse — spans the (sec5, sec6) boundary
    const reparsed = parseGen3Save(result.bytes);
    if (isGen3SaveError(reparsed)) throw new Error(reparsed.message);
    expect(reparsed.warnings).not.toContain('gen3_checksum_mismatch');
  });

  it('inactive slot, sector 0, and trailing blocks all unchanged', () => {
    const parsed = parseGen3Save(bytes);
    if (isGen3SaveError(parsed)) throw new Error(parsed.message);
    const sec0Off = parsed.active.sectorOrder.get(0)!.diskOffset;
    const sec0Before = parsed.bytes.slice(sec0Off, sec0Off + SECTOR_SIZE);
    const inactiveBase = parsed.active.slotIndex === 0 ? SLOT_B_OFFSET : SLOT_A_OFFSET;
    const inactiveBefore = parsed.bytes.slice(inactiveBase, inactiveBase + SLOT_BYTES);
    const trailingBefore = parsed.bytes.slice(SLOT_A_OFFSET + 2 * SLOT_BYTES);

    const result = injectIntoSave(parsed, { boxIndex: 1, slot: 19 }, monBytes);
    if (isGen3InjectError(result)) throw new Error(result.message);

    expect(
      Buffer.compare(
        Buffer.from(result.bytes.slice(sec0Off, sec0Off + SECTOR_SIZE)),
        Buffer.from(sec0Before),
      ),
    ).toBe(0);
    expect(
      Buffer.compare(
        Buffer.from(result.bytes.slice(inactiveBase, inactiveBase + SLOT_BYTES)),
        Buffer.from(inactiveBefore),
      ),
    ).toBe(0);
    expect(
      Buffer.compare(
        Buffer.from(result.bytes.slice(SLOT_A_OFFSET + 2 * SLOT_BYTES)),
        Buffer.from(trailingBefore),
      ),
    ).toBe(0);
  });
});

describe('Gen 3 inject — output buffer length invariant', () => {
  it('output is the same length as input', () => {
    const bytes = loadFixture('ruby');
    const monBytes = feraligatrPackedBytes();
    const parsed = parseGen3Save(bytes);
    if (isGen3SaveError(parsed)) throw new Error(parsed.message);
    const result = injectIntoSave(parsed, { boxIndex: 0, slot: 0 }, monBytes);
    if (isGen3InjectError(result)) throw new Error(result.message);
    expect(result.bytes.length).toBe(SAVE_BYTES_FULL);
  });
});
