import type { Gen12DVs } from '../types/source.js';

export const UNOWN_SPECIES_GEN2_ID = 201;

/**
 * Gen 3 Unown letter extraction from PID.
 *   letter = ((pid>>24)&3)<<6 | ((pid>>16)&3)<<4 | ((pid>>8)&3)<<2 | (pid&3)
 *   letter %= 28
 *
 * 0..25 = A..Z, 26 = '!', 27 = '?'.
 */
export function unownLetterFromPid(pid: number): number {
  const b3 = (pid >>> 24) & 0x3;
  const b2 = (pid >>> 16) & 0x3;
  const b1 = (pid >>> 8) & 0x3;
  const b0 = pid & 0x3;
  return ((b3 << 6) | (b2 << 4) | (b1 << 2) | b0) % 28;
}

/**
 * Gen 2 Unown letter derivation from DVs.
 *   letter_index = ((atk >> 1) & 3) << 6
 *                | ((def >> 1) & 3) << 4
 *                | ((spe >> 1) & 3) << 2
 *                | ((special >> 1) & 3)
 *   letter_index /= 10   (yielding 0..25 for A..Z in Gen 2)
 *
 * Gen 2 only has 26 letter forms (A..Z), no ! or ?. Per Bulbapedia:
 * letter = floor(((atkDV >> 6) | (defDV >> 4) | ...) / 10) — simplified:
 * extract bits 1..2 of each DV (msb pair), concatenate to 8-bit value 0..255,
 * divide by 10 and clamp to 0..25.
 */
export function gen2UnownLetter(dvs: Gen12DVs): number {
  const v =
    (((dvs.atk >>> 1) & 0x3) << 6) |
    (((dvs.def >>> 1) & 0x3) << 4) |
    (((dvs.spe >>> 1) & 0x3) << 2) |
    ((dvs.special >>> 1) & 0x3);
  return Math.min(25, Math.floor(v / 10));
}
