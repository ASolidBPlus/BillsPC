import type { Gen12Pokemon } from '../../core/src/types/source.js';
import { baseGen2 } from './common.js';
import { gen2UnownLetter } from '../../core/src/__internal__.js';

/**
 * Build 26 Unown fixtures covering A..Z. We choose DV bit-pair values
 * (2-bit each) so the Gen 2 letter index hits each 0..25 via the
 * `floor((packed_8bit) / 10)` extraction.
 */
function unownLetterFixture(letter: number): Gen12Pokemon {
  // Find DVs whose bit 2:1 (>>1 & 3) pattern produces `packed` with floor/10 = letter.
  // Enumerate all 256 patterns and pick the first matching.
  for (let packed = 0; packed < 256; packed++) {
    if (Math.min(25, Math.floor(packed / 10)) !== letter) continue;
    const a = (packed >>> 6) & 0x3;
    const d = (packed >>> 4) & 0x3;
    const s = (packed >>> 2) & 0x3;
    const sp = packed & 0x3;
    const dvs = {
      atk: a << 1,
      def: d << 1,
      spe: s << 1,
      special: sp << 1,
    };
    return baseGen2({ speciesGen2Id: 201, dvs });
  }
  throw new Error(`No fixture for Unown letter ${letter}`);
}

export const UNOWN_FIXTURES: readonly Gen12Pokemon[] = Array.from({ length: 26 }, (_, i) =>
  unownLetterFixture(i),
);

export function unownLetterOf(src: Gen12Pokemon): number {
  return gen2UnownLetter(src.dvs);
}
