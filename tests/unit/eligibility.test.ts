import { describe, it, expect } from 'vitest';
import { checkRefused, REFUSED_SPECIES } from '../../core/src/__internal__.js';

describe('checkRefused', () => {
  it('returns null for Bulbasaur (breedable)', () => {
    expect(checkRefused(1)).toBeNull();
  });

  it('refuses Mew as LEGENDARY', () => {
    const r = checkRefused(151);
    expect(r).not.toBeNull();
    expect(r!.reason).toBe('LEGENDARY');
    expect(r!.speciesName).toBe('Mew');
    expect(r!.message).toContain('Mew');
  });

  it('refuses Pichu as UNBREEDABLE_PREVO', () => {
    const r = checkRefused(172);
    expect(r).not.toBeNull();
    expect(r!.reason).toBe('UNBREEDABLE_PREVO');
    expect(r!.speciesName).toBe('Pichu');
  });

  it('refuses Ditto as UNBREEDABLE_PREVO', () => {
    const r = checkRefused(132);
    expect(r).not.toBeNull();
    expect(r!.reason).toBe('UNBREEDABLE_PREVO');
  });

  it('refuses species 999 as UNKNOWN_SPECIES', () => {
    const r = checkRefused(999);
    expect(r).not.toBeNull();
    expect(r!.reason).toBe('UNKNOWN_SPECIES');
  });

  it('all 20 species in REFUSED_SPECIES return a refusal', () => {
    for (const id of REFUSED_SPECIES) {
      const r = checkRefused(id);
      expect(r, `species ${id} should be refused`).not.toBeNull();
    }
  });

  it('Unown (201) is NOT refused (PLAN_EVAL A4)', () => {
    expect(checkRefused(201)).toBeNull();
  });

  it('Smeargle (235) is NOT refused', () => {
    expect(checkRefused(235)).toBeNull();
  });
});

describe('REFUSED_SPECIES snapshot', () => {
  it('contains exactly the 20 expected IDs', () => {
    const expected = [
      132, 144, 145, 146, 150, 151, 172, 173, 174, 175, 236, 238, 239, 240, 243, 244, 245, 249, 250,
      251,
    ];
    const sorted = [...REFUSED_SPECIES].sort((a, b) => a - b);
    expect(sorted).toEqual(expected);
  });
});
