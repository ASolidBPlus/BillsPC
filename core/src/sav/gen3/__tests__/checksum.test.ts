/**
 * S6a — Gen 3 sector-checksum unit test.
 *
 * Per PLAN_EVAL A3: sector 0 uses 3884 bytes, sectors 1..13 use 3968.
 * The fold-and-add formula: sum u32 LE words, then `(sum & 0xFFFF) + (sum >>> 16)`.
 */
import { describe, it, expect } from 'vitest';
import { gen3SectorChecksum } from '../checksum.js';
import { sectorBodySize } from '../format.js';

describe('gen3SectorChecksum', () => {
  it('checksum of all-zero is 0 for both body sizes', () => {
    const buf = new Uint8Array(4096);
    expect(gen3SectorChecksum(buf, 0, 0)).toBe(0);
    expect(gen3SectorChecksum(buf, 0, 5)).toBe(0);
  });

  it('hand-computed vector: single u32 of value 0x00010002', () => {
    const buf = new Uint8Array(4096);
    // u32 LE = bytes 02 00 01 00
    buf[0] = 0x02;
    buf[1] = 0x00;
    buf[2] = 0x01;
    buf[3] = 0x00;
    // sum = 0x00010002 → folded = (0x0002 + 0x0001) = 0x0003
    expect(gen3SectorChecksum(buf, 0, 5)).toBe(0x0003);
  });

  it('hand-computed vector: a single u32 that requires fold (high half nonzero)', () => {
    const buf = new Uint8Array(4096);
    // 0xFFFFFFFE → fold (0xFFFE + 0xFFFF) = 0x1FFFD → LO+HI = 0xFFFD + 1 = 0xFFFE
    // Actually the formula is single fold: ((sum & 0xFFFF) + (sum >>> 16)) & 0xFFFF.
    // sum = 0xFFFFFFFE → (0xFFFE + 0xFFFF) = 0x1FFFD → & 0xFFFF = 0xFFFD.
    buf[0] = 0xfe;
    buf[1] = 0xff;
    buf[2] = 0xff;
    buf[3] = 0xff;
    expect(gen3SectorChecksum(buf, 0, 5)).toBe(0xfffd);
  });

  it('selects the correct body size by sector_id', () => {
    expect(sectorBodySize(0)).toBe(3884);
    for (let i = 1; i < 14; i++) {
      expect(sectorBodySize(i)).toBe(3968);
    }
  });

  it('body-size choice matters: a non-zero word inside [3884, 3968) of sector 0 must NOT contribute', () => {
    const buf = new Uint8Array(4096);
    // Stuff bytes [3884..3888) with a value that would change the checksum
    // if the loop went up to 3968 instead of 3884.
    buf[3884] = 0xff;
    buf[3885] = 0xff;
    buf[3886] = 0xff;
    buf[3887] = 0xff;
    expect(gen3SectorChecksum(buf, 0, 0)).toBe(0); // sector 0 stops at 3884
    // For sector 1..13 the same byte IS in the checksum range:
    // sum = 0xFFFFFFFF → fold → (0xFFFF + 0xFFFF) = 0x1FFFE → & 0xFFFF = 0xFFFE.
    expect(gen3SectorChecksum(buf, 0, 5)).toBe(0xfffe);
  });
});
