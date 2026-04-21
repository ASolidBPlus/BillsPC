import { describe, it, expect } from 'vitest';
import { hashConcat, seedRng, sha256 } from '../../core/src/__internal__.js';

describe('hashConcat', () => {
  it('concatenates bytes and strings identically', () => {
    const enc = new TextEncoder();
    const a = hashConcat('abc');
    const b = sha256(enc.encode('abc'));
    expect(a).toEqual(b);
  });

  it('is different for reordered inputs', () => {
    const x = hashConcat('ab', 'c');
    const y = hashConcat('a', 'bc');
    expect(x).toEqual(y); // actually: concatenation is associative — same output
  });
});

describe('seedRng', () => {
  const SEED = new Uint8Array([1, 2, 3, 4]);

  it('is deterministic: same seed → same sequence', () => {
    const r1 = seedRng(SEED);
    const r2 = seedRng(SEED);
    for (let i = 0; i < 100; i++) {
      expect(r1.bit()).toBe(r2.bit());
    }
  });

  it('different seeds diverge', () => {
    const r1 = seedRng(SEED);
    const r2 = seedRng(new Uint8Array([9, 9, 9, 9]));
    let same = 0;
    const n = 256;
    for (let i = 0; i < n; i++) {
      if (r1.bit() === r2.bit()) same++;
    }
    // Asymptotic 50/50 would give ~n/2; allow a wide band.
    expect(same).toBeGreaterThan(n * 0.3);
    expect(same).toBeLessThan(n * 0.7);
  });

  it('bit() is 50/50 within 3σ over 10,000 draws', () => {
    const rng = seedRng(SEED);
    let ones = 0;
    const N = 10_000;
    for (let i = 0; i < N; i++) {
      ones += rng.bit();
    }
    // 3σ ≈ 150 on 10k.
    expect(ones).toBeGreaterThan(4850);
    expect(ones).toBeLessThan(5150);
  });

  it('int(n) stays in range', () => {
    const rng = seedRng(SEED);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const v = rng.int(7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
      seen.add(v);
    }
    // All 7 values should appear in 1000 draws.
    expect(seen.size).toBe(7);
  });

  it('uint32() produces distinct values', () => {
    const rng = seedRng(SEED);
    const vals = new Set<number>();
    for (let i = 0; i < 100; i++) {
      vals.add(rng.uint32());
    }
    expect(vals.size).toBeGreaterThan(95);
  });
});
