/**
 * Deterministic RNG interface used throughout the conversion core.
 * The default implementation seeds off SHA-256 output; see primitives/rng.ts.
 */
export interface RNG {
  /** Returns 0 or 1 with (asymptotic) 50/50 probability. */
  bit(): 0 | 1;
  /** Returns integer in [0, n). Throws on n <= 0. */
  int(n: number): number;
  /** Returns a fresh 32-bit unsigned integer. */
  uint32(): number;
}

export type RngFactory = (seed: Uint8Array) => RNG;

export interface ConvertOptions {
  /**
   * §5.1 heuristic: if true (default), DV=0 forces IV=0 rather than drawing 2*0+b.
   * Record in `_meta.zeroDvOverridesApplied` when applied.
   */
  preserveZeroDV?: boolean;
  /** Test override — inject a custom RNG factory. */
  rng?: RngFactory;
  /** Threshold above which searchPID adds a warning. Default 10_000. */
  pidSearchWarnThreshold?: number;
  /** Absolute cap; exceeding throws. Default 1_000_000. */
  pidSearchHardCap?: number;
}
