import { describe, it, expect } from 'vitest';
import {
  convertNickname,
  convertOTName,
  GEN3_TERMINATOR,
  GEN3_QUESTION_MARK,
  decodeGen12,
} from '../../core/src/__internal__.js';
import { encodeAsciiGen12 } from '../fixtures/common.js';

describe('string conversion', () => {
  it('ASCII round-trip preserves letters', () => {
    const src = encodeAsciiGen12('ASH');
    const out = convertOTName(src);
    // Last byte is terminator.
    expect(out[out.length - 1]).toBe(GEN3_TERMINATOR);
    // Bytes should decode back to "ASH" via the Gen 3 charmap.
    const decoded = [...out.slice(0, out.length - 1)]
      .map((b) => String.fromCharCode(65 + (b - 0xbb)))
      .join('');
    expect(decoded).toBe('ASH');
  });

  it('unmapped characters become "?" (0xAC)', () => {
    // Gen 1/2 byte 0x7E is not in our charmap12 subset.
    const src = new Uint8Array([0x80, 0x7e, 0x50]); // "A" + unmapped + term
    const out = convertOTName(src);
    expect(out[1]).toBe(GEN3_QUESTION_MARK);
  });

  it('nickname truncates to 10 characters', () => {
    const src = encodeAsciiGen12('ABCDEFGHIJKL'); // 12 chars
    const out = convertNickname(src);
    // 10 content bytes + 1 terminator = 11 total.
    expect(out.length).toBe(11);
    expect(out[10]).toBe(GEN3_TERMINATOR);
  });

  it('OT name truncates to 7 characters', () => {
    const src = encodeAsciiGen12('ABCDEFGH');
    const out = convertOTName(src);
    expect(out.length).toBe(8);
    expect(out[7]).toBe(GEN3_TERMINATOR);
  });

  it('decodeGen12 stops at 0x50 terminator', () => {
    const bytes = new Uint8Array([0x80, 0x81, 0x50, 0x82]);
    expect(decodeGen12(bytes)).toBe('AB');
  });

  it('male/female signs round-trip', () => {
    // 0xEF in Gen1/2 → ♂ → 0xB5 in Gen3; 0xF5 → ♀ → 0xB6.
    const src = new Uint8Array([0xef, 0xf5, 0x50]);
    const out = convertNickname(src);
    expect(out[0]).toBe(0xb5);
    expect(out[1]).toBe(0xb6);
    expect(out[2]).toBe(GEN3_TERMINATOR);
  });
});
