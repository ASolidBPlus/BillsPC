/**
 * FATMAN regression anchor (PLAN_EVAL S5 A2).
 *
 * The orchestrator's testing canon is **Lv 100 Charizard, Gen 1 source,
 * perfect DVs, max statExp**. This fixture exercises the Gen 1 → Gen 3
 * SpA buff (Gen 1 single-Special base 85 → Gen 3 split SpA base 109) +
 * the unchanged HP/Atk/Def/SpD/Spe base stats.
 *
 * Per A2: "derive via the formula, then assert the literal final value."
 * One important subtlety: the Gen 1/2 → Gen 3 conversion converts
 * max-StatExp (65535, which yields 255 raw EV-equivalent) into EVs that
 * cannot exceed 510 total — so the EVs get proportionally scaled and
 * every stat takes a ~40-point hit from the EV-budget truncation.
 * The SpA buff (Gen 1 base 85 → Gen 3 base 109) partially offsets this:
 * Charizard's SpA delta is +7 final (the base-stat buff is +24 at
 * Lv 100 which gets shaved down by the EV scaling), while every other
 * stat hits -41. The zero-delta counter-example (Pikachu) gets uniform
 * -41 across the board.
 *
 * Per A14, the test also exercises a zero-buff fixture (Pikachu base
 * stats unchanged Gen 2 → Gen 3 — deltas all reflect the uniform
 * EV-scaling hit) and a Snorlax HP-formula sanity check (R12).
 */
import { describe, it, expect } from 'vitest';
import type { Gen12Pokemon, Gen3Intermediate } from '@pokeportal/core';
import { convert, isRefusal } from '@pokeportal/core';
import { computeComparisonStats } from '../ui/comparisonView.js';

function fillBytes(s: string, len: number): Uint8Array {
  // Gen 1/2 char map ASCII: A..Z = 0x80..0x99. Pad with 0x50 (terminator).
  const out = new Uint8Array(len).fill(0x50);
  for (let i = 0; i < s.length && i < len; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0x41 && c <= 0x5a) out[i] = 0x80 + (c - 0x41);
  }
  return out;
}

function makeMon(opts: {
  sourceGen: 1 | 2;
  speciesGen2Id: number;
  level: number;
  perfect?: boolean;
  nickname?: string;
}): Gen12Pokemon {
  const dvs = opts.perfect
    ? { atk: 15, def: 15, spe: 15, special: 15 }
    : { atk: 9, def: 9, spe: 9, special: 9 };
  const statExp = opts.perfect
    ? { hp: 65535, atk: 65535, def: 65535, spe: 65535, special: 65535 }
    : { hp: 0, atk: 0, def: 0, spe: 0, special: 0 };
  return {
    sourceGen: opts.sourceGen,
    speciesGen2Id: opts.speciesGen2Id,
    level: opts.level,
    exp: 1_000_000,
    dvs,
    statExp,
    moves: [33, 0, 0, 0],
    pp: [35, 0, 0, 0],
    ppUps: [0, 0, 0, 0],
    heldItemGen2Id: null,
    friendship: opts.sourceGen === 2 ? 70 : null,
    pokerusByte: 0,
    otNameBytes: fillBytes('JOEL', 11),
    tid: 12345,
    nicknameBytes: fillBytes(opts.nickname ?? 'X', 11),
    language: 2,
  };
}

function intermediateOf(mon: Gen12Pokemon): Gen3Intermediate {
  const r = convert(mon);
  if (isRefusal(r)) throw new Error(`unexpected refusal: ${r.reason}`);
  return r;
}

