import { sha256 } from './sha256.js';
import type { RNG } from '../types/options.js';

/**
 * Deterministic RNG seeded from arbitrary bytes. Uses SHA-256 in counter mode:
 *
 *   block_n = sha256(seed || u32be(n))
 *
 * Each block supplies 32 bytes of output. Independent streams in the pipeline
 * (IV draws vs PID search) use distinct seeds so they don't collide.
 *
 * The implementation is NOT cryptographically strong, but SHA-256 gives us
 * a clean 50/50 bit distribution across long sequences, and the underlying
 * impl is verified against NIST vectors.
 */
export function seedRng(seed: Uint8Array): RNG {
  let counter = 0;
  let buf: Uint8Array = new Uint8Array(0);
  let off = 0;

  const refill = (): void => {
    const ctr = new Uint8Array(4);
    ctr[0] = (counter >>> 24) & 0xff;
    ctr[1] = (counter >>> 16) & 0xff;
    ctr[2] = (counter >>> 8) & 0xff;
    ctr[3] = counter & 0xff;
    counter++;
    const combined = new Uint8Array(seed.length + 4);
    combined.set(seed, 0);
    combined.set(ctr, seed.length);
    buf = sha256(combined);
    off = 0;
  };

  const nextByte = (): number => {
    if (off >= buf.length) refill();
    return buf[off++]!;
  };

  const nextU32 = (): number => {
    const a = nextByte();
    const b = nextByte();
    const c = nextByte();
    const d = nextByte();
    return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
  };

  return {
    bit(): 0 | 1 {
      return (nextByte() & 1) as 0 | 1;
    },
    int(n: number): number {
      if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
        throw new Error(`int(n): n must be a positive integer, got ${n}`);
      }
      // Rejection sampling to avoid modulo bias.
      const limit = Math.floor(0x100000000 / n) * n;
      for (;;) {
        const v = nextU32();
        if (v < limit) return v % n;
      }
    },
    uint32: nextU32,
  };
}
