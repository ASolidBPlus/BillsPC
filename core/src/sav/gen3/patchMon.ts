/**
 * S10 — `patchGen3Slot`: thin wrapper over `unpackBoxed → mutate →
 * packBoxed`.
 *
 * Per PLAN_EVAL §5: `packBoxed` recomputes the inner checksum
 * (`boxed.ts:118`) and re-derives the encryption key from `(pid ^
 * otFull)` (`boxed.ts:120-122`) on every call, so PID/TID/SID rewrites
 * propagate for free. No new crypto.
 *
 * Manual nature/abilitySlot edits aren't supported here — those are
 * PID-derived. The modal is responsible for any PID search; by the
 * time `Gen3MonEdits` lands here the PID encodes whatever nature /
 * ability the user wanted (or doesn't, per D6 click-through).
 */

import { unpackBoxed, packBoxed, BOXED_SIZE } from '../../pack/boxed.js';
import { isDecodeError } from '../../pack/decodeError.js';
import { encodeGen3 } from '../../data/charmap3.js';

export interface Gen3MonEdits {
  readonly pid?: number;
  readonly tid?: number;
  readonly sid?: number;
  readonly ivs?: {
    readonly hp?: number;
    readonly atk?: number;
    readonly def?: number;
    readonly spa?: number;
    readonly spd?: number;
    readonly spe?: number;
  };
  readonly otName?: string;
}

export type Gen3PatchErrorReason = 'BAD_TARGET' | 'EMPTY_SLOT' | 'DECODE_FAILED' | 'INTERNAL';

export interface Gen3PatchError {
  readonly kind: 'gen3_patch_error';
  readonly reason: Gen3PatchErrorReason;
  readonly message: string;
}

export function isGen3PatchError(x: unknown): x is Gen3PatchError {
  return (
    typeof x === 'object' && x !== null && (x as { kind?: string }).kind === 'gen3_patch_error'
  );
}

function err(reason: Gen3PatchErrorReason, message: string): Gen3PatchError {
  return { kind: 'gen3_patch_error', reason, message };
}

const U16_MAX = 0xffff;
const IV_MAX = 31;

function clampU16(v: number): number {
  return v & U16_MAX;
}
function clampU32(v: number): number {
  return v >>> 0;
}
function clampIv(v: number): number {
  if (v < 0) return 0;
  if (v > IV_MAX) return IV_MAX;
  return v | 0;
}

/**
 * Apply manual edits to an 80-byte Gen 3 PC slot record. Returns the
 * fully-encrypted, fully-checksummed 80-byte output, or a tagged
 * `Gen3PatchError`.
 *
 * `slotBytes` MUST already be a real Gen 3 slot (decryptable, species
 * != 0). Per RA-1, the save-level `patchSlotInSave` enforces this
 * upstream.
 */
export function patchGen3Slot(
  slotBytes: Uint8Array,
  edits: Gen3MonEdits,
): Uint8Array | Gen3PatchError {
  if (slotBytes.length !== BOXED_SIZE) {
    return err('INTERNAL', `patchGen3Slot: expected ${BOXED_SIZE} bytes, got ${slotBytes.length}`);
  }
  // Patch mode targets are real on-cart mons, not S1 outputs — pass
  // permissive so ribbons/obedience/non-FireRed origin/etc don't reject.
  const unpacked = unpackBoxed(slotBytes, { permissive: true });
  if (isDecodeError(unpacked)) {
    return err(
      'DECODE_FAILED',
      `patchGen3Slot: unpack failed: ${unpacked.reason}: ${unpacked.message}`,
    );
  }

  const next = { ...unpacked };
  if (edits.pid !== undefined) next.pid = clampU32(edits.pid);
  if (edits.tid !== undefined) next.tid = clampU16(edits.tid);
  if (edits.sid !== undefined) next.sid = clampU16(edits.sid);
  if (edits.ivs) {
    next.ivs = {
      hp: edits.ivs.hp !== undefined ? clampIv(edits.ivs.hp) : unpacked.ivs.hp,
      atk: edits.ivs.atk !== undefined ? clampIv(edits.ivs.atk) : unpacked.ivs.atk,
      def: edits.ivs.def !== undefined ? clampIv(edits.ivs.def) : unpacked.ivs.def,
      spa: edits.ivs.spa !== undefined ? clampIv(edits.ivs.spa) : unpacked.ivs.spa,
      spd: edits.ivs.spd !== undefined ? clampIv(edits.ivs.spd) : unpacked.ivs.spd,
      spe: edits.ivs.spe !== undefined ? clampIv(edits.ivs.spe) : unpacked.ivs.spe,
    };
  }
  if (edits.otName !== undefined) {
    // Re-encode through the Gen 3 charmap. Unmappable chars become '?'
    // (per the editValidate round-trip; the modal warns user upstream).
    const encoded = encodeGen3(edits.otName);
    next.otName = encoded;
  }

  try {
    return packBoxed(next);
  } catch (e) {
    return err('INTERNAL', `patchGen3Slot: packBoxed threw: ${(e as Error).message}`);
  }
}
