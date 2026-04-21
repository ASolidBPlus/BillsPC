import { describe, it, expect } from 'vitest';
import { deriveNature, NATURE_NAMES, NEUTRAL_NATURES } from '../../core/src/__internal__.js';

describe('deriveNature', () => {
  it('maps bucket 0..4 to neutral natures', () => {
    expect(deriveNature({ atk: 0, def: 0, spe: 0, special: 0 })).toBe(0); // Hardy
    expect(deriveNature({ atk: 0, def: 1, spe: 0, special: 0 })).toBe(6); // Docile
    expect(deriveNature({ atk: 0, def: 2, spe: 0, special: 0 })).toBe(12); // Serious
    expect(deriveNature({ atk: 0, def: 3, spe: 0, special: 0 })).toBe(18); // Bashful
    expect(deriveNature({ atk: 0, def: 4, spe: 0, special: 0 })).toBe(24); // Quirky
  });

  it('NATURE_NAMES has Serious at 12 and Bashful at 18 (PLAN_EVAL A1)', () => {
    expect(NATURE_NAMES[12]).toBe('Serious');
    expect(NATURE_NAMES[18]).toBe('Bashful');
    expect(NATURE_NAMES.length).toBe(25);
  });

  it('all 256 (atk, def) pairs yield one of 5 neutral natures', () => {
    const counts = new Map<number, number>();
    for (let atk = 0; atk < 16; atk++) {
      for (let def = 0; def < 16; def++) {
        const n = deriveNature({ atk, def, spe: 0, special: 0 });
        expect(NEUTRAL_NATURES).toContain(n);
        counts.set(n, (counts.get(n) ?? 0) + 1);
      }
    }
    expect(counts.size).toBe(5);
  });

  it('distribution is exactly [52, 51, 51, 51, 51] (PLAN_EVAL A2)', () => {
    const counts: Record<number, number> = { 0: 0, 6: 0, 12: 0, 18: 0, 24: 0 };
    for (let atk = 0; atk < 16; atk++) {
      for (let def = 0; def < 16; def++) {
        const n = deriveNature({ atk, def, spe: 0, special: 0 });
        counts[n] = (counts[n] ?? 0) + 1;
      }
    }
    expect(counts[0]).toBe(52); // bucket 0: residue 0 over 0..255
    expect(counts[6]).toBe(51);
    expect(counts[12]).toBe(51);
    expect(counts[18]).toBe(51);
    expect(counts[24]).toBe(51);
  });
});
