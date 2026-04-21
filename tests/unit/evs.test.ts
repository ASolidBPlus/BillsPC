import { describe, it, expect } from 'vitest';
import { deriveEVs } from '../../core/src/__internal__.js';

describe('deriveEVs — hardcoded §9 cases', () => {
  it('Case A: all-zero StatExp → all-zero EVs, no scaling', () => {
    const r = deriveEVs({ hp: 0, atk: 0, def: 0, spe: 0, special: 0 });
    expect(r.evs).toEqual({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });
    expect(r.scalingApplied).toBe(false);
    expect(r.remainderDistributed).toBe(0);
  });

  it('Case B: all-65535 StatExp → [85,85,85,85,85,85] after scaling, 0 residual', () => {
    const r = deriveEVs({ hp: 65535, atk: 65535, def: 65535, spe: 65535, special: 65535 });
    expect(r.evs).toEqual({ hp: 85, atk: 85, def: 85, spa: 85, spd: 85, spe: 85 });
    expect(r.scalingApplied).toBe(true);
    expect(r.remainderDistributed).toBe(0);
  });

  it('Case C: partial-trained → [191,191,75,0,0,53] (PLAN_EVAL A3)', () => {
    const r = deriveEVs({ hp: 65535, atk: 65535, def: 10000, spe: 5000, special: 0 });
    expect(r.evs).toEqual({ hp: 191, atk: 191, def: 75, spa: 0, spd: 0, spe: 53 });
    expect(r.scalingApplied).toBe(true);
    expect(r.remainderDistributed).toBe(3);
  });

  it('Hamilton forced-tie (PLAN_EVAL A9): StatExp {hp,atk,def,special,spe:4900} → [90,90,89,89,89,63]', () => {
    const r = deriveEVs({ hp: 10000, atk: 10000, def: 10000, spe: 4900, special: 10000 });
    expect(r.evs).toEqual({ hp: 90, atk: 90, def: 89, spa: 89, spd: 89, spe: 63 });
    expect(r.scalingApplied).toBe(true);
    expect(r.remainderDistributed).toBe(3);
  });

  it('sum is always ≤ 510', () => {
    const inputs = [
      { hp: 65535, atk: 65535, def: 65535, spe: 65535, special: 65535 },
      { hp: 65535, atk: 65535, def: 10000, spe: 5000, special: 0 },
      { hp: 0, atk: 0, def: 0, spe: 0, special: 0 },
      { hp: 30000, atk: 40000, def: 10000, spe: 20000, special: 50000 },
    ];
    for (const se of inputs) {
      const r = deriveEVs(se);
      const sum = r.evs.hp + r.evs.atk + r.evs.def + r.evs.spa + r.evs.spd + r.evs.spe;
      expect(sum).toBeLessThanOrEqual(510);
    }
  });

  it('floor(sqrt(65535)) with 252 cap', () => {
    const r = deriveEVs({ hp: 65535, atk: 0, def: 0, spe: 0, special: 0 });
    // raw = [252, 0, 0, 0, 0, 0], sum 252 <= 510, no scaling.
    expect(r.evs.hp).toBe(252);
    expect(r.scalingApplied).toBe(false);
  });
});
