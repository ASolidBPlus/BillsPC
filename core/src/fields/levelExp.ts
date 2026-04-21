import type { Gen12Pokemon } from '../types/source.js';

/** §4.13: pass through level/EXP, bounds-checked. */
export function preserveLevelExp(src: Gen12Pokemon): { level: number; exp: number } {
  if (src.level < 1 || src.level > 100) {
    throw new Error(`Source level ${src.level} out of range [1, 100].`);
  }
  if (src.exp < 0 || src.exp > 0xffffff) {
    throw new Error(`Source EXP ${src.exp} out of uint24 range.`);
  }
  return { level: src.level, exp: src.exp };
}
