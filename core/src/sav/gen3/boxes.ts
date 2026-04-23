/**
 * Gen 3 PC box reader / writer.
 *
 * The PC buffer is a logical 33744-byte blob spanning sectors 5..13. The
 * first 8 sectors (5..12) each contribute a full 3968-byte body; sector
 * 13 contributes the remaining 2000 bytes. We assemble it on read,
 * slice-and-dice the 14×30 grid, and reverse-map mutations back to the
 * disk slots they came from.
 *
 * Per PLAN_EVAL A5: empty-slot detection uses **species == 0 after
 * decryption**, NOT all-zero pre-decrypt. The game leaves stale PID/OT
 * bytes when the player deposits-then-withdraws, so the all-zero rule
 * incorrectly flags those slots as occupied.
 *
 * Per PLAN_EVAL A13: a slot whose 80-byte range straddles a sector
 * boundary writes into TWO sectors. The writer returns the touched
 * sector ID list so the inject orchestrator knows which footers to
 * recompute.
 */

import { readU32LE, readU16LE, writeU32LE } from '../../pack/leBytes.js';
import { decryptBlock, makeOtFull } from '../../pack/gen3Crypt.js';
import { unshuffleSubstructures } from '../../pack/gen3Shuffle.js';
import {
  PCBUFFER_BOX_COUNT,
  PCBUFFER_BOX_DATA_OFFSET,
  PCBUFFER_BOX_NAMES_OFFSET,
  PCBUFFER_BOX_NAME_BYTES,
  PCBUFFER_FIRST_SECTOR,
  PCBUFFER_LAST_SECTOR,
  PCBUFFER_SLOT_BYTES,
  PCBUFFER_SLOTS_PER_BOX,
  PCBUFFER_TOTAL_BYTES,
  PCBUFFER_WALLPAPERS_OFFSET,
  SECTOR_BODY_DEFAULT,
} from './format.js';
import type { ActiveSlot, SectorEntry } from './sectors.js';

export type BoxedSlot =
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'filled';
      /** Encrypted 80-byte wire record. Inject re-uses these bytes verbatim. */
      readonly bytes: Uint8Array;
      /** Decoded species id (1..386) — convenience for UI rendering. */
      readonly species: number;
    };

export interface PcBoxBlock {
  readonly currentBox: number;
  readonly boxes: ReadonlyArray<ReadonlyArray<BoxedSlot>>;
  /** 126-byte raw box-names blob (14 × 9 bytes). Caller decodes via charmap3. */
  readonly boxNamesRaw: Uint8Array;
  /** 14-byte wallpapers blob. Read-only — we never mutate. */
  readonly wallpapersRaw: Uint8Array;
}

/**
 * Concatenate the active slot's PC sectors into a logical 33744-byte
 * buffer.
 *
 * Sector 13 only contributes its first 2000 bytes; the trailing 1968
 * bytes of its 3968-byte body are unused-by-PC-buffer padding (still in
 * checksum, but not modelled here).
 */
export function assemblePcBuffer(bytes: Uint8Array, active: ActiveSlot): Uint8Array {
  const out = new Uint8Array(PCBUFFER_TOTAL_BYTES);
  let cursor = 0;
  for (let sid = PCBUFFER_FIRST_SECTOR; sid <= PCBUFFER_LAST_SECTOR; sid++) {
    const entry = active.sectorOrder.get(sid);
    if (!entry) {
      throw new Error(`assemblePcBuffer: missing sector ${sid} in active slot`);
    }
    const remaining = PCBUFFER_TOTAL_BYTES - cursor;
    const take = Math.min(SECTOR_BODY_DEFAULT, remaining);
    out.set(bytes.subarray(entry.diskOffset, entry.diskOffset + take), cursor);
    cursor += take;
    if (cursor >= PCBUFFER_TOTAL_BYTES) break;
  }
  return out;
}

/** Lightweight tooltip-shaped summary for a boxed slot. */
export interface SlotSummary {
  readonly species: number;
  readonly nicknameBytes: Uint8Array; // 10 bytes raw — caller decodes via charmap3 (EN or JP)
  readonly otNameBytes: Uint8Array; // 7 bytes raw — same charmap as nickname
  readonly tid: number;
  readonly sid: number;
  readonly heldItem: number;
  readonly exp: number;
  readonly shiny: boolean;
}

/**
 * Decrypt + unshuffle a Gen 3 boxed slot and pull out the fields that
 * fit a hover-tooltip view. Returns null for empty/garbage slots.
 *
 * Shiny: TID ^ SID ^ pid_high ^ pid_low has its low 3 bits == 0.
 */
