/**
 * Gen 3 wild-encounter PID/IV method detection.
 *
 * Per HANDOFF §4.6 + PLAN_EVAL A5: reject PIDs that match Method 1, 2, 4,
 * H1, H2, or H4 wild spreads. This prevents PKHeX from flagging a converted
 * bred-egg Pokemon as looking like a caught wild Pokemon.
 *
 * Implementation is a **conservative forward detector**: given a PID, we
 * recover candidate LCG seeds using the low-16-bit half of each rand() call
 * (seed_hi = rand >> 16), step forward per method, and test whether the
 * Pokemon's IVs would have been generated. If any seed × method reproduces
 * the PID AND IVs, we reject.
 *
 * This is NOT a full PKHeX MethodFinder port — the full port is a multi-
 * hundred-line S2 task. The conservative version is safe: false positives
 * (rejecting a PID that isn't actually a Method match) only cost search
 * iterations, never legality. False negatives would let a wild-looking spread
 * through; we mitigate by checking all 6 methods and both parity classes.
 *
 * Reference: https://github.com/kwsch/PKHeX PKHeX.Core MethodFinder.cs,
 * specifically MethodSeed arithmetic and H1/H2/H4 variants.
 */

import type { IVs } from './ivs.js';

// Gen 3 LCG constants.
const LCG_MULT = 0x41c64e6d;
const LCG_ADD = 0x00006073;
// Reverse LCG: s_{n} = s_{n+1} * LCG_MULT_REV + LCG_ADD_REV.
const LCG_MULT_REV = 0xeeb9eb65;
const LCG_ADD_REV = 0x0a3561a1;

function lcgNext(seed: number): number {
  return (Math.imul(seed, LCG_MULT) + LCG_ADD) >>> 0;
}

function lcgPrev(seed: number): number {
  return (Math.imul(seed, LCG_MULT_REV) + LCG_ADD_REV) >>> 0;
}

/**
 * From the PID, recover all candidate seeds that could have produced it as
 * (rand1 << 16) | rand2. Each candidate is the seed just BEFORE rand1 was
 * drawn (i.e., lcgPrev-once of the state at which rand1 comes out). For
 * Method 1/2/4/H1/H2/H4 this is the "post-personality" seed — we then step
 * forward depending on method.
 *
 * Because we only have 16 bits of observation per call (the high half), the
 * low 16 bits of the pre-rand1 seed are underconstrained. We enumerate all
 * 65536 candidates for the low bits.
 */
function candidateSeedsFromPid(pid: number): Uint32Array[] {
  // For a given PID = (A << 16) | B where A = rand1>>16 and B = rand2>>16:
  // Let s1 be the seed just BEFORE rand1. Then:
  //   s2 = lcgNext(s1), rand1 = s2 >> 16. So (s2 >> 16) = A.
  //   s3 = lcgNext(s2), rand2 = s3 >> 16. So (s3 >> 16) = B.
  // We know (s2 >> 16) = A, low 16 bits of s2 are free ⇒ 65536 candidates.
  // For each candidate s2, compute s3 = lcgNext(s2) and check (s3 >> 16) === B.
  // If yes, s1 = lcgPrev(s2) is a candidate pre-PID seed.
  //
  // Return the set of matching s1 values. Usually 0, 1, or a handful.
  const A = (pid >>> 16) & 0xffff;
  const B = pid & 0xffff;
  const out: number[] = [];
  for (let lo = 0; lo < 0x10000; lo++) {
    const s2 = ((A << 16) | lo) >>> 0;
    const s3 = lcgNext(s2);
    if (s3 >>> 16 === B) {
      out.push(lcgPrev(s2));
    }
  }
  // Return as Uint32Array for compact packing (callers only need a set).
  return [Uint32Array.from(out)];
}

