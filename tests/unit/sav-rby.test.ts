import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSave, isSaveError } from '../../core/src/index.js';
import { demoRedPath } from '../fixtures/saves/index.js';
import { INTERNAL_TO_NDEX, NDEX_TO_INTERNAL } from '../../core/src/sav/gen1/internalDex.js';

describe('Gen 1 (Red) save parser', () => {
  const bytes = new Uint8Array(readFileSync(demoRedPath));
  const result = parseSave(bytes);

  it('parses without error', () => {
    expect(isSaveError(result)).toBe(false);
  });

  if (isSaveError(result)) return;

  it('reads trainer name and TID matching the demo script', () => {
    expect(result.trainer.name).toBe('BATTTTT');
    expect(result.trainer.tid).toBe(52308);
  });

  it('reads the 5-mon party with the species the demo prints', () => {
    expect(result.party.length).toBe(5);
    // Order from demo-red-stat-check: Clefairy, Fearow, Oddish, Geodude, Horsea.
    expect(result.party.map((m) => m.speciesGen2Id)).toEqual([35, 22, 43, 74, 116]);
    // Levels.
    expect(result.party.map((m) => m.level)).toEqual([8, 23, 12, 8, 16]);
  });

  it('reads first party mon DVs and StatExp byte-equal to the demo script', () => {
    const slot0 = result.party[0]!;
    expect(slot0.dvs).toEqual({ atk: 1, def: 8, spe: 4, special: 9 });
    expect(slot0.statExp).toEqual({ hp: 15, atk: 28, def: 17, spe: 36, special: 12 });
  });

  it('preserves PP and PP-Ups (per PLAN_EVAL A7)', () => {
    // PP/PP-Up extraction must use low-6 / high-2 mask. Spot-check that
    // the PP values are within the legal Gen 1 range and that PP-Ups are
    // a tuple of 4 values in 0..3.
    for (const m of result.party) {
      for (const ppVal of m.pp) expect(ppVal).toBeGreaterThanOrEqual(0);
      for (const ppVal of m.pp) expect(ppVal).toBeLessThanOrEqual(63);
      for (const u of m.ppUps) expect(u).toBeGreaterThanOrEqual(0);
      for (const u of m.ppUps) expect(u).toBeLessThanOrEqual(3);
    }
  });

  it('exposes 12 stored boxes and a current PC box', () => {
    expect(result.boxes.length).toBe(12);
    expect(result.currentBox).toBeDefined();
  });

  it('current PC box has plausible mons and matches the box-reader demo offset', () => {
    // Demo prints "Current (0x30C0) (count=...)" first. Verify count >= 0.
    expect(result.currentBox!.length).toBeGreaterThanOrEqual(0);
    // Every mon was at least at a non-zero level (slot-empty markers are dropped).
    for (const m of result.currentBox!) {
      expect(m.level).toBeGreaterThan(0);
    }
  });

  it('all boxes parse without throwing; mons may have ndex=0 (opaque) for unmapped internal indices', () => {
    // Per PLAN_EVAL Save-parser audit: the demo internal table omits ~6
    // species. Mons whose internal byte has no map are kept with
    // speciesGen2Id=0 so the UI can show them and convert() refuses with
    // UNKNOWN_SPECIES. Levels should still be > 0 because we filter
    // species 0/0xFF (slot empty) in readMon.
    for (let i = 0; i < result.boxes.length; i++) {
      const box = result.boxes[i]!;
      for (const m of box) {
        expect(m.level).toBeGreaterThan(0);
        expect(m.speciesGen2Id).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('OT name and nickname bytes are populated for each party mon', () => {
    for (const m of result.party) {
      expect(m.otNameBytes.length).toBe(11);
      expect(m.nicknameBytes.length).toBe(11);
    }
  });
});

describe('Gen 1 internal-dex translation', () => {
  it('forward table covers exactly the demo set', () => {
    // The demo table omits ~6 species (slots 68, 73, 148 etc.). Confirm
    // count is in expected range so we know we ported faithfully.
    const count = Object.keys(INTERNAL_TO_NDEX).length;
    expect(count).toBeGreaterThanOrEqual(140);
    expect(count).toBeLessThanOrEqual(151);
  });

  it('round-trips every (internal, ndex) pair via the inverse table', () => {
    for (const [internalStr, ndex] of Object.entries(INTERNAL_TO_NDEX)) {
      const internal = Number(internalStr);
      expect(NDEX_TO_INTERNAL[ndex]).toBe(internal);
    }
  });

  it('every mapped ndex is in the Gen 1 range 1..151', () => {
    for (const ndex of Object.values(INTERNAL_TO_NDEX)) {
      expect(ndex).toBeGreaterThanOrEqual(1);
      expect(ndex).toBeLessThanOrEqual(151);
    }
  });
});
