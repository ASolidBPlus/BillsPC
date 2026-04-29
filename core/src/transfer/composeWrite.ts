/**
 * Compose the source-side and destination-side write buffers from a list
 * of staged mons + the relevant parsed save.
 *
 * Source-side: take the source SRAM bytes and apply `deleteMonGen1` /
 * `deleteMonGen2` once per staged mon — fold over the buffer. The
 * S6a/b deleter is a pure mutation on bytes-in → bytes-out, so chaining
 * is sequential.
 *
 * Destination-side: for `gen12to3` conversion the conversion happens
 * upstream of compose — by the time we get here the staged record is
 * already a packed 80-byte Gen 3 mon. We call `injectIntoSave` per
 * staged mon at the chosen (boxIndex, slot). Each `injectIntoSave`
 * returns a fresh save view; we feed its `bytes` into the next call.
 *
 * Per AMEND-S7b-21 / DECISION-3 / DECISION-10 the matrix refuses
 * Gen 1→Gen 2 and Gen 3→Gen 3, so this module only needs:
 *   - source: Gen 1 delete, Gen 2 delete
 *   - destination: Gen 3 inject (the only supported destination family)
 */

import { deleteMonGen1, type Gen1DeleteRef, type Gen1WriterFormat } from '../sav/gen1/writer.js';
import { deleteMonGen2, type Gen2DeleteRef, type Gen2WriterFormat } from '../sav/gen2/writer.js';
import {
  injectIntoSave,
  isGen3InjectError,
  patchSlotInSave,
  isGen3PatchError,
  type Gen3SaveContents,
  type Gen3InjectError,
  type Gen3PatchError,
  type Gen3MonEdits,
  type InjectTarget,
} from '../sav/gen3/index.js';

export type StagedMonRefGen12 =
  | { readonly family: 'gen1'; readonly format: Gen1WriterFormat; readonly ref: Gen1DeleteRef }
  | { readonly family: 'gen2'; readonly format: Gen2WriterFormat; readonly ref: Gen2DeleteRef };

export interface StagedMonRefGen3 {
  readonly target: InjectTarget;
  /** Already-packed 80-byte Gen 3 PC slot record (encrypted). */
  readonly bytes: Uint8Array;
}

export type ComposeError =
  | {
      readonly kind: 'compose_error';
      readonly reason: 'GEN3_INJECT_FAILED';
      readonly underlying: Gen3InjectError;
      readonly stagedIndex: number;
    }
  | {
      readonly kind: 'compose_error';
      readonly reason: 'GEN12_DELETE_FAILED';
      readonly message: string;
      readonly stagedIndex: number;
    }
  | {
      readonly kind: 'compose_error';
      readonly reason: 'GEN3_PATCH_FAILED';
      readonly underlying: Gen3PatchError;
      readonly patchIndex: number;
    };

export function isComposeError(x: unknown): x is ComposeError {
  return typeof x === 'object' && x !== null && (x as { kind?: string }).kind === 'compose_error';
}

/**
 * Apply a list of staged-mon deletions to a source-cart SRAM buffer.
 * Returns the mutated bytes (same length) or a `ComposeError`.
 *
 * The fold-over-delete property is the foundation of the round-trip
 * write test in `roundtrip-write.test.ts`: applying composeSourceWrite
 * with N staged mons MUST equal calling `deleteMonGen{1,2}` N times
 * sequentially in the same order.
 */
export function composeSourceWrite(
  bytes: Uint8Array,
  staged: readonly StagedMonRefGen12[],
): Uint8Array | ComposeError {
  let current: Uint8Array = new Uint8Array(bytes);
  for (let i = 0; i < staged.length; i++) {
    const s = staged[i]!;
    try {
      if (s.family === 'gen1') {
        current = deleteMonGen1(current, s.format, s.ref) as Uint8Array;
      } else {
        current = deleteMonGen2(current, s.format, s.ref) as Uint8Array;
      }
    } catch (e) {
      return {
        kind: 'compose_error',
        reason: 'GEN12_DELETE_FAILED',
        message: (e as Error).message,
        stagedIndex: i,
      };
    }
  }
  return current;
}

/**
 * Apply a list of staged-mon Gen 3 injects to a destination Gen 3 save.
 * Returns the final mutated `bytes` (defensively-copied from the last
 * `injectIntoSave` re-parse) or a `ComposeError` on the first failure.
 */
export function composeDestinationWrite(
  save: Gen3SaveContents,
  staged: readonly StagedMonRefGen3[],
): Uint8Array | ComposeError {
  let current = save;
  for (let i = 0; i < staged.length; i++) {
    const s = staged[i]!;
    const result = injectIntoSave(current, s.target, s.bytes);
    if (isGen3InjectError(result)) {
      return {
        kind: 'compose_error',
        reason: 'GEN3_INJECT_FAILED',
        underlying: result,
        stagedIndex: i,
      };
    }
    current = result;
  }
  return new Uint8Array(current.bytes);
}

/**
 * S10 — combined patch + inject composer for the manual cart-patch flow.
 *
 * Per RA-1: this is a SEPARATE composer from `composeDestinationWrite`.
 * That function's "no occupied targets" contract stays sacred for the
 * existing transfer flow; the patch path needs to MUTATE occupied
 * targets (every patch target is, by definition, filled).
 *
 * Order: patches first (each via `patchSlotInSave` threading the
 * updated save), then any staged injects on the patched save. Final
 * bytes feed `flashCart` unchanged. The optional `staged` array makes
 * it ergonomic to combine a patch session with a transfer session in
 * a single flash, but the typical S10 caller passes patches only.
 */
export function composeDestinationPatchWrite(
  save: Gen3SaveContents,
  patches: readonly { readonly target: InjectTarget; readonly edits: Gen3MonEdits }[],
  staged?: readonly StagedMonRefGen3[],
): Uint8Array | ComposeError {
  let current = save;
  for (let i = 0; i < patches.length; i++) {
    const p = patches[i]!;
    const result = patchSlotInSave(current, p.target, p.edits);
    if (isGen3PatchError(result)) {
      return {
        kind: 'compose_error',
        reason: 'GEN3_PATCH_FAILED',
        underlying: result,
        patchIndex: i,
      };
    }
    current = result;
  }
  if (staged && staged.length > 0) {
    for (let i = 0; i < staged.length; i++) {
      const s = staged[i]!;
      const result = injectIntoSave(current, s.target, s.bytes);
      if (isGen3InjectError(result)) {
        return {
          kind: 'compose_error',
          reason: 'GEN3_INJECT_FAILED',
          underlying: result,
          stagedIndex: i,
        };
      }
      current = result;
    }
  }
  return new Uint8Array(current.bytes);
}
