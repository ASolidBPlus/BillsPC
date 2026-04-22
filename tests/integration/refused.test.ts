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

  it('all refused species (12: 11 legendaries + Ditto) produce a Refusal', () => {
    for (const id of REFUSED_SPECIES) {
      const out = convert({
        ...mewRefused,
        speciesGen2Id: id,
      });
      expect(isRefusal(out)).toBe(true);
    }
  });

  it('babies (Pichu, Cleffa, etc.) are NOT refused — they hatch from breeding adult forms', () => {
    for (const id of [172, 173, 174, 175, 236, 238, 239, 240]) {
      const out = convert({
        ...mewRefused,
        speciesGen2Id: id,
      });
      expect(isRefusal(out), `species ${id} (baby) should NOT be refused`).toBe(false);
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
