/**
 * S6a — Sector rotation invariant.
 *
 * The 14 sectors of a slot are stored on disk in a rotated order — but
 * the rotation amount is NOT a deterministic function of save_index
 * across all three games. Empirically:
 *   - ruby.sav (saveIdx 153): rotation IS non-trivial (sector 0 at disk
 *     pos 13).
 *   - firered.sav (saveIdx 71): rotation IS non-trivial (sector 0 at
 *     disk pos 1).
 *   - emerald.sav (saveIdx 1658): rotation is ZERO (sector 0 at disk
 *     pos 0) — Emerald often does not rotate, even at high save_index.
 *
 * Rather than assert a per-game formula, this test pins down the
 * *invariants*: every active slot exposes 14 distinct semantic
 * sector_ids each at a unique disk position, AND `findActiveSlot`
 * round-trips by re-deriving the same map from the same bytes.
 *
 * Per the orchestrator brief (§rotation): the round-trip identity test
 * (in `roundtrip.test.ts`) is the strongest rotation safety net — if
 * the rotation logic is wrong on read or write, the parsed.bytes won't
 * byte-equal the input.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGen3Save, isGen3SaveError } from '../parseSave.js';
import { findActiveSlot } from '../sectors.js';
import { SECTOR_SIZE, SECTORS_PER_SLOT } from '../format.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, '../../../../test-fixtures/gen3');

const FIXTURE_NAMES = ['ruby', 'emerald', 'firered'] as const;

describe('Gen 3 sector rotation', () => {
  it('ruby.sav: active is slot B (saveIdx 153) and rotation is non-trivial (sector 0 at disk pos 13)', () => {
    const bytes = new Uint8Array(readFileSync(resolve(FIXTURES, 'ruby.sav')));
    const parsed = parseGen3Save(bytes);
    if (isGen3SaveError(parsed)) throw new Error(parsed.message);
    expect(parsed.active.slotIndex).toBe(1);
    expect(parsed.active.saveIndex).toBe(153);
    const sec0 = parsed.active.sectorOrder.get(0)!;
    const diskPos = (sec0.diskOffset - parsed.active.slotOffset) / SECTOR_SIZE;
    expect(diskPos).toBe(13);
  });

  it('firered.sav: active is slot B (saveIdx 71) and rotation is non-trivial (sector 0 at disk pos 1)', () => {
    const bytes = new Uint8Array(readFileSync(resolve(FIXTURES, 'firered.sav')));
    const parsed = parseGen3Save(bytes);
    if (isGen3SaveError(parsed)) throw new Error(parsed.message);
    expect(parsed.active.slotIndex).toBe(1);
    expect(parsed.active.saveIndex).toBe(71);
    const sec0 = parsed.active.sectorOrder.get(0)!;
    const diskPos = (sec0.diskOffset - parsed.active.slotOffset) / SECTOR_SIZE;
    expect(diskPos).toBe(1);
  });

  it('emerald.sav: active is slot A (saveIdx 1658) and rotation is zero (sector 0 at disk pos 0)', () => {
    const bytes = new Uint8Array(readFileSync(resolve(FIXTURES, 'emerald.sav')));
    const parsed = parseGen3Save(bytes);
    if (isGen3SaveError(parsed)) throw new Error(parsed.message);
    expect(parsed.active.slotIndex).toBe(0);
    expect(parsed.active.saveIndex).toBe(1658);
    const sec0 = parsed.active.sectorOrder.get(0)!;
    const diskPos = (sec0.diskOffset - parsed.active.slotOffset) / SECTOR_SIZE;
    expect(diskPos).toBe(0);
  });

  it.each(FIXTURE_NAMES)(
    '%s.sav: all 14 semantic sector_ids occupy 14 distinct disk positions',
    (name) => {
      const bytes = new Uint8Array(readFileSync(resolve(FIXTURES, `${name}.sav`)));
      const parsed = parseGen3Save(bytes);
      if (isGen3SaveError(parsed)) throw new Error(parsed.message);
      const positions = new Set<number>();
      for (const e of parsed.active.sectorOrder.values()) {
        positions.add((e.diskOffset - parsed.active.slotOffset) / SECTOR_SIZE);
      }
      expect(positions.size).toBe(SECTORS_PER_SLOT);
    },
  );

  it.each(FIXTURE_NAMES)(
    '%s.sav: findActiveSlot is deterministic — calling it twice produces equal maps',
    (name) => {
      const bytes = new Uint8Array(readFileSync(resolve(FIXTURES, `${name}.sav`)));
      const a = findActiveSlot(bytes);
      const b = findActiveSlot(bytes);
      expect(a.slotIndex).toBe(b.slotIndex);
      expect(a.saveIndex).toBe(b.saveIndex);
      for (let sid = 0; sid < SECTORS_PER_SLOT; sid++) {
        expect(a.sectorOrder.get(sid)!.diskOffset).toBe(b.sectorOrder.get(sid)!.diskOffset);
      }
    },
  );
});