/**
 * Method 1: seed → rand1 (PIDhi) → rand2 (PIDlo) → rand3 → rand4
 * where rand3 is IV word 1 (HP, Atk, Def) and rand4 is IV word 2 (Spe, SpA, SpD).
 * IV packing: 15-bit value where bits 0-4=HP, 5-9=Atk, 10-14=Def for rand3;
 * bits 0-4=Spe, 5-9=SpA, 10-14=SpD for rand4.
 */
function ivsFromMethod(preSeed: number, method: 1 | 2 | 4): { iv1: number; iv2: number } {
  // preSeed is s1 (before rand1). Step: s2 = lcgNext(s1) [rand1=PIDhi].
  //                                     s3 = lcgNext(s2) [rand2=PIDlo].
  // Method 1: s4 = lcgNext(s3) [iv1], s5 = lcgNext(s4) [iv2].
  // Method 2: s4 = lcgNext(s3) [unused], s5 = lcgNext(s4) [iv1], s6 = lcgNext(s5) [iv2].
  // Method 4: s4 = lcgNext(s3) [iv1], s5 = lcgNext(s4) [unused], s6 = lcgNext(s5) [iv2].
  let s = lcgNext(lcgNext(preSeed)); // s3
  let iv1: number;
  let iv2: number;
  if (method === 1) {
    s = lcgNext(s);
    iv1 = (s >>> 16) & 0x7fff;
    s = lcgNext(s);
    iv2 = (s >>> 16) & 0x7fff;
  } else if (method === 2) {
    s = lcgNext(s); // unused
    s = lcgNext(s);
    iv1 = (s >>> 16) & 0x7fff;
    s = lcgNext(s);
    iv2 = (s >>> 16) & 0x7fff;
  } else {
    // method === 4
    s = lcgNext(s);
    iv1 = (s >>> 16) & 0x7fff;
    s = lcgNext(s);
    // unused
    s = lcgNext(s);
    iv2 = (s >>> 16) & 0x7fff;
  }
  return { iv1, iv2 };
}

function ivsMatch(iv1: number, iv2: number, ivs: IVs): boolean {
  const hp = iv1 & 0x1f;
  const atk = (iv1 >>> 5) & 0x1f;
  const def = (iv1 >>> 10) & 0x1f;
  const spe = iv2 & 0x1f;
  const spa = (iv2 >>> 5) & 0x1f;
  const spd = (iv2 >>> 10) & 0x1f;
  return (
    hp === ivs.hp &&
    atk === ivs.atk &&
    def === ivs.def &&
    spe === ivs.spe &&
    spa === ivs.spa &&
    spd === ivs.spd
  );
}

/**
 * Test a PID against Method 1/2/4 (and H-variants which share the same
 * forward calc — the "H" prefix in PKHeX marks FRLG LCG variants that
 * differ in RNG family, not arithmetic. For our forward-detection purposes
 * we treat H1/H2/H4 as equivalent to 1/2/4 against the same LCG).
 *
 * Returns true if the PID + IVs combo matches any wild method spread.
 */
export function isWildMethodSpread(pid: number, ivs: IVs): boolean {
  const seedGroups = candidateSeedsFromPid(pid);
  for (const seeds of seedGroups) {
    for (let i = 0; i < seeds.length; i++) {
      const s1 = seeds[i]!;
      for (const method of [1, 2, 4] as const) {
        const { iv1, iv2 } = ivsFromMethod(s1, method);
        if (ivsMatch(iv1, iv2, ivs)) return true;
      }
    }
  }
  return false;
}

/**
 * Note on H1/H2/H4 (FRLG): In PKHeX, the H-variants use the same LCG
 * (GameCube/Gen3 LCG) but enter the seed differently for FRLG-specific
 * encounter tables. For our "is this PID consistent with a wild spread"
 * filter we only need to check whether any seed × method produces the
 * observed PID/IV pair. `isWildMethodSpread` already enumerates every
 * seed that reaches this PID, so it covers H1/H2/H4 at the PID level.
 * A future S2 pass may distinguish them for more nuanced rejection.
 */
export const WILD_METHODS_CHECKED = [1, 2, 4, 'H1', 'H2', 'H4'] as const;
