/**
 * Save-level inject orchestrator.
 *
 * Algorithm (per PLAN §5.9 + PLAN_EVAL A4, A11, A13):
 *   1. Validate payload size (80 bytes) → BAD_PAYLOAD_SIZE.
 *   2. Validate the payload is a real Gen 3 mon (decryptable, species != 0,
 *      species ≤ 386) → PAYLOAD_NOT_A_MON.
 *   3. Validate target box/slot range → OUT_OF_RANGE.
 *   4. If target slot is `filled`, refuse → SLOT_OCCUPIED.
 *   5. Write the 80 bytes into the active slot's PC region. The write may
 *      straddle a sector boundary; both touched sectors are tracked.
 *   6. Recompute checksum on every touched sector (using the per-sector
 *      body size — sector 0 uses 3884, but we never touch sector 0 here).
 *   7. Re-parse the modified buffer to produce the returned
 *      Gen3SaveContents (cheap; guarantees internal consistency).
 *
 * Writeback policy (per PLAN_EVAL A4):
 *   - Write back to the SAME active slot at the SAME save_index. The
 *     inactive slot is byte-identical pre/post inject. This matches the
 *     file we read; the player's next in-game save will rotate slots
 *     normally and the injected mon will be carried into the next active
 *     slot via PC RAM.
 *   - Known limitation: if the active slot had save_index === 0xFFFFFFFE
 *     and the inactive slot was 0xFFFFFFFF, the next in-game boot will
 *     read the wrong slot. We do NOT guard this case; a future sprint
 *     can revisit.
 *
 * Section 0 (TrainerInfo) is byte-identical pre/post inject — we never
 * write into sectors 0..4. The inject test asserts this directly.
 */

import { writeU16LE } from '../../pack/leBytes.js';
import { gen3SectorChecksum } from './checksum.js';
import {
  PCBUFFER_BOX_COUNT,
  PCBUFFER_SLOTS_PER_BOX,
  PCBUFFER_SLOT_BYTES,
  SECTOR_CHECKSUM_OFFSET,
} from './format.js';
import { decodeSlotSpecies, writePcBoxSlot } from './boxes.js';
import {
  parseGen3Save,
  type Gen3SaveContents,
  type Gen3SaveError,
  isGen3SaveError,
} from './parseSave.js';

export type Gen3InjectErrorReason =
  | 'BAD_PAYLOAD_SIZE'
  | 'PAYLOAD_NOT_A_MON'
  | 'OUT_OF_RANGE'
  | 'SLOT_OCCUPIED'
  | 'INTERNAL';

export interface Gen3InjectError {
  readonly kind: 'gen3_inject_error';
  readonly reason: Gen3InjectErrorReason;
  readonly message: string;
}

export interface InjectTarget {
  readonly boxIndex: number; // 0..13
  readonly slot: number; // 0..29
}

const SPECIES_MAX = 386;

function err(reason: Gen3InjectErrorReason, message: string): Gen3InjectError {
  return { kind: 'gen3_inject_error', reason, message };
}

export function isGen3InjectError(x: { kind?: string } | unknown): x is Gen3InjectError {
  return (x as { kind?: string }).kind === 'gen3_inject_error';
}

/**
 * Inject a packed 80-byte Gen 3 mon into the active slot's PC at
 * (boxIndex, slotIndex). Returns a refreshed `Gen3SaveContents` whose
 * `bytes` field is the mutated save buffer with recomputed checksums.
 *
 * On any failure, returns a tagged `Gen3InjectError` and the input save
 * is unmodified.
 */
export function injectIntoSave(
  save: Gen3SaveContents,
  target: InjectTarget,
  monBytes: Uint8Array,
): Gen3SaveContents | Gen3InjectError {
  // 1. Payload size.
  if (monBytes.length !== PCBUFFER_SLOT_BYTES) {
    return err(
      'BAD_PAYLOAD_SIZE',
      `injectIntoSave: payload must be ${PCBUFFER_SLOT_BYTES} bytes, got ${monBytes.length}`,
    );
  }
  // 2. Payload must decode to a real species.
  const species = decodeSlotSpecies(monBytes);
  if (species === 0) {
    return err(
      'PAYLOAD_NOT_A_MON',
      'injectIntoSave: payload decrypts to species 0 (empty/garbage); refuse to inject.',
    );
  }
  if (species > SPECIES_MAX) {
    return err(
      'PAYLOAD_NOT_A_MON',
      `injectIntoSave: payload decrypts to species ${species}, outside Gen 3 range 1..${SPECIES_MAX}.`,
    );
  }
  // 3. Range checks.
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
      'OUT_OF_RANGE',
      `injectIntoSave: (box=${boxIndex}, slot=${slot}) outside [0..${PCBUFFER_BOX_COUNT}) × [0..${PCBUFFER_SLOTS_PER_BOX})`,
    );
  }
  // 4. Slot must be empty.
  const targetSlot = save.pc.boxes[boxIndex]?.[slot];
  if (!targetSlot) {
    return err('OUT_OF_RANGE', 'injectIntoSave: target slot lookup returned undefined');
  }
  if (targetSlot.kind === 'filled') {
    return err(
      'SLOT_OCCUPIED',
      `injectIntoSave: box ${boxIndex} slot ${slot} is occupied (species ${targetSlot.species}); refuse to overwrite.`,
    );
  }
  // 5. Write the slot.
  let writeResult: ReturnType<typeof writePcBoxSlot>;
  try {
    writeResult = writePcBoxSlot(save.bytes, save.active, boxIndex, slot, monBytes);
  } catch (e) {
    return err('INTERNAL', `writePcBoxSlot failed: ${(e as Error).message}`);
  }
  // 6. Recompute checksums on touched sectors.
  const out = writeResult.modifiedSaveBytes;
  for (const sectorId of writeResult.touchedSectorIds) {
    const entry = save.active.sectorOrder.get(sectorId);
    if (!entry) {
      return err('INTERNAL', `touched sector ${sectorId} missing from active sector map`);
    }
    const checksum = gen3SectorChecksum(out, entry.diskOffset, sectorId);
    writeU16LE(out, entry.diskOffset + SECTOR_CHECKSUM_OFFSET, checksum);
  }
  // 7. Re-parse to refresh the view.
  const reparsed = parseGen3Save(out);
  if (isGen3SaveError(reparsed)) {
    return err(
      'INTERNAL',
      `re-parse of modified save failed: ${reparsed.reason}: ${reparsed.message}`,
    );
  }
  return reparsed;
}

export type { Gen3SaveContents, Gen3SaveError };
