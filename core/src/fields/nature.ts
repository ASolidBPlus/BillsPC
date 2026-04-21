import type { Gen12DVs } from '../types/source.js';

/**
 * Canonical PKHeX Nature enum values for the five neutral natures.
 * Hardy=0, Docile=6, Serious=12, Bashful=18, Quirky=24.
 *
 * PLAN §4.4 had Serious/Bashful swapped; PLAN_EVAL A1 binds this order.
 */
const NEUTRAL: readonly [number, number, number, number, number] = [
  0, // Hardy   (Atk-themed neutral)
  6, // Docile  (Def-themed neutral)
  12, // Serious (Spe-themed neutral)
  18, // Bashful (SpA-themed neutral)
  24, // Quirky  (SpD-themed neutral)
];

export const NEUTRAL_NATURES: readonly number[] = NEUTRAL;

/**
 * §4.4: bucket = ((atk_dv << 4) | def_dv) % 5; returns the canonical
 * neutral-nature ID for that bucket.
 */
export function deriveNature(dvs: Gen12DVs): number {
  const bucket = (((dvs.atk & 0x0f) << 4) | (dvs.def & 0x0f)) % 5;
  return NEUTRAL[bucket]!;
}

/**
 * Lookup table of all 25 nature names by ID. Used by tests to assert
 * "NATURE_NAMES[12] === 'Serious'" as a defence against re-swapping.
 */
export const NATURE_NAMES: readonly string[] = [
  'Hardy', // 0
  'Lonely', // 1
  'Brave', // 2
  'Adamant', // 3
  'Naughty', // 4
  'Bold', // 5
  'Docile', // 6
  'Relaxed', // 7
  'Impish', // 8
  'Lax', // 9
  'Timid', // 10
  'Hasty', // 11
  'Serious', // 12
  'Jolly', // 13
  'Naive', // 14
  'Modest', // 15
  'Mild', // 16
  'Quiet', // 17
  'Bashful', // 18
  'Rash', // 19
  'Calm', // 20
  'Gentle', // 21
  'Sassy', // 22
  'Careful', // 23
  'Quirky', // 24
];
