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
});
