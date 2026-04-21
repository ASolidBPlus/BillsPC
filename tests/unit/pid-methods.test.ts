import { describe, it, expect } from 'vitest';
import { isWildMethodSpread } from '../../core/src/__internal__.js';

describe('isWildMethodSpread (Method 1/2/4/H1/H2/H4 detection)', () => {
  it('rejects a constructed Method-1 pair (PLAN_EVAL A5)', () => {
    // Construct a Method 1 spread: pick seed, generate PID + IVs forward.
    const LCG_MULT = 0x41c64e6d;
    const LCG_ADD = 0x00006073;
    const next = (s: number) => (Math.imul(s, LCG_MULT) + LCG_ADD) >>> 0;
    const s1 = 0x13579bdf >>> 0;
    const s2 = next(s1);
    const s3 = next(s2);
    const s4 = next(s3);
    const s5 = next(s4);
    const pidHi = s2 >>> 16;
    const pidLo = s3 >>> 16;
    const pid = ((pidHi << 16) | pidLo) >>> 0;
    const iv1 = (s4 >>> 16) & 0x7fff;
    const iv2 = (s5 >>> 16) & 0x7fff;
    const ivs = {
      hp: iv1 & 0x1f,
      atk: (iv1 >>> 5) & 0x1f,
      def: (iv1 >>> 10) & 0x1f,
      spe: iv2 & 0x1f,
      spa: (iv2 >>> 5) & 0x1f,
      spd: (iv2 >>> 10) & 0x1f,
    };
    expect(isWildMethodSpread(pid, ivs)).toBe(true);
  });

  it('accepts a random PID with mismatched IVs', () => {
    const pid = 0xdeadbeef >>> 0;
    const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
    // Astronomically unlikely that this arbitrary pair matches any Method.
    expect(isWildMethodSpread(pid, ivs)).toBe(false);
  });
});