export function decodeSlotSummary(slot: Uint8Array): SlotSummary | null {
  if (slot.length !== PCBUFFER_SLOT_BYTES) return null;
  const species = decodeSlotSpecies(slot);
  if (species === 0) return null;
  const pid = readU32LE(slot, 0);
  const tid = readU16LE(slot, 4);
  const sid = readU16LE(slot, 6);
  const nicknameBytes = slot.slice(8, 18);
  const otNameBytes = slot.slice(20, 27);
  const cipher = slot.slice(32, 80);
  const wire = decryptBlock(cipher, pid, makeOtFull(tid, sid));
  let g: Uint8Array;
  let a: Uint8Array;
  try {
    [g, a] = unshuffleSubstructures(wire, pid);
  } catch {
    return null;
  }
  void a;
  // Growth substructure: species(2), heldItem(2), exp(4), ppBonuses(1), friendship(1)
  const heldItem = readU16LE(g, 2);
  const exp = readU32LE(g, 4);
  const pidHigh = (pid >>> 16) & 0xffff;
  const pidLow = pid & 0xffff;
  const shiny = ((tid ^ sid ^ pidHigh ^ pidLow) & 0x07) === 0;
  return { species, nicknameBytes, otNameBytes, tid, sid, heldItem, exp, shiny };
}

/** Read the species field from a (possibly stale) 80-byte slot. */
export function decodeSlotSpecies(slot: Uint8Array): number {
  if (slot.length !== PCBUFFER_SLOT_BYTES) {
    throw new RangeError(
      `decodeSlotSpecies: expected ${PCBUFFER_SLOT_BYTES} bytes, got ${slot.length}`,
    );
  }
  // Fast path: a truly-empty slot has all-zero header and all-zero
  // ciphertext. Decrypting all-zero with key=0 still gives species=0,
  // but skipping the decrypt is cheaper.
  let allZero = true;
  for (let i = 0; i < PCBUFFER_SLOT_BYTES; i++) {
    if (slot[i] !== 0) {
      allZero = false;
      break;
    }
  }
  if (allZero) return 0;
  const pid = readU32LE(slot, 0);
  const tid = readU16LE(slot, 4);
  const sid = readU16LE(slot, 6);
  const cipher = slot.slice(32, 80);
  const wire = decryptBlock(cipher, pid, makeOtFull(tid, sid));
  let g: Uint8Array;
  try {
    [g] = unshuffleSubstructures(wire, pid);
  } catch {
    // Out-of-range PID%24 — treat as empty/garbage so we don't refuse the inject.
    return 0;
  }
  return readU16LE(g, 0);
}

/**
 * Parse a 33744-byte PC buffer into the 14×30 grid plus the box-names
 * blob. Each slot is classified by post-decrypt species (per A5).
 */
export function parsePcBuffer(pcBuffer: Uint8Array): PcBoxBlock {
  if (pcBuffer.length !== PCBUFFER_TOTAL_BYTES) {
    throw new RangeError(
      `parsePcBuffer: expected ${PCBUFFER_TOTAL_BYTES} bytes, got ${pcBuffer.length}`,
    );
  }
  const currentBox = readU32LE(pcBuffer, 0);
  const boxes: BoxedSlot[][] = [];
  for (let b = 0; b < PCBUFFER_BOX_COUNT; b++) {
    const slots: BoxedSlot[] = [];
    for (let s = 0; s < PCBUFFER_SLOTS_PER_BOX; s++) {
      const off =
        PCBUFFER_BOX_DATA_OFFSET +
        b * PCBUFFER_SLOTS_PER_BOX * PCBUFFER_SLOT_BYTES +
        s * PCBUFFER_SLOT_BYTES;
      const slot = pcBuffer.slice(off, off + PCBUFFER_SLOT_BYTES);
      const species = decodeSlotSpecies(slot);
      if (species === 0) {
        slots.push({ kind: 'empty' });
      } else {
        slots.push({ kind: 'filled', bytes: slot, species });
      }
    }
    boxes.push(slots);
  }
  const boxNamesRaw = pcBuffer.slice(
    PCBUFFER_BOX_NAMES_OFFSET,
    PCBUFFER_BOX_NAMES_OFFSET + PCBUFFER_BOX_COUNT * PCBUFFER_BOX_NAME_BYTES,
  );
  const wallpapersRaw = pcBuffer.slice(
    PCBUFFER_WALLPAPERS_OFFSET,
    PCBUFFER_WALLPAPERS_OFFSET + PCBUFFER_BOX_COUNT,
  );
  return { currentBox, boxes, boxNamesRaw, wallpapersRaw };
}

