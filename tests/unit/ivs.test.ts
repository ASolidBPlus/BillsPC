import { describe, it, expect } from 'vitest';
import { deriveIVs, seedRng, hpDv } from '../../core/src/__internal__.js';

describe('deriveIVs', () => {
  const SEED = new Uint8Array([1, 2, 3]);

  it('IV ∈ {2*DV, 2*DV+1} for all DV values over 10k seeds', () => {
    for (let dv = 1; dv <= 15; dv++) {
      const dvs = { atk: dv, def: dv, spe: dv, special: dv };
      const countLo = { hp: 0, atk: 0, def: 0, spe: 0 };
      const N = 1000;
      for (let s = 0; s < N; s++) {
        const rng = seedRng(new Uint8Array([s & 0xff, (s >> 8) & 0xff, dv]));
        const r = deriveIVs(dvs, rng, { preserveZeroDV: false });
        expect([2 * dv, 2 * dv + 1]).toContain(r.ivs.atk);
        expect([2 * dv, 2 * dv + 1]).toContain(r.ivs.def);
        expect([2 * dv, 2 * dv + 1]).toContain(r.ivs.spe);
        expect([2 * dv, 2 * dv + 1]).toContain(r.ivs.spa);
        expect(r.ivs.spa).toBe(r.ivs.spd); // shared bit
        if (r.ivs.atk === 2 * dv) countLo.atk++;
        if (r.ivs.def === 2 * dv) countLo.def++;
        if (r.ivs.spe === 2 * dv) countLo.spe++;
      }
      // Rough 50/50 split.
      expect(countLo.atk).toBeGreaterThan(N * 0.3);
      expect(countLo.atk).toBeLessThan(N * 0.7);
    }
  });

  it('preserveZeroDV=true forces IV=0 when DV=0', () => {
    const dvs = { atk: 0, def: 5, spe: 0, special: 0 };
    const rng = seedRng(SEED);
    const r = deriveIVs(dvs, rng, { preserveZeroDV: true });
    expect(r.ivs.atk).toBe(0);
    expect(r.ivs.spe).toBe(0);
    expect(r.ivs.spa).toBe(0);
    expect(r.ivs.spd).toBe(0);
    expect(r.zeroDvOverridesApplied).toContain('atk');
    expect(r.zeroDvOverridesApplied).toContain('spe');
    expect(r.zeroDvOverridesApplied).toContain('spa');
    expect(r.zeroDvOverridesApplied).toContain('spd');
  });

  it('preserveZeroDV=false lets IV draw for DV=0', () => {
    const dvs = { atk: 0, def: 5, spe: 0, special: 0 };
    const seenAtk = new Set<number>();
    for (let s = 0; s < 100; s++) {
      const rng = seedRng(new Uint8Array([s]));
      const r = deriveIVs(dvs, rng, { preserveZeroDV: false });
      seenAtk.add(r.ivs.atk);
      expect([0, 1]).toContain(r.ivs.atk);
      expect(r.zeroDvOverridesApplied).not.toContain('atk');
    }
    expect(seenAtk).toEqual(new Set([0, 1]));
  });

  it('SpA === SpD across 1000 seeds', () => {
    const dvs = { atk: 5, def: 5, spe: 5, special: 7 };
    for (let s = 0; s < 1000; s++) {
      const rng = seedRng(new Uint8Array([s & 0xff, (s >> 8) & 0xff]));
      const r = deriveIVs(dvs, rng, { preserveZeroDV: false });
      expect(r.ivs.spa).toBe(r.ivs.spd);
    }
  });

  it('HP DV parities across all 16 combos', () => {
    const snapshot: number[] = [];
    for (let i = 0; i < 16; i++) {
      const atk = (i >> 3) & 1;
      const def = (i >> 2) & 1;
      const spe = (i >> 1) & 1;
      const sp = i & 1;
      snapshot.push(hpDv({ atk, def, spe, special: sp }));
    }
    // expected = i (since HP DV = pack(atk, def, spe, special)).
    expect(snapshot).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });
});