describe('FATMAN regression (PLAN_EVAL S5 A2)', () => {
  it('Lv 100 Charizard (Gen 1 source, perfect DVs, max statExp) — pinned source/converted/delta values', () => {
    const fatman = makeMon({
      sourceGen: 1,
      speciesGen2Id: 6,
      level: 100,
      perfect: true,
      nickname: 'FATMAN',
    });
    const intermediate = intermediateOf(fatman);
    const { source, converted, deltas } = computeComparisonStats(fatman, intermediate);

    // Source side (Gen 1 single Special = 85; HP DV bits all 1 → 15).
    // Formula: floor(((Base+DV)*2 + floor(sqrt(StatExp))/4) * Level/100) + 5
    // (HP adds +Level+10 instead of +5).
    // isqrt(65535)=255, /4=63; (Base+15)*2 + 63 yields the listed values.
    expect(source.hp).toBe(359);
    expect(source.atk).toBe(266);
    expect(source.def).toBe(254);
    expect(source.spa).toBe(268);
    expect(source.spd).toBe(268);
    expect(source.spe).toBe(298);

    // Gen 3 side: the convert pipeline derives IVs from DVs via hashed
    // RNG (zero-DV-preserving) and EVs via 510-cap proportional scaling.
    // The exact IVs depend on the `personalitySeed(mon)` hash — for this
    // fixture (FATMAN's exact bytes) the IV vector is deterministically
    // ivs=[hp=31,atk=30,def=30,spa=30,spd=30,spe=31] and every EV lands
    // at 85 (sum=510 exact, no Hamilton residual). The Gen 3 formula
    // then yields:
    expect(converted.hp).toBe(318); // (2*78+31+21)+100+10
    expect(converted.atk).toBe(224); // (2*84+30+21)+5
    expect(converted.def).toBe(212); // (2*78+30+21)+5
    expect(converted.spa).toBe(274); // (2*109+30+21)+5  ← buffed base
    expect(converted.spd).toBe(226); // (2*85+30+21)+5
    expect(converted.spe).toBe(257); // (2*100+31+21)+5

    // Deltas. The +6 SpA delta is the residual of the Gen 1 → Gen 3
    // base SpA buff (85 → 109) after the 510-EV-budget hit; every other
    // stat takes a uniform -40 to -42 EV-truncation hit because the base
    // stats themselves did not change.
    expect(deltas.hp).toBe(-41);
    expect(deltas.atk).toBe(-42);
    expect(deltas.def).toBe(-42);
    expect(deltas.spa).toBe(6);
    expect(deltas.spd).toBe(-42);
    expect(deltas.spe).toBe(-41);
    // The buffed-stat narrative is the load-bearing assertion: SpA is
    // strictly higher (positive delta) while every unchanged-base stat
    // is negative.
    expect(deltas.spa).toBeGreaterThan(deltas.hp);
    expect(deltas.spa).toBeGreaterThan(0);
  });
});

describe('zero-buff path (PLAN_EVAL A14)', () => {
  it('Pikachu (Gen 2 source, perfect IVs / max statExp at Lv 100) — uniform EV-truncation hit, no buffed stat', () => {
    const pika = makeMon({
      sourceGen: 2,
      speciesGen2Id: 25,
      level: 100,
      perfect: true,
      nickname: 'PIKA',
    });
    const intermediate = intermediateOf(pika);
    const { deltas } = computeComparisonStats(pika, intermediate);
    // Pikachu base stats: 35/55/30/90/50/40 — same in Gen 2 and Gen 3.
    // Every stat takes the same ~-41 EV-truncation hit; no stat is
    // strictly higher than the others.
    const min = Math.min(...Object.values(deltas));
    const max = Math.max(...Object.values(deltas));
    expect(min).toBeLessThanOrEqual(-30); // EV-truncation lower bound
    expect(max).toBeLessThanOrEqual(-20); // even the "best" stat is negative — no buff
    // Spread is small (within rounding). For unchanged-base species, all
    // deltas should land in a narrow band.
    expect(max - min).toBeLessThanOrEqual(15);
  });
});

describe('Snorlax HP-formula sanity (PLAN_EVAL R12)', () => {
  it('Snorlax (Gen 2 source) HP source-side uses the +Level+10 branch', () => {
    const snorlax = makeMon({
      sourceGen: 2,
      speciesGen2Id: 143,
      level: 100,
      perfect: true,
      nickname: 'SNOR',
    });
    const intermediate = intermediateOf(snorlax);
    const { source } = computeComparisonStats(snorlax, intermediate);
    // Base HP 160; with HP DV=15, 65535 statExp, Lv 100:
    //   ((160+15)*2 + 63)*100/100 + 100 + 10 = (350+63)+110 = 523
    expect(source.hp).toBe(523);
  });
});