/**
 * Map a logical PC offset to (sectorSemanticId, inSectorOffset).
 *
 * Sectors 5..12 hold logical bytes [0..3968), [3968..7936) and so on;
 * sector 13 holds the final 2000 bytes (logical [31744..33744)).
 */
export function pcLogicalToSector(logicalOffset: number): {
  sectorSemanticId: number;
  inSectorOffset: number;
} {
  if (logicalOffset < 0 || logicalOffset >= PCBUFFER_TOTAL_BYTES) {
    throw new RangeError(`pcLogicalToSector: offset out of range: ${logicalOffset}`);
  }
  const sectorIdx = Math.floor(logicalOffset / SECTOR_BODY_DEFAULT);
  const sectorSemanticId = PCBUFFER_FIRST_SECTOR + sectorIdx;
  const inSectorOffset = logicalOffset - sectorIdx * SECTOR_BODY_DEFAULT;
  return { sectorSemanticId, inSectorOffset };
}

/**
 * Compute the logical PC offset of (boxIndex, slotIndex). Caller is
 * expected to validate ranges.
 */
export function slotLogicalOffset(boxIndex: number, slotIndex: number): number {
  return (
    PCBUFFER_BOX_DATA_OFFSET +
    boxIndex * PCBUFFER_SLOTS_PER_BOX * PCBUFFER_SLOT_BYTES +
    slotIndex * PCBUFFER_SLOT_BYTES
  );
}

export interface SlotWriteResult {
  /** A NEW save buffer with the slot bytes written. Original is untouched. */
  readonly modifiedSaveBytes: Uint8Array;
  /** Semantic sector_ids whose body was modified — checksums must be recomputed. */
  readonly touchedSectorIds: readonly number[];
}

/**
 * Write the 80-byte slot into the active slot's PC region. Per A13 the
 * write may straddle a sector boundary, in which case TWO sectors are
 * touched and both checksums need recompute.
 *
 * The save buffer is cloned defensively — the input is never mutated.
 */
export function writePcBoxSlot(
  saveBytes: Uint8Array,
  active: ActiveSlot,
  boxIndex: number,
  slotIndex: number,
  slotBytes: Uint8Array,
): SlotWriteResult {
  if (slotBytes.length !== PCBUFFER_SLOT_BYTES) {
    throw new RangeError(
      `writePcBoxSlot: expected ${PCBUFFER_SLOT_BYTES}-byte slot, got ${slotBytes.length}`,
    );
  }
  const out = new Uint8Array(saveBytes); // defensive clone
  const startLogical = slotLogicalOffset(boxIndex, slotIndex);
  const endLogical = startLogical + PCBUFFER_SLOT_BYTES;
  const touched = new Set<number>();
  let logicalCursor = startLogical;
  let payloadCursor = 0;
  while (logicalCursor < endLogical) {
    const { sectorSemanticId, inSectorOffset } = pcLogicalToSector(logicalCursor);
    const entry = active.sectorOrder.get(sectorSemanticId);
    if (!entry) {
      throw new Error(`writePcBoxSlot: missing sector ${sectorSemanticId} in active slot map`);
    }
    const sectorRemaining = SECTOR_BODY_DEFAULT - inSectorOffset;
    const payloadRemaining = endLogical - logicalCursor;
    const chunk = Math.min(sectorRemaining, payloadRemaining);
    out.set(
      slotBytes.subarray(payloadCursor, payloadCursor + chunk),
      entry.diskOffset + inSectorOffset,
    );
    touched.add(sectorSemanticId);
    logicalCursor += chunk;
    payloadCursor += chunk;
  }
  return { modifiedSaveBytes: out, touchedSectorIds: Array.from(touched).sort((a, b) => a - b) };
}

/** Re-export for callers. */
export { PCBUFFER_BOX_COUNT, PCBUFFER_SLOTS_PER_BOX, PCBUFFER_SLOT_BYTES };
export type { SectorEntry };

/** Convenience: produce a u32 LE write of currentBox at logical offset 0. Not used by inject (we never modify currentBox), but exposed for completeness. */
export function writeCurrentBox(pcBuffer: Uint8Array, value: number): void {
  writeU32LE(pcBuffer, 0, value);
}
