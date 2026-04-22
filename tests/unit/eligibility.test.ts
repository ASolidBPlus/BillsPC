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

  it('refuses Ditto as UNBREEDABLE_PREVO (Ditto x Ditto produces no egg)', () => {
    const r = checkRefused(132);
    expect(r).not.toBeNull();
    expect(r!.reason).toBe('UNBREEDABLE_PREVO');
  });

  it('refuses species 999 as UNKNOWN_SPECIES', () => {
    const r = checkRefused(999);
    expect(r).not.toBeNull();
    expect(r!.reason).toBe('UNKNOWN_SPECIES');
  });

  it('all species in REFUSED_SPECIES return a refusal', () => {
    for (const id of REFUSED_SPECIES) {
      const r = checkRefused(id);
      expect(r, `species ${id} should be refused`).not.toBeNull();
    }
  });

  it('Unown (201) is NOT refused', () => {
    expect(checkRefused(201)).toBeNull();
  });

  it('Smeargle (235) is NOT refused', () => {
    expect(checkRefused(235)).toBeNull();
  });

  // Babies hatch from breeding their adult forms in Gen 3 (Pikachu x Ditto -> Pichu egg
  // -> Pichu, etc.). Earlier spec wrongly refused them.
  it.each([
    [172, 'Pichu'],
    [173, 'Cleffa'],
    [174, 'Igglybuff'],
    [175, 'Togepi'],
    [236, 'Tyrogue'],
    [238, 'Smoochum'],
    [239, 'Elekid'],
    [240, 'Magby'],
  ])('baby %i (%s) is NOT refused', (id) => {
    expect(checkRefused(id)).toBeNull();
  });
});

describe('REFUSED_SPECIES snapshot', () => {
  it('contains exactly the 12 expected IDs (11 legendaries + Ditto)', () => {
    const expected = [132, 144, 145, 146, 150, 151, 243, 244, 245, 249, 250, 251];
    const sorted = [...REFUSED_SPECIES].sort((a, b) => a - b);
    expect(sorted).toEqual(expected);
  });
});
