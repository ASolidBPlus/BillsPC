import type { Gen12DVs } from '../types/source.js';
import { hpDv } from '../types/source.js';
import type { RNG } from '../types/options.js';

export interface IVs {
  readonly hp: number;
  readonly atk: number;
  readonly def: number;
  readonly spa: number;
  readonly spd: number;
  readonly spe: number;
}

export type ZeroDvOverride = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';

export interface IVResult {
  readonly ivs: IVs;
  readonly zeroDvOverridesApplied: readonly ZeroDvOverride[];
}

/**
 * §4.1 + §4.2. Draw order is **hp, atk, def, spe, special** — the RNG bits
 * are consumed in that exact order and are part of the determinism contract.
 * Do NOT reorder.
 *
 * For Special, a single shared bit is drawn for SpA and SpD so the two IVs
 * always match (per §4.2 mirror-split).
 */
export function deriveIVs(dvs: Gen12DVs, rng: RNG, opts: { preserveZeroDV: boolean }): IVResult {
  const overrides: ZeroDvOverride[] = [];
  const hpDvValue = hpDv(dvs);

  const drawWithZeroPolicy = (dv: number, label: ZeroDvOverride): number => {
    if (opts.preserveZeroDV && dv === 0) {
      overrides.push(label);
      // Still consume a bit? Contract: zero-DV override does NOT consume a bit.
      return 0;
    }
    const b = rng.bit();
    return 2 * dv + b;
  };

  const hp = drawWithZeroPolicy(hpDvValue, 'hp');
  const atk = drawWithZeroPolicy(dvs.atk, 'atk');
  const def = drawWithZeroPolicy(dvs.def, 'def');
  const spe = drawWithZeroPolicy(dvs.spe, 'spe');

  // Special split: shared bit, dual override.
  let spa: number;
  let spd: number;
  if (opts.preserveZeroDV && dvs.special === 0) {
    spa = 0;
    spd = 0;
    overrides.push('spa');
    overrides.push('spd');
  } else {
    const b = rng.bit();
    spa = 2 * dvs.special + b;
    spd = spa;
  }

  return {
    ivs: { hp, atk, def, spa, spd, spe },
    zeroDvOverridesApplied: overrides,
  };
}
