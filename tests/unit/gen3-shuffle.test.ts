import { describe, expect, it } from 'vitest';
import {
  INVERSE,
  PERMUTATION,
  pidPermIndex,
  shuffleSubstructures,
  unshuffleSubstructures,
} from '../../core/src/pack/gen3Shuffle.js';

const TAGS = ['G', 'A', 'E', 'M'] as const;

function distinctSubs(): { g: Uint8Array; a: Uint8Array; e: Uint8Array; m: Uint8Array } {
  const fill = (b: number) => {
    const buf = new Uint8Array(12);
    for (let i = 0; i < 12; i++) buf[i] = b;
    return buf;
  };
  return { g: fill(0xa1), a: fill(0xb2), e: fill(0xc3), m: fill(0xd4) };
}

describe('gen3Shuffle', () => {
  it('PERMUTATION has 24 rows; each row is a permutation of {G,A,E,M}', () => {
    expect(PERMUTATION).toHaveLength(24);
    for (const row of PERMUTATION) {
      expect([...row].sort()).toEqual([...TAGS].sort());
    }
  });

  it('PERMUTATION rows are pairwise distinct (24 unique permutations)', () => {
    const seen = new Set<string>();
    for (const row of PERMUTATION) seen.add(row.join(''));
    expect(seen.size).toBe(24);
  });

  it('INVERSE inverts PERMUTATION for every row', () => {
    for (let r = 0; r < 24; r++) {
      const perm = PERMUTATION[r]!;
      const inv = INVERSE[r]!;
      // perm[slot] -> tag; inv[tagIdx] -> slot. Round-trip:
      const tagIdx: Record<string, number> = { G: 0, A: 1, E: 2, M: 3 };
      for (let slot = 0; slot < 4; slot++) {
        const tag = perm[slot]!;
        expect(inv[tagIdx[tag]!]).toBe(slot);
      }
    }
  });

  it('pidPermIndex handles signed-int hazard for high bit', () => {
    // PID 0x80000001 → as u32 = 2147483649, %24 = 9
    expect(pidPermIndex(0x80000001)).toBe(2147483649 % 24);
    expect(pidPermIndex(0)).toBe(0);
    expect(pidPermIndex(23)).toBe(23);
    expect(pidPermIndex(24)).toBe(0);
    expect(pidPermIndex(25)).toBe(1);
  });

  it('shuffle/unshuffle round-trips for all 24 PID%24 values', () => {
    const { g, a, e, m } = distinctSubs();
    for (let r = 0; r < 24; r++) {
      const wire = shuffleSubstructures(g, a, e, m, r);
      expect(wire.length).toBe(48);
      const [g2, a2, e2, m2] = unshuffleSubstructures(wire, r);
      expect(g2).toEqual(g);
      expect(a2).toEqual(a);
      expect(e2).toEqual(e);
      expect(m2).toEqual(m);
    }
  });

  it('each of the 4 wire slots independently verified for all 24 rows (PLAN_EVAL A7)', () => {
    // Use distinguishable per-substructure marker bytes: G=0x01, A=0x02,
    // E=0x03, M=0x04 in every byte of each substructure.
    const make = (b: number) => {
      const buf = new Uint8Array(12);
      buf.fill(b);
      return buf;
    };
    const subs = { G: make(0x01), A: make(0x02), E: make(0x03), M: make(0x04) };
    for (let r = 0; r < 24; r++) {
      const wire = shuffleSubstructures(subs.G, subs.A, subs.E, subs.M, r);
      const expected = PERMUTATION[r]!;
      for (let slot = 0; slot < 4; slot++) {
        const expectedByte = subs[expected[slot]!]![0]!;
        // every byte in the slot equals the marker
        for (let b = 0; b < 12; b++) {
          expect(wire[slot * 12 + b]).toBe(expectedByte);
        }
      }
    }
  });

  it('spot-check vs PLAN_EVAL table: row 0 is GAEM, row 23 is MEAG', () => {
    expect(PERMUTATION[0]).toEqual(['G', 'A', 'E', 'M']);
    expect(PERMUTATION[23]).toEqual(['M', 'E', 'A', 'G']);
    expect(PERMUTATION[6]).toEqual(['A', 'G', 'E', 'M']);
    expect(PERMUTATION[12]).toEqual(['E', 'G', 'A', 'M']);
    expect(PERMUTATION[18]).toEqual(['M', 'G', 'A', 'E']);
  });

  it('shuffleSubstructures throws on wrong-size substructure', () => {
    const ok = new Uint8Array(12);
    expect(() => shuffleSubstructures(new Uint8Array(11), ok, ok, ok, 0)).toThrow(RangeError);
  });

  it('unshuffleSubstructures throws on wrong-size wire block', () => {
    expect(() => unshuffleSubstructures(new Uint8Array(47), 0)).toThrow(RangeError);
  });
});
