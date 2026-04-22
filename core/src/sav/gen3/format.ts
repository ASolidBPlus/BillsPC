/**
 * Sprint 6a: Gen 3 save format constants + autodetect.
 *
 * Per PLAN_EVAL A1: only sector 0 (TrainerInfo, read-only) and sectors
 * 5..13 (PC buffer, the only sectors we WRITE) are modelled. Sectors 1..4
 * differ in layout between R/S, Emerald, and FR/LG and are intentionally
 * not modelled — we touch nothing there.
 *
 * Per PLAN_EVAL A2: discriminate via the gameCode u32 at sector-0 body
 * offset 0xAC:
 *   gameCode == 0 → RUBY (or SAPPHIRE; we cannot distinguish further
 *                   without flag-byte inspection that S6a doesn't need)
 *   gameCode == 1 → FIRERED (or LEAFGREEN; same caveat)
 *   else          → EMERALD (its 0xAC field holds an encrypted security
 *                   key, never 0/1)
 *
 * Per PLAN_EVAL A3: sector 0 uses **3884** bytes for its checksum,
 * sectors 1..13 use **3968**. Get this wrong on a non-fresh save and the
 * round-trip identity test fails immediately on TrainerInfo.
 *
 * Per PLAN_EVAL A6: accept BOTH 128 KB (dual-slot) and 64 KB (single-slot)
 * Gen 3 saves. mGBA's flash512 mode + some bootleg carts produce 64 KB.
 *
 * Per orchestrator decision Q1: only Ruby/Emerald/FireRed have fixtures;
 * Sapphire and LeafGreen share decode logic with Ruby and FireRed
 * respectively (same per-game-family layout, same security_key location)
 * but get no fixture-backed tests in S6a.
 */

import { readU32LE } from '../../pack/leBytes.js';

export type SaveFormat3 = 'RUBY' | 'SAPPHIRE' | 'EMERALD' | 'FIRERED' | 'LEAFGREEN';

/** Detect-equivalent group — inject behaviour is identical within a group. */
export type Gen3Family = 'RS' | 'EMERALD' | 'FRLG';

export const SECTOR_SIZE = 4096 as const;
export const SECTORS_PER_SLOT = 14 as const;
export const SLOT_BYTES = SECTOR_SIZE * SECTORS_PER_SLOT; // 0xE000

export const SLOT_A_OFFSET = 0x00000 as const;
export const SLOT_B_OFFSET = 0x0e000 as const;

export const SECTOR_BODY_TRAINER = 3884 as const; // sector_id 0 checksum range
export const SECTOR_BODY_DEFAULT = 3968 as const; // sector_id 1..13 checksum range

export const SECTOR_FOOTER_OFFSET = 0x0ff4 as const;
export const SECTOR_ID_OFFSET = 0x0ff4 as const;
export const SECTOR_CHECKSUM_OFFSET = 0x0ff6 as const;
export const SECTOR_SIGNATURE_OFFSET = 0x0ff8 as const;
export const SECTOR_SAVE_INDEX_OFFSET = 0x0ffc as const;

export const SECTOR_SIGNATURE = 0x08012025 as const;

export const PCBUFFER_FIRST_SECTOR = 5 as const;
export const PCBUFFER_LAST_SECTOR = 13 as const;
export const PCBUFFER_TOTAL_BYTES = 33744 as const;
export const PCBUFFER_BOX_COUNT = 14 as const;
export const PCBUFFER_SLOTS_PER_BOX = 30 as const;
export const PCBUFFER_SLOT_BYTES = 80 as const;
export const PCBUFFER_BOX_DATA_OFFSET = 4 as const; // skip currentBox u32
export const PCBUFFER_BOX_NAMES_OFFSET = 0x8344 as const;
export const PCBUFFER_BOX_NAME_BYTES = 9 as const;
export const PCBUFFER_WALLPAPERS_OFFSET = 0x83c2 as const;

