import type { Gen12Pokemon } from '../types/source.js';

/** §4.11: Gen 1 → 0; Gen 2 → byte passthrough. */
export function preservePokerus(src: Gen12Pokemon): number {
  return src.sourceGen === 1 ? 0 : src.pokerusByte & 0xff;
}
