import { describe, it, expect } from 'vitest';
import { convert, isRefusal } from '../../core/src/index.js';
import { REFUSED_SPECIES } from '../../core/src/__internal__.js';
import { mewRefused } from '../fixtures/mew-refused.js';

describe('refusal flow', () => {
  it('Mew fixture → LEGENDARY refusal', () => {
    const out = convert(mewRefused);
    expect(isRefusal(out)).toBe(true);
    if (!isRefusal(out)) throw new Error('unreachable');
    expect(out.reason).toBe('LEGENDARY');
    expect(out.message).toContain('Mew');
  });

  it('all 20 refused species produce a Refusal', () => {
    for (const id of REFUSED_SPECIES) {
      const out = convert({
        ...mewRefused,
        speciesGen2Id: id,
      });
      expect(isRefusal(out)).toBe(true);
    }
  });

  it('isRefusal narrows correctly', () => {
    const out = convert(mewRefused);
    if (isRefusal(out)) {
      // TS should narrow `out` to Refusal here.
      expect(out.kind).toBe('refusal');
    } else {
      throw new Error('expected refusal');
    }
  });
});