export const SAVE_BYTES_FULL = 131072 as const; // 128 KB dual-slot
export const SAVE_BYTES_SINGLE = 65536 as const; // 64 KB single-slot (slot A only)

export const TRAINER_GAMECODE_OFFSET = 0xac as const;

/** Returns the checksum body size for a given semantic sector_id. */
export function sectorBodySize(sectorId: number): number {
  return sectorId === 0 ? SECTOR_BODY_TRAINER : SECTOR_BODY_DEFAULT;
}

export function familyOf(format: SaveFormat3): Gen3Family {
  if (format === 'RUBY' || format === 'SAPPHIRE') return 'RS';
  if (format === 'EMERALD') return 'EMERALD';
  return 'FRLG';
}

/** Human-friendly label for the destination-summary UI. */
export function gen3GameLabel(format: SaveFormat3): string {
  switch (format) {
    case 'RUBY':
    case 'SAPPHIRE':
      return 'Ruby/Sapphire';
    case 'EMERALD':
      return 'Emerald';
    case 'FIRERED':
    case 'LEAFGREEN':
      return 'FireRed/LeafGreen';
  }
}

/**
 * Autodetect the Gen 3 game variant from a save buffer. Returns null if
 * the buffer is the wrong length, or if no sector 0 with a valid
 * signature can be located.
 *
 * The single-vs-dual-slot dispatch lives in `parseSave` — this helper
 * reads only sector 0 of the active slot.
 */
export function detectGen3(bytes: Uint8Array): SaveFormat3 | null {
  if (bytes.length !== SAVE_BYTES_FULL && bytes.length !== SAVE_BYTES_SINGLE) {
    return null;
  }
  const sec0 = locateActiveSector0(bytes);
  if (sec0 === null) return null;
  const gameCode = readU32LE(bytes, sec0 + TRAINER_GAMECODE_OFFSET);
  if (gameCode === 0) {
    // Ruby OR Sapphire — cannot distinguish without per-flag inspection
    // that S6a doesn't need. Default to RUBY (fixture-backed) per Q1.
    return 'RUBY';
  }
  if (gameCode === 1) {
    return 'FIRERED';
  }
  return 'EMERALD';
}

/**
 * Find the disk offset of the active slot's sector_id == 0 (TrainerInfo).
 * Returns null if no valid signed sector 0 can be found in either slot.
 *
 * "Active" is the slot whose sector 0 carries the higher save_index.
 * 0xFFFFFFFF is treated as "uninitialised; the other slot wins".
 */
export function locateActiveSector0(bytes: Uint8Array): number | null {
  const slotBases =
    bytes.length === SAVE_BYTES_FULL ? [SLOT_A_OFFSET, SLOT_B_OFFSET] : [SLOT_A_OFFSET];

  let bestOff: number | null = null;
  let bestIdx = -1; // -1 < any valid save_index after FFFFFFFF rejection
  for (const base of slotBases) {
    const sec0Off = findSector0InSlot(bytes, base);
    if (sec0Off === null) continue;
    const sigOk = readU32LE(bytes, sec0Off + SECTOR_SIGNATURE_OFFSET) === SECTOR_SIGNATURE;
    if (!sigOk) continue;
    const idxRaw = readU32LE(bytes, sec0Off + SECTOR_SAVE_INDEX_OFFSET);
    const idx = idxRaw === 0xffffffff ? -1 : idxRaw;
    if (idx > bestIdx) {
      bestIdx = idx;
      bestOff = sec0Off;
    }
  }
  return bestOff;
}

function findSector0InSlot(bytes: Uint8Array, slotBase: number): number | null {
  if (slotBase + SLOT_BYTES > bytes.length) return null;
  for (let i = 0; i < SECTORS_PER_SLOT; i++) {
    const off = slotBase + i * SECTOR_SIZE;
    const sid = bytes[off + SECTOR_ID_OFFSET]! | (bytes[off + SECTOR_ID_OFFSET + 1]! << 8);
    if (sid === 0) return off;
  }
  return null;
}
