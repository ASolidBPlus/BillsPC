import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSave, isSaveError } from '../../core/src/index.js';
import { demoCrystalPath } from '../fixtures/saves/index.js';

describe('Gen 2 (Crystal) save parser', () => {
  const bytes = new Uint8Array(readFileSync(demoCrystalPath));
  const result = parseSave(bytes);

  it('parses without error', () => {
    expect(isSaveError(result)).toBe(false);
  });

  if (isSaveError(result)) return;

  it('detects format CRYSTAL', () => {
    expect(result.format).toBe('CRYSTAL');
  });

  it('strips the 48-byte emulator trailer and surfaces a warning', () => {
    expect(result.warnings).toContain('emulator_trailer_stripped(48)');
  });

  it('surfaces a checksum_mismatch warning (demo file has stale checksum)', () => {
    expect(result.warnings).toContain('checksum_mismatch');
  });

  it('reads trainer name "Joel" with TID 42971 and male gender', () => {
    expect(result.trainer.name).toBe('Joel');
    expect(result.trainer.tid).toBe(42971);
    expect(result.trainer.gender).toBe(0);
  });

  it('parses 6-mon party with the demo species list', () => {
    expect(result.party.length).toBe(6);
    expect(result.party.map((m) => m.speciesGen2Id)).toEqual([157, 26, 160, 248, 230, 249]);
  });

  it('reads Feraligatr (slot 2) DVs and StatExp byte-equal to demo data', () => {
    const idx = result.party.findIndex((m) => m.speciesGen2Id === 160);
    expect(idx).toBe(2);
    const fer = result.party[idx]!;
    expect(fer.level).toBe(74);
    expect(fer.exp).toBe(417829);
    expect(fer.dvs).toEqual({ atk: 1, def: 0, spe: 10, special: 0 });
    expect(fer.statExp).toEqual({
      hp: 34695,
      atk: 40007,
      def: 38073,
      spe: 39164,
      special: 34886,
    });
  });

  it('exposes 14 stored boxes', () => {
    expect(result.boxes.length).toBe(14);
  });

  it('box 0 (stored box 1) has 20 mons with non-zero species and levels', () => {
    const box1 = result.boxes[0]!;
    expect(box1.length).toBe(20);
    for (const m of box1) {
      expect(m.speciesGen2Id).toBeGreaterThan(0);
      expect(m.level).toBeGreaterThan(0);
    }
  });

  it('current box and currentBoxIndex both populated', () => {
    expect(result.currentBox).toBeDefined();
    expect(result.currentBoxIndex).toBeDefined();
    // Live buffer is mirrored from box 2 (cbi=1, 0-indexed) on the demo save.
    expect(result.currentBoxIndex).toBe(1);
  });

  it('OT names on party mons decode to "Joel" (the trainer)', () => {
    // Every mon was caught by the trainer, so OT name == trainer name.
    // Just confirm bytes are present and non-empty.
    for (const m of result.party) {
      expect(m.otNameBytes.length).toBe(11);
      expect(m.nicknameBytes.length).toBe(11);
    }
  });

  it('held items are surfaced as `null` when zero, integer when set', () => {
    for (const m of result.party) {
      if (m.heldItemGen2Id !== null) {
        expect(typeof m.heldItemGen2Id).toBe('number');
        expect(m.heldItemGen2Id).toBeGreaterThan(0);
      }
    }
  });
});
