import type { Gen12DVs, Gen12StatExp } from '../../core/src/types/source.js';
import { hpDv } from '../../core/src/types/source.js';

/** Gen 2 stat formula. */
export interface Gen2Stats {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

/**
 * StatExp → stat-experience bonus component.
 *   contribution = floor(min(255, ceil(sqrt(StatExp))) / 4)
 */
function statExpContribution(statExp: number): number {
  return Math.floor(Math.min(255, Math.ceil(Math.sqrt(statExp))) / 4);
}

/**
 * Gen 2 stat formula.
 * HP:    floor(((base+dv)*2 + statExpBonus) * level / 100) + level + 10
 * Other: floor(((base+dv)*2 + statExpBonus) * level / 100) + 5
 */
export function gen2Stats(
  base: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number },
  dvs: Gen12DVs,
  statExp: Gen12StatExp,
  level: number,
): Gen2Stats {
  const hpDVal = hpDv(dvs);
  const hp =
    Math.floor(((base.hp + hpDVal) * 2 + statExpContribution(statExp.hp)) * (level / 100)) +
    level +
    10;
  const atk =
    Math.floor(((base.atk + dvs.atk) * 2 + statExpContribution(statExp.atk)) * (level / 100)) + 5;
  const def =
    Math.floor(((base.def + dvs.def) * 2 + statExpContribution(statExp.def)) * (level / 100)) + 5;
  const spa =
    Math.floor(
      ((base.spa + dvs.special) * 2 + statExpContribution(statExp.special)) * (level / 100),
    ) + 5;
  const spd =
    Math.floor(
      ((base.spd + dvs.special) * 2 + statExpContribution(statExp.special)) * (level / 100),
    ) + 5;
  const spe =
    Math.floor(((base.spe + dvs.spe) * 2 + statExpContribution(statExp.spe)) * (level / 100)) + 5;
  return { hp, atk, def, spa, spd, spe };
}
