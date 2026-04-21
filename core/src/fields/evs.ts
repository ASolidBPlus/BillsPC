import type { Gen12StatExp } from '../types/source.js';

export interface EVs {
  readonly hp: number;
  readonly atk: number;
  readonly def: number;
  readonly spa: number;
  readonly spd: number;
  readonly spe: number;
}

export interface EVResult {
  readonly evs: EVs;
  readonly scalingApplied: boolean;
  readonly remainderDistributed: number;
}

const STAT_ORDER = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const;

function sqrtFloorCap(x: number): number {
  return Math.min(252, Math.floor(Math.sqrt(x)));
}

/**
 * §4.3: StatExp → EVs via `min(252, floor(sqrt(x)))`, Special StatExp fed to
 * BOTH SpA and SpD (§4.2 split), then if total > 510, scale proportionally
 * and distribute residual via Hamilton (rem desc, idx asc tiebreak).
 *
 * Stat order throughout: [hp, atk, def, spa, spd, spe].
 */
export function deriveEVs(statExp: Gen12StatExp): EVResult {
  const raw: [number, number, number, number, number, number] = [
    sqrtFloorCap(statExp.hp),
    sqrtFloorCap(statExp.atk),
    sqrtFloorCap(statExp.def),
    sqrtFloorCap(statExp.special),
    sqrtFloorCap(statExp.special),
    sqrtFloorCap(statExp.spe),
  ];

  const sum = raw.reduce((a, b) => a + b, 0);
  if (sum <= 510) {
    return {
      evs: toEVs(raw),
      scalingApplied: false,
      remainderDistributed: 0,
    };
  }

  // Proportional scaling.
  const scaled = raw.map((v) => (v * 510) / sum);
  const floors = scaled.map((v) => Math.floor(v));
  const rems = scaled.map((v, i) => v - floors[i]!);

  const sumOfFloors = floors.reduce((a, b) => a + b, 0);
  const residual = 510 - sumOfFloors;

  // Hamilton: sort indices by (rem desc, idx asc). Apply explicit secondary
  // key to be bulletproof against non-stable sorts.
  const idx = [0, 1, 2, 3, 4, 5];
  idx.sort((a, b) => rems[b]! - rems[a]! || a - b);

  const result = [...floors] as [number, number, number, number, number, number];
  for (let i = 0; i < residual; i++) {
    result[idx[i]!] = (result[idx[i]!] ?? 0) + 1;
  }

  return {
    evs: toEVs(result),
    scalingApplied: true,
    remainderDistributed: residual,
  };
}

function toEVs(a: readonly [number, number, number, number, number, number]): EVs {
  return {
    hp: a[0],
    atk: a[1],
    def: a[2],
    spa: a[3],
    spd: a[4],
    spe: a[5],
  };
}

export const EV_STAT_ORDER = STAT_ORDER;
