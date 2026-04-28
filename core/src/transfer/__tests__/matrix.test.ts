/**
 * S7b — `planTransfer` matrix tests. Covers all 9 source × dest pairs.
 */

import { describe, it, expect } from 'vitest';
import { planTransfer, TransferMatrixRefusal, isTransferMatrixRefusal } from '../matrix.js';

describe('planTransfer matrix', () => {
  it('Gen 1 → Gen 1: allowed (identity-gen1)', () => {
    const result = planTransfer({ family: 'gen1' }, { family: 'gen1' });
    expect(isTransferMatrixRefusal(result)).toBe(false);
    expect((result as { conversion: string }).conversion).toBe('identity-gen1');
  });

  it('Gen 1 → Gen 2: refused with GEN1_TO_GEN2_NOT_YET (DECISION-3)', () => {
    const result = planTransfer({ family: 'gen1' }, { family: 'gen2' });
    expect(isTransferMatrixRefusal(result)).toBe(true);
    expect((result as TransferMatrixRefusal).reason).toBe('GEN1_TO_GEN2_NOT_YET');
    expect((result as TransferMatrixRefusal).userCopy).toMatch(/Time-Capsule/i);
  });

  it('Gen 1 → Gen 3: allowed (gen12to3 conversion)', () => {
    const result = planTransfer({ family: 'gen1' }, { family: 'gen3' });
    expect(isTransferMatrixRefusal(result)).toBe(false);
    expect((result as { conversion: string }).conversion).toBe('gen12to3');
  });

  it('Gen 2 → Gen 1: refused with NO_DOWNGRADE_TO_GEN1', () => {
    const result = planTransfer({ family: 'gen2' }, { family: 'gen1' });
    expect((result as TransferMatrixRefusal).reason).toBe('NO_DOWNGRADE_TO_GEN1');
  });

  it('Gen 2 → Gen 2: allowed (identity-gen2)', () => {
    const result = planTransfer({ family: 'gen2' }, { family: 'gen2' });
    expect((result as { conversion: string }).conversion).toBe('identity-gen2');
  });

  it('Gen 2 → Gen 3: allowed (gen12to3 conversion)', () => {
    const result = planTransfer({ family: 'gen2' }, { family: 'gen3' });
    expect((result as { conversion: string }).conversion).toBe('gen12to3');
  });

  it('Gen 3 → Gen 1: refused with NO_BACKWARDS_GEN3', () => {
    const result = planTransfer({ family: 'gen3' }, { family: 'gen1' });
    expect((result as TransferMatrixRefusal).reason).toBe('NO_BACKWARDS_GEN3');
  });

  it('Gen 3 → Gen 2: refused with NO_BACKWARDS_GEN3', () => {
    const result = planTransfer({ family: 'gen3' }, { family: 'gen2' });
    expect((result as TransferMatrixRefusal).reason).toBe('NO_BACKWARDS_GEN3');
  });

  it('Gen 3 → Gen 3: refused with GEN3_TO_GEN3_NOT_YET (DECISION-10)', () => {
    const result = planTransfer({ family: 'gen3' }, { family: 'gen3' });
    expect((result as TransferMatrixRefusal).reason).toBe('GEN3_TO_GEN3_NOT_YET');
    expect((result as TransferMatrixRefusal).userCopy).toMatch(/S7c/);
  });
});

describe('TransferMatrixRefusal — friendly user copy', () => {
  it('exposes a `userCopy` for every refusal reason', () => {
    const pairs: ReadonlyArray<[string, string]> = [
      ['gen1', 'gen2'],
      ['gen2', 'gen1'],
      ['gen3', 'gen1'],
      ['gen3', 'gen2'],
      ['gen3', 'gen3'],
    ];
    for (const [s, d] of pairs) {
      const result = planTransfer(
        { family: s as 'gen1' | 'gen2' | 'gen3' },
        { family: d as 'gen1' | 'gen2' | 'gen3' },
      );
      expect(isTransferMatrixRefusal(result)).toBe(true);
      expect((result as TransferMatrixRefusal).userCopy.length).toBeGreaterThan(20);
    }
  });
});
