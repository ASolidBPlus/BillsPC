/**
 * Per PLAN_EVAL A10: pin the Feraligatr |dev|=117 regression by
 * looking up the mon by species ID (160 = Feraligatr in Gen 2 native
 * dex), NOT by slot index. Hardcoding `party[0]` would silently pass
 * on a different mon if the demo save is ever swapped.
 *
 * The 117 number is the orchestrator's hand-verified anchor for Gen 2
 * conversion correctness — losing it means the convert pipeline drifted.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseSave,
  isSaveError,
  convert,
  isRefusal,
  packBoxed,
  unpackBoxed,
  isDecodeError,
  BOXED_SIZE,
} from '../../core/src/index.js';
import { gen2Stats } from '../harness/gen2Stats.js';
import { gen3Stats } from '../harness/gen3Stats.js';
import { demoCrystalPath } from '../fixtures/saves/index.js';

const FERALIGATR_GEN2_ID = 160;
// Verified via Bulbapedia + scripts/demo-crystal hand-baseline: Feraligatr
// has Gen 2 base stats hp 85 / atk 105 / def 100 / spa 79 / spd 83 / spe 78.
const FERALIGATR_BASE = {
  hp: 85,
  atk: 105,
  def: 100,
  spa: 79,
  spd: 83,
  spe: 78,
} as const;

describe('Crystal Feraligatr |dev|=117 regression (PLAN_EVAL A10)', () => {
  const bytes = new Uint8Array(readFileSync(demoCrystalPath));
  const save = parseSave(bytes);

  it('parses the Crystal save successfully', () => {
    expect(isSaveError(save)).toBe(false);
  });
  if (isSaveError(save)) return;

  const idx = save.party.findIndex((m) => m.speciesGen2Id === FERALIGATR_GEN2_ID);
  it('finds Feraligatr in the party by species id', () => {
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThanOrEqual(5);
  });

  it('|dev| sum across the six stats == 117 after convert', () => {
    const fer = save.party[idx]!;
    const sourceStats = gen2Stats(FERALIGATR_BASE, fer.dvs, fer.statExp, fer.level);
    const result = convert(fer);
    expect(isRefusal(result)).toBe(false);
    if (isRefusal(result)) return;
    const targetStats = gen3Stats(
      FERALIGATR_BASE,
      result.ivs,
      result.evs,
      fer.level,
      result.nature,
    );
    const dev =
      Math.abs(targetStats.hp - sourceStats.hp) +
      Math.abs(targetStats.atk - sourceStats.atk) +
      Math.abs(targetStats.def - sourceStats.def) +
      Math.abs(targetStats.spa - sourceStats.spa) +
      Math.abs(targetStats.spd - sourceStats.spd) +
      Math.abs(targetStats.spe - sourceStats.spe);
    expect(dev).toBe(117);
  });

  it('round-trips Feraligatr through packBoxed → unpackBoxed cleanly', () => {
    const fer = save.party[idx]!;
    const conv = convert(fer);
    if (isRefusal(conv)) throw new Error('refused');
    const packed = packBoxed(conv);
    expect(packed.length).toBe(BOXED_SIZE);
    const unpacked = unpackBoxed(packed);
    expect(isDecodeError(unpacked)).toBe(false);
    if (isDecodeError(unpacked)) return;
    expect(unpacked.species).toBe(FERALIGATR_GEN2_ID);
    expect(unpacked.tid).toBe(conv.tid);
    expect(unpacked.sid).toBe(conv.sid);
    expect(unpacked.pid).toBe(conv.pid);
    expect(unpacked.ivs).toEqual(conv.ivs);
    expect(unpacked.evs).toEqual(conv.evs);
    expect(unpacked.moves).toEqual(conv.moves);
  });

  it('every party + box mon either converts cleanly, refuses, or throws PID-search-exhausted', () => {
    // PID search has a 1M-iteration hard cap (S1). Some Gen 2 mons whose DV
    // combination implies a shiny PID with rare nature/gender constraints
    // may exhaust it. UI counts these as "refused"; the test's job is just
    // to confirm we never see corruption (e.g., wrong byte length) for
    // mons that DO convert.
    let attempted = 0;
    let succeeded = 0;
    let refused = 0;
    let pidExhausted = 0;
    const buckets = [save.party, save.currentBox ?? [], ...save.boxes];
    for (const bucket of buckets) {
      for (const mon of bucket) {
        attempted++;
        try {
          const r = convert(mon);
          if (isRefusal(r)) {
            refused++;
            continue;
          }
          succeeded++;
          const packed = packBoxed(r);
          expect(packed.length).toBe(BOXED_SIZE);
        } catch (e) {
          if (/PID search/.test((e as Error).message)) pidExhausted++;
          else throw e;
        }
      }
    }
    expect(attempted).toBeGreaterThan(0);
    expect(succeeded + refused + pidExhausted).toBe(attempted);
    expect(succeeded).toBeGreaterThan(0);
  });
});
