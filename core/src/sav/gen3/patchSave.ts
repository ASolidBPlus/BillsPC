/**
 * S10 — `patchSlotInSave`: save-level patch orchestrator. Mirrors
 * `injectIntoSave` but inverts the occupancy check (REQUIRES `filled`,
 * returns `EMPTY_SLOT` otherwise — the patch target, by definition, is
 * a real mon you're correcting).
 *
 * Per PLAN §3.3 + RA-1 #1: this is a NEW function. `injectIntoSave`'s
 * "refuse occupied" contract is sacred and untouched. The save-level
 * compose path lives in a separate composer (`composeDestinationPatchWrite`).
 */

import { writeU16LE } from '../../pack/leBytes.js';
import { gen3SectorChecksum } from './checksum.js';
import { PCBUFFER_BOX_COUNT, PCBUFFER_SLOTS_PER_BOX, SECTOR_CHECKSUM_OFFSET } from './format.js';
import { writePcBoxSlot } from './boxes.js';
import { parseGen3Save, type Gen3SaveContents, isGen3SaveError } from './parseSave.js';
import {
  patchGen3Slot,
  type Gen3MonEdits,
  type Gen3PatchError,
  type Gen3PatchErrorReason,
  isGen3PatchError,
} from './patchMon.js';
import type { InjectTarget } from './injectMon.js';

function err(reason: Gen3PatchErrorReason, message: string): Gen3PatchError {
  return { kind: 'gen3_patch_error', reason, message };
}

/**
 * Apply a manual edit to a single PC slot in the active save slot.
 * Returns a refreshed `Gen3SaveContents` (re-parsed) on success or a
 * tagged `Gen3PatchError` on failure. Input save is never mutated.
 */
export function patchSlotInSave(
  save: Gen3SaveContents,
  target: InjectTarget,
  edits: Gen3MonEdits,
): Gen3SaveContents | Gen3PatchError {
  // 1. Range check (mirrors injectMon.ts:111-124).
  const { boxIndex, slot } = target;
  if (
    !Number.isInteger(boxIndex) ||
    boxIndex < 0 ||
    boxIndex >= PCBUFFER_BOX_COUNT ||
    !Number.isInteger(slot) ||
    slot < 0 ||
    slot >= PCBUFFER_SLOTS_PER_BOX
  ) {
    return err(
      'BAD_TARGET',
      `patchSlotInSave: (box=${boxIndex}, slot=${slot}) outside [0..${PCBUFFER_BOX_COUNT}) × [0..${PCBUFFER_SLOTS_PER_BOX})`,
    );
  }

  // 2. Slot must be FILLED (the inversion of injectMon.ts:130-134).
  const targetSlot = save.pc.boxes[boxIndex]?.[slot];
  if (!targetSlot) {
    return err('BAD_TARGET', 'patchSlotInSave: target slot lookup returned undefined');
  }
  if (targetSlot.kind !== 'filled') {
    return err(
      'EMPTY_SLOT',
      `patchSlotInSave: box ${boxIndex} slot ${slot} is empty; refuse to patch a non-existent mon.`,
    );
  }

  // 3. Patch the 80-byte payload.
  const patched = patchGen3Slot(targetSlot.bytes, edits);
  if (isGen3PatchError(patched)) return patched;

  // 4. Write back into the save buffer (mirrors injectMon.ts:137-142).
  let writeResult: ReturnType<typeof writePcBoxSlot>;
  try {
    writeResult = writePcBoxSlot(save.bytes, save.active, boxIndex, slot, patched);
  } catch (e) {
    return err('INTERNAL', `writePcBoxSlot failed: ${(e as Error).message}`);
  }

  // 5. Recompute checksums on touched sectors (mirrors injectMon.ts:144-152).
  // The boundary-straddle case (slot 19 of any box) touches TWO sectors;
  // both checksums get recomputed because writePcBoxSlot returns the full
  // touched-sector list.
  const out = writeResult.modifiedSaveBytes;
  for (const sectorId of writeResult.touchedSectorIds) {
    const entry = save.active.sectorOrder.get(sectorId);
    if (!entry) {
      return err('INTERNAL', `touched sector ${sectorId} missing from active sector map`);
    }
    const checksum = gen3SectorChecksum(out, entry.diskOffset, sectorId);
    writeU16LE(out, entry.diskOffset + SECTOR_CHECKSUM_OFFSET, checksum);
  }

  // 6. Re-parse to refresh the view (mirrors injectMon.ts:153-161).
  const reparsed = parseGen3Save(out);
  if (isGen3SaveError(reparsed)) {
    return err(
      'INTERNAL',
      `re-parse of patched save failed: ${reparsed.reason}: ${reparsed.message}`,
    );
  }
  return reparsed;
}

export { isGen3PatchError } from './patchMon.js';
export type { Gen3PatchError, Gen3PatchErrorReason, Gen3MonEdits } from './patchMon.js';
