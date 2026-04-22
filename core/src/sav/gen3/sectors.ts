/**
 * Sector layout discovery: walk a save buffer, locate both slots, decide
 * which is "active" (highest save_index, treating 0xFFFFFFFF as
 * uninitialised), and build a `semanticId → diskOffset` map for the
 * active slot.
 *
 * Per PLAN_EVAL A6: support BOTH 128 KB (dual-slot) and 64 KB
 * (single-slot) saves. The single-slot case has only Slot A; the inactive
 * slot does not exist.
 *
 * Sector rotation:
 *   The 14 sectors of a slot are stored on disk in rotated order.
 *   At save_index N, the sector with semantic_id S sits at physical
 *   position ((S - (N % 14) + 14) % 14) within the slot. Equivalently,
 *   walking sectors 0..13 of a slot in disk order yields sector_ids
 *   (N%14)..(N%14 + 13) mod 14.
 *
 * `findActiveSlot` does NOT assume the rotation is intact — it reads the
 * `sector_id` from each disk sector and builds the map empirically. This
 * tolerates corrupt rotations and matches PKHeX's behaviour.
 */

import { readU16LE, readU32LE } from '../../pack/leBytes.js';
import {
  SECTOR_ID_OFFSET,
  SECTOR_SAVE_INDEX_OFFSET,
  SECTOR_SIGNATURE,
  SECTOR_SIGNATURE_OFFSET,
  SECTOR_SIZE,
  SECTORS_PER_SLOT,
  SLOT_A_OFFSET,
  SLOT_B_OFFSET,
  SAVE_BYTES_FULL,
  SAVE_BYTES_SINGLE,
} from './format.js';
import { gen3SectorChecksum } from './checksum.js';

export interface SectorEntry {
  readonly semanticId: number; // 0..13
  readonly diskOffset: number; // absolute byte offset in the save buffer
  readonly storedChecksum: number;
  readonly checksumValid: boolean;
}

export interface ActiveSlot {
  readonly slotIndex: 0 | 1;
  readonly slotOffset: number;
  readonly saveIndex: number;
  /** Map: semantic_id → SectorEntry. Always contains 14 entries on success. */
  readonly sectorOrder: ReadonlyMap<number, SectorEntry>;
  /** True iff every active-slot sector's stored checksum matches recomputation. */
  readonly checksumsValid: boolean;
  /** True iff the save buffer is the 64 KB single-slot variant. */
  readonly singleSlot: boolean;
  /** Offset of the inactive slot (or null if single-slot). */
  readonly inactiveSlotOffset: number | null;
}

interface SlotSummary {
  readonly base: number;
  readonly index: 0 | 1;
  readonly saveIndex: number; // -1 if uninitialised (0xFFFFFFFF)
  readonly sectorOrder: ReadonlyMap<number, SectorEntry>;
  readonly valid: boolean;
}

function summariseSlot(bytes: Uint8Array, slotBase: number, slotIndex: 0 | 1): SlotSummary {
  const order = new Map<number, SectorEntry>();
  let sigOk = true;
  let sec0Idx = -1;
  for (let i = 0; i < SECTORS_PER_SLOT; i++) {
    const off = slotBase + i * SECTOR_SIZE;
    const sid = readU16LE(bytes, off + SECTOR_ID_OFFSET);
    const sig = readU32LE(bytes, off + SECTOR_SIGNATURE_OFFSET);
    if (sig !== SECTOR_SIGNATURE) {
      sigOk = false;
    }
    if (sid > 13) {
      sigOk = false;
      continue;
    }
    if (order.has(sid)) {
      // Duplicate sector_id within a slot — corrupt rotation. Mark invalid.
      sigOk = false;
      continue;
    }
    const stored = readU16LE(bytes, off + 0x0ff6);
    const computed = gen3SectorChecksum(bytes, off, sid);
    order.set(sid, {
      semanticId: sid,
      diskOffset: off,
      storedChecksum: stored,
      checksumValid: stored === computed,
    });
    if (sid === 0) {
      const idxRaw = readU32LE(bytes, off + SECTOR_SAVE_INDEX_OFFSET);
      sec0Idx = idxRaw === 0xffffffff ? -1 : idxRaw;
    }
  }
  // Need all 14 unique sector IDs to be valid.
  const haveAll = order.size === SECTORS_PER_SLOT;
  return {
    base: slotBase,
    index: slotIndex,
    saveIndex: sec0Idx,
    sectorOrder: order,
    valid: haveAll && sigOk && sec0Idx >= 0,
  };
}

/**
 * Discover which slot is active and return its sector map. Throws if no
 * valid slot can be located — callers should treat that as an
 * UNRECOGNIZED_FORMAT error.
 */
export function findActiveSlot(bytes: Uint8Array): ActiveSlot {
  const isSingle = bytes.length === SAVE_BYTES_SINGLE;
  if (!isSingle && bytes.length !== SAVE_BYTES_FULL) {
    throw new RangeError(
      `findActiveSlot: expected ${SAVE_BYTES_FULL} or ${SAVE_BYTES_SINGLE} bytes, got ${bytes.length}`,
    );
  }
  const summaries: SlotSummary[] = [];
  summaries.push(summariseSlot(bytes, SLOT_A_OFFSET, 0));
  if (!isSingle) {
    summaries.push(summariseSlot(bytes, SLOT_B_OFFSET, 1));
  }
  // Pick the valid slot with the highest save_index. If both invalid, throw.
  const validSummaries = summaries.filter((s) => s.valid);
  if (validSummaries.length === 0) {
    throw new Error('No valid Gen 3 save slot found (both slots failed structural checks).');
  }
  validSummaries.sort((a, b) => b.saveIndex - a.saveIndex);
  const active = validSummaries[0]!;
  const checksumsValid = Array.from(active.sectorOrder.values()).every((e) => e.checksumValid);
  const inactiveOffset = isSingle ? null : active.index === 0 ? SLOT_B_OFFSET : SLOT_A_OFFSET;
  return {
    slotIndex: active.index,
    slotOffset: active.base,
    saveIndex: active.saveIndex,
    sectorOrder: active.sectorOrder,
    checksumsValid,
    singleSlot: isSingle,
    inactiveSlotOffset: inactiveOffset,
  };
}

/**
 * Verify rotation: walking disk-order sectors should yield sector_ids
 * `(saveIndex % 14)..(saveIndex % 14 + 13) mod 14`. Used by tests to
 * pin down the rotation invariant.
 */
export function expectedRotation(saveIndex: number, slotBase: number, diskPos: number): number {
  // semantic_id of sector at physical position diskPos
  void slotBase;
  const offset = saveIndex % SECTORS_PER_SLOT;
  return (diskPos + offset) % SECTORS_PER_SLOT;
}

export { SECTORS_PER_SLOT };
