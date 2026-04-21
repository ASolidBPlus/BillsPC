import { describe, expect, it } from 'vitest';
import { computeChecksum } from '../../core/src/pack/gen3Checksum.js';

describe('gen3Checksum', () => {
  it('all-zero block sums to 0', () => {
    const block = new Uint8Array(48);
    expect(computeChecksum(block)).toBe(0);
  });

  it('all-0xFF block: sum = 24 * 0xFFFF = 0x17FFE8 → low 16 = 0xFFE8', () => {
    const block = new Uint8Array(48).fill(0xff);
    // 24 u16 words each 0xFFFF: 24 * 65535 = 1572840 = 0x17FFE8 → & 0xFFFF = 0xFFE8
    expect(computeChecksum(block)).toBe(0xffe8);
  });

  it('single u16 = 0x1234 at offset 0, rest zero', () => {
    const block = new Uint8Array(48);
    block[0] = 0x34;
    block[1] = 0x12;
    expect(computeChecksum(block)).toBe(0x1234);
  });

  it('throws on wrong-size block', () => {
    expect(() => computeChecksum(new Uint8Array(47))).toThrow(RangeError);
    expect(() => computeChecksum(new Uint8Array(49))).toThrow(RangeError);
  });

  it('overflow wraps mod 0x10000 (2 * 0x8000 = 0x10000 → 0)', () => {
    const block = new Uint8Array(48);
    block[0] = 0x00;
    block[1] = 0x80; // first u16 = 0x8000
    block[2] = 0x00;
    block[3] = 0x80; // second u16 = 0x8000
    // sum = 0x10000 → & 0xFFFF = 0
    expect(computeChecksum(block)).toBe(0);
  });
});
