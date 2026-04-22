/**
 * S6a — Round-trip identity test.
 *
 * For each fixture (ruby/emerald/firered): parse the save, then prove
 * that `parsed.bytes` is byte-equal to the original input — no inject,
 * no mutation, just identity.
 *
 * This is the strongest invariant in S6a (per orchestrator brief): if
 * even one byte diverges on a clean parse, every downstream test is
 * meaningless because we'd be writing back a different file than we
 * read. The test also asserts per-sector checksum agreement (per
 * PLAN_EVAL A3) so a body-size regression on sector 0 surfaces clearly.
 *
 * Per PLAN_EVAL A4: explicit assertions that the inactive slot, the
 * Hall-of-Fame block, and the e-Reader/Mystery-Gift block are all
 * byte-identical pre/post parse-and-reserialise.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGen3Save, isGen3SaveError } from '../parseSave.js';
import {
  SAVE_BYTES_FULL,
  SECTOR_CHECKSUM_OFFSET,
  SECTORS_PER_SLOT,
  SECTOR_SIZE,
  SLOT_A_OFFSET,
  SLOT_B_OFFSET,
  SLOT_BYTES,
} from '../format.js';
import { gen3SectorChecksum } from '../checksum.js';
import { readU16LE } from '../../../pack/leBytes.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, '../../../../test-fixtures/gen3');

const FIXTURE_NAMES = ['ruby', 'emerald', 'firered'] as const;

function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(resolve(FIXTURES, `${name}.sav`)));
}

describe.each(FIXTURE_NAMES)('Gen 3 round-trip identity: %s.sav', (name) => {
  const bytes = loadFixture(name);

  it('input is the expected 128 KB length', () => {
    expect(bytes.length).toBe(SAVE_BYTES_FULL);
  });

  it('parses without error', () => {
    const parsed = parseGen3Save(bytes);
    expect(isGen3SaveError(parsed)).toBe(false);
  });

  it('parsed.bytes is byte-equal to the input (no warnings about checksum)', () => {
    const parsed = parseGen3Save(bytes);
    if (isGen3SaveError(parsed)) throw new Error(parsed.message);
    expect(parsed.bytes.length).toBe(bytes.length);
    expect(Buffer.compare(Buffer.from(parsed.bytes), Buffer.from(bytes))).toBe(0);
    // Real fixtures should have valid checksums.
    expect(parsed.warnings).not.toContain('gen3_checksum_mismatch');
  });

  it("every active-slot sector's stored checksum equals recomputation (PLAN_EVAL A3)", () => {
    const parsed = parseGen3Save(bytes);
    if (isGen3SaveError(parsed)) throw new Error(parsed.message);
    for (const entry of parsed.active.sectorOrder.values()) {
      const computed = gen3SectorChecksum(parsed.bytes, entry.diskOffset, entry.semanticId);
      const stored = readU16LE(parsed.bytes, entry.diskOffset + SECTOR_CHECKSUM_OFFSET);
      expect(computed).toBe(stored);
    }
  });

  it('the inactive slot is byte-identical pre/post parse (PLAN_EVAL A4)', () => {
    const parsed = parseGen3Save(bytes);
    if (isGen3SaveError(parsed)) throw new Error(parsed.message);
    const inactiveBase = parsed.active.slotIndex === 0 ? SLOT_B_OFFSET : SLOT_A_OFFSET;
    const orig = bytes.slice(inactiveBase, inactiveBase + SLOT_BYTES);
    const out = parsed.bytes.slice(inactiveBase, inactiveBase + SLOT_BYTES);
    expect(Buffer.compare(Buffer.from(out), Buffer.from(orig))).toBe(0);
  });

  it('Hall-of-Fame and e-Reader blocks are byte-identical pre/post parse (PLAN_EVAL A4)', () => {
    const parsed = parseGen3Save(bytes);
    if (isGen3SaveError(parsed)) throw new Error(parsed.message);
    const trailingOff = SLOT_A_OFFSET + 2 * SLOT_BYTES; // 0x1C000
    expect(
      Buffer.compare(
        Buffer.from(parsed.bytes.slice(trailingOff)),
        Buffer.from(bytes.slice(trailingOff)),
      ),
    ).toBe(0);
  });

  it('walks all 14 sectors; sector_id rotation is internally consistent', () => {
    const parsed = parseGen3Save(bytes);
    if (isGen3SaveError(parsed)) throw new Error(parsed.message);
    const ids = Array.from(parsed.active.sectorOrder.keys()).sort((a, b) => a - b);
    expect(ids).toEqual(Array.from({ length: SECTORS_PER_SLOT }, (_, i) => i));
    expect(parsed.active.sectorOrder.size).toBe(SECTORS_PER_SLOT);
    // Disk-position consistency: the diskOffset of each sector must align
    // to the slot base + multiple of SECTOR_SIZE.
    for (const entry of parsed.active.sectorOrder.values()) {
      const localOff = entry.diskOffset - parsed.active.slotOffset;
      expect(localOff % SECTOR_SIZE).toBe(0);
      expect(localOff).toBeGreaterThanOrEqual(0);
      expect(localOff).toBeLessThan(SLOT_BYTES);
    }
  });
});
