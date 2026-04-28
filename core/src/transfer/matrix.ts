/**
 * Cross-generation transfer matrix. Encapsulates the "can this source
 * family be copied to this destination family?" rule, plus a friendly
 * refusal reason for the UI to surface.
 *
 * Per AMEND-S7b-21 + DECISION-3: Gen 1 → Gen 2 cart-to-cart is OUT of
 * S7b scope (Time-Capsule converter not shipped); matrix answers `NO`
 * with `GEN1_TO_GEN2_NOT_YET`.
 *
 * Per AMEND-S7b-21 (implicit) + DECISION-10: Gen 3 → Gen 3 cart-to-cart
 * is OUT of S7b scope (slot-rotation + active-slot-writeback needs
 * focus); matrix answers `NO` with `GEN3_TO_GEN3_NOT_YET`.
 *
 * Gen 1 / Gen 2 → Gen 3 (upload-mode's canonical flow) uses the existing
 * `convert()` path via a `TransferConversion` of `'gen12to3'`. The
 * caller is responsible for running the conversion and decoding/packing
 * around it; this matrix just issues permission.
 */

export type TransferFamily = 'gen1' | 'gen2' | 'gen3';

export type TransferConversion = 'identity-gen1' | 'identity-gen2' | 'gen12to3';

export type TransferMatrixRefusalReason =
  | 'NO_BACKWARDS_GEN3'
  | 'NO_DOWNGRADE_TO_GEN1'
  | 'GEN1_TO_GEN2_NOT_YET'
  | 'GEN3_TO_GEN3_NOT_YET'
  | 'UNKNOWN_FAMILY_PAIR';

export interface TransferPlan {
  readonly conversion: TransferConversion;
  readonly sourceFamily: TransferFamily;
  readonly destFamily: TransferFamily;
}

export class TransferMatrixRefusal extends Error {
  readonly reason: TransferMatrixRefusalReason;
  readonly sourceFamily: TransferFamily;
  readonly destFamily: TransferFamily;
  /** Friendly refusal copy suitable for the staging-pane banner. */
  readonly userCopy: string;
  constructor(args: {
    reason: TransferMatrixRefusalReason;
    sourceFamily: TransferFamily;
    destFamily: TransferFamily;
    userCopy: string;
  }) {
    super(`${args.reason}: ${args.sourceFamily} → ${args.destFamily}`);
    this.name = 'TransferMatrixRefusal';
    this.reason = args.reason;
    this.sourceFamily = args.sourceFamily;
    this.destFamily = args.destFamily;
    this.userCopy = args.userCopy;
  }
}

export function isTransferMatrixRefusal(x: unknown): x is TransferMatrixRefusal {
  return x instanceof TransferMatrixRefusal;
}

/**
 * Decide whether a cross-family transfer is supported. Returns a
 * `TransferPlan` on allowed pairs, a `TransferMatrixRefusal` instance
 * (NOT thrown — value-returning) on denied pairs.
 */
export function planTransfer(
  source: { family: TransferFamily },
  dest: { family: TransferFamily },
): TransferPlan | TransferMatrixRefusal {
  const s = source.family;
  const d = dest.family;

  // Same-family Gen 1 → Gen 1: OK (S7b §10.5 Gen 1 inject).
  if (s === 'gen1' && d === 'gen1') {
    return { conversion: 'identity-gen1', sourceFamily: s, destFamily: d };
  }
  // Same-family Gen 2 → Gen 2: OK.
  if (s === 'gen2' && d === 'gen2') {
    return { conversion: 'identity-gen2', sourceFamily: s, destFamily: d };
  }
  // Gen 1/2 → Gen 3: existing upload-mode conversion path.
  if ((s === 'gen1' || s === 'gen2') && d === 'gen3') {
    return { conversion: 'gen12to3', sourceFamily: s, destFamily: d };
  }
  // Gen 1 → Gen 2: deferred per DECISION-3 / AMEND-S7b-21.
  if (s === 'gen1' && d === 'gen2') {
    return new TransferMatrixRefusal({
      reason: 'GEN1_TO_GEN2_NOT_YET',
      sourceFamily: s,
      destFamily: d,
      userCopy:
        'Gen 1 → Gen 2 cart-to-cart transfer needs Time-Capsule conversion which isn’t ' +
        'supported yet (planned for S7c). Supported same-cart-family transfers in S7b: ' +
        'Gen 1 → Gen 1, Gen 2 → Gen 2. Gen 1/2 → Gen 3 works in Upload Mode.',
    });
  }
  // Gen 2 → Gen 1: structurally impossible (Gen 2 species, held items).
  if (s === 'gen2' && d === 'gen1') {
    return new TransferMatrixRefusal({
      reason: 'NO_DOWNGRADE_TO_GEN1',
      sourceFamily: s,
      destFamily: d,
      userCopy:
        'Gen 2 → Gen 1 downgrade is not supported. Gen 2 introduces species and held-item ' +
        'data that can’t round-trip through a Gen 1 cart. Pokemon’s Time Capsule was ' +
        'forward-only at the cart level.',
    });
  }
  // Gen 3 → anything Gen 1/2: refuse. No backwards conversion.
  if (s === 'gen3' && (d === 'gen1' || d === 'gen2')) {
    return new TransferMatrixRefusal({
      reason: 'NO_BACKWARDS_GEN3',
      sourceFamily: s,
      destFamily: d,
      userCopy:
        'Gen 3 → Gen 1/2 transfer is not supported. Gen 3 species, ability, and shuffled ' +
        'substructure data can’t be round-tripped back to the older format.',
    });
  }
  // Gen 3 → Gen 3: out of scope per DECISION-10 / AMEND-S7b-21.
  if (s === 'gen3' && d === 'gen3') {
    return new TransferMatrixRefusal({
      reason: 'GEN3_TO_GEN3_NOT_YET',
      sourceFamily: s,
      destFamily: d,
      userCopy:
        'Gen 3 → Gen 3 cart-to-cart transfer is not yet supported (coming in S7c). ' +
        'The slot-rotation and active-slot-writeback logic needs a dedicated sprint. ' +
        'For now: export the source save via FlashGBX, inject via Upload Mode.',
    });
  }
  // Fallback for any unexpected family pair.
  return new TransferMatrixRefusal({
    reason: 'UNKNOWN_FAMILY_PAIR',
    sourceFamily: s,
    destFamily: d,
    userCopy: `Unknown transfer path: ${s} → ${d}. Please file an issue.`,
  });
}
