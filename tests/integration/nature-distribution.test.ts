import { describe, it, expect } from 'vitest';
import { deriveNature, NEUTRAL_NATURES } from '../../core/src/__internal__.js';

describe('nature distribution across 65536 DV combos', () => {
  it('only the 5 neutral natures appear', () => {
    const counts: Record<number, number> = { 0: 0, 6: 0, 12: 0, 18: 0, 24: 0 };
    for (let atk = 0; atk < 16; atk++) {
      for (let def = 0; def < 16; def++) {
        for (let spe = 0; spe < 16; spe++) {
          for (let special = 0; special < 16; special++) {
            const n = deriveNature({ atk, def, spe, special });
            expect(NEUTRAL_NATURES).toContain(n);
            counts[n] = (counts[n] ?? 0) + 1;
          }
        }
      }
    }
    // Nature depends only on (atk, def). So each of the 256 (atk, def)
    // pairs produces one nature; there are 256 pairs × 256 (spe, special)
    // combos = 65536. Counts scale 256×.
    expect(counts[0]).toBe(52 * 256);
    expect(counts[6]).toBe(51 * 256);
    expect(counts[12]).toBe(51 * 256);
    expect(counts[18]).toBe(51 * 256);
    expect(counts[24]).toBe(51 * 256);
  });
});
