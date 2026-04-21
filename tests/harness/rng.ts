import type { RNG, RngFactory } from '../../core/src/types/options.js';

/**
 * Deterministic test RNG factory: returns a repeating bit pattern. Useful
 * when you want a specific IV draw sequence for reproducing a bug report.
 */
export function fixedBitsRng(pattern: readonly (0 | 1)[]): RngFactory {
  return (): RNG => {
    let i = 0;
    const step = (): number => {
      const b = pattern[i % pattern.length]!;
      i++;
      return b;
    };
    return {
      bit(): 0 | 1 {
        return step() as 0 | 1;
      },
      int(n: number): number {
        let acc = 0;
        for (let k = 0; k < 32; k++) acc = (acc << 1) | step();
        return Math.abs(acc) % n;
      },
      uint32(): number {
        let acc = 0;
        for (let k = 0; k < 32; k++) acc = ((acc << 1) | step()) >>> 0;
        return acc >>> 0;
      },
    };
  };
}
