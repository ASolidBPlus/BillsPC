import { describe, it, expect } from 'vitest';
import { convert, isRefusal } from '../../core/src/index.js';
import { baseGen2 } from '../fixtures/common.js';

describe('preserveZeroDV end-to-end (PLAN_EVAL gap 7)', () => {
  const zeroDvFixture = baseGen2({
    dvs: { atk: 0, def: 10, spe: 10, special: 0 },
    statExp: { hp: 0, atk: 0, def: 0, spe: 0, special: 0 },
  });

  it('preserveZeroDV=true zeros Atk and Special IVs', () => {
    const out = convert(zeroDvFixture);
    if (isRefusal(out)) throw new Error('unexpected refusal');
    expect(out.ivs.atk).toBe(0);
    expect(out.ivs.spa).toBe(0);
    expect(out.ivs.spd).toBe(0);
    expect(out._meta.zeroDvOverridesApplied).toEqual(expect.arrayContaining(['atk', 'spa', 'spd']));
  });

  it('preserveZeroDV=false lets IV draw for zero DVs', () => {
    const seenAtk = new Set<number>();
    for (let i = 0; i < 20; i++) {
      const fx = {
        ...zeroDvFixture,
        otNameBytes: new Uint8Array([...zeroDvFixture.otNameBytes, i]),
      };
      const out = convert(fx, { preserveZeroDV: false });
      if (isRefusal(out)) throw new Error('unexpected refusal');
      seenAtk.add(out.ivs.atk);
      expect([0, 1]).toContain(out.ivs.atk);
      expect(out._meta.zeroDvOverridesApplied).toEqual([]);
    }
    expect(seenAtk.size).toBeGreaterThan(1);
  });
});
