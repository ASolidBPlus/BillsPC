import { describe, it, expect } from 'vitest';
import { convert, isRefusal } from '../../core/src/index.js';
import { unownLetterFromPid } from '../../core/src/__internal__.js';
import { UNOWN_FIXTURES, unownLetterOf } from '../fixtures/unown-letters.js';

describe('Unown letter extraction and PID constraint', () => {
  it('unownLetterFromPid returns 0..27 range', () => {
    for (let i = 0; i < 1000; i++) {
      const pid = Math.floor(Math.random() * 0xffffffff) >>> 0;
      const letter = unownLetterFromPid(pid);
      expect(letter).toBeGreaterThanOrEqual(0);
      expect(letter).toBeLessThan(28);
    }
  });

  it('conversion preserves the source Unown letter for all 26 A..Z fixtures', () => {
    for (const fx of UNOWN_FIXTURES) {
      const out = convert(fx);
      if (isRefusal(out)) throw new Error('Unown should not be refused');
      const sourceLetter = unownLetterOf(fx);
      const converted = unownLetterFromPid(out.pid);
      expect(converted).toBe(sourceLetter);
      expect(out._meta.unownLetterConstrained).toBe(true);
    }
  });

  it('Unown fixture count is 26 (A..Z)', () => {
    expect(UNOWN_FIXTURES.length).toBe(26);
  });

  /**
   * AMEND-7: Gen 2 never produces `!` (index 26) or `?` (index 27) — those
   * forms were introduced in FRLG's Tanoby Ruins — so there's no fixture
   * round-trip to exercise. But the Gen 3 extraction function
   * `unownLetterFromPid` returns values in 0..27 per its `% 28`, and we need
   * unit coverage of the 26 and 27 branches in case a future PID-search path
   * emits one of those letters. These PIDs are constructed directly by
   * choosing bit pairs that encode the target pre-mod value (raw 26 = 0b00011010,
   * raw 27 = 0b00011011).
   */
  it('unownLetterFromPid extracts letter 26 (!) from a constructed PID', () => {
    // raw = 26 = 0b00_01_10_10 → byte3=00, byte2=01, byte1=10, byte0=10
    expect(unownLetterFromPid(0x00010202)).toBe(26);
  });

  it('unownLetterFromPid extracts letter 27 (?) from a constructed PID', () => {
    // raw = 27 = 0b00_01_10_11 → byte3=00, byte2=01, byte1=10, byte0=11
    expect(unownLetterFromPid(0x00010203)).toBe(27);
  });
});
