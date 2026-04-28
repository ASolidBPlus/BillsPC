/**
 * Inverse of `parser.ts:readMon`. Encodes a parsed `Gen12Pokemon` back to
 * its on-cart wire shape: 32-byte box record + 11-byte OT name + 11-byte
 * nickname. Used for PK2 export of staged transfer-box mons.
 *
 * Crystal layout only (matches the writer's GS-deferred stance).
 */

import type { Gen12Pokemon } from '../../types/source.js';
import {
  C_MON_CAUGHT_DATA,
  C_MON_DV_WORD,
  C_MON_EXP,
  C_MON_FRIENDSHIP,
  C_MON_HELD_ITEM,
  C_MON_LEVEL,
  C_MON_MOVES,
  C_MON_OT_TID,
  C_MON_POKERUS,
  C_MON_PP,
  C_MON_SPECIES,
  C_MON_STATEXP_ATK,
  C_MON_STATEXP_DEF,
  C_MON_STATEXP_HP,
  C_MON_STATEXP_SPC,
  C_MON_STATEXP_SPE,
  GEN2_BOX_MON_BYTES,
  GEN2_NAME_BYTES,
} from './offsetsCrystal.js';

export interface EncodedGen2Mon {
  /** 32-byte boxed record (matches `GEN2_BOX_MON_BYTES`). */
  readonly record: Uint8Array;
  /** 11-byte OT-name field (matches `GEN2_NAME_BYTES`). */
  readonly otName: Uint8Array;
  /** 11-byte nickname field (matches `GEN2_NAME_BYTES`). */
  readonly nickname: Uint8Array;
}

function writeBE16(out: Uint8Array, off: number, val: number): void {
  out[off] = (val >> 8) & 0xff;
  out[off + 1] = val & 0xff;
}

function writeBE24(out: Uint8Array, off: number, val: number): void {
  out[off] = (val >> 16) & 0xff;
  out[off + 1] = (val >> 8) & 0xff;
  out[off + 2] = val & 0xff;
}

function packDVs(d: Gen12Pokemon['dvs']): number {
  return ((d.atk & 0xf) << 12) | ((d.def & 0xf) << 8) | ((d.spe & 0xf) << 4) | (d.special & 0xf);
}

/**
 * Encode a Gen 1/2 Pokemon back to its on-cart wire bytes (Crystal box
 * record layout). Throws on malformed input (e.g. species out of range).
 *
 * Note: name fields are right-padded with terminator (0x50) and zeros to
 * fill the 11-byte field — same convention as the parser reads.
 */
export function encodeMonGen2(mon: Gen12Pokemon): EncodedGen2Mon {
  if (mon.sourceGen !== 2) {
    throw new Error(`encodeMonGen2: expected sourceGen=2, got ${mon.sourceGen}`);
  }
  const speciesId = mon.speciesGen2Id;
  if (speciesId == null || speciesId < 1 || speciesId > 0xfe) {
    throw new Error(`encodeMonGen2: speciesGen2Id ${speciesId} out of range [1, 254]`);
  }

  const record = new Uint8Array(GEN2_BOX_MON_BYTES);

  record[C_MON_SPECIES] = speciesId;
  record[C_MON_HELD_ITEM] = mon.heldItemGen2Id ?? 0;
  record[C_MON_MOVES] = mon.moves[0] & 0xff;
  record[C_MON_MOVES + 1] = mon.moves[1] & 0xff;
  record[C_MON_MOVES + 2] = mon.moves[2] & 0xff;
  record[C_MON_MOVES + 3] = mon.moves[3] & 0xff;
  writeBE16(record, C_MON_OT_TID, mon.tid & 0xffff);
  writeBE24(record, C_MON_EXP, mon.exp & 0xffffff);

  writeBE16(record, C_MON_STATEXP_HP, mon.statExp.hp & 0xffff);
  writeBE16(record, C_MON_STATEXP_ATK, mon.statExp.atk & 0xffff);
  writeBE16(record, C_MON_STATEXP_DEF, mon.statExp.def & 0xffff);
  writeBE16(record, C_MON_STATEXP_SPE, mon.statExp.spe & 0xffff);
  writeBE16(record, C_MON_STATEXP_SPC, mon.statExp.special & 0xffff);

  writeBE16(record, C_MON_DV_WORD, packDVs(mon.dvs));

  // PP byte format: bits 0-5 = current PP (0..63), bits 6-7 = PP-Up count (0..3).
  for (let i = 0; i < 4; i++) {
    const pp = (mon.pp[i] ?? 0) & 0x3f;
    const ppUp = (mon.ppUps[i] ?? 0) & 0x3;
    record[C_MON_PP + i] = pp | (ppUp << 6);
  }

  record[C_MON_FRIENDSHIP] = mon.friendship ?? 0;
  record[C_MON_POKERUS] = mon.pokerusByte & 0xff;
  // Caught data: 16-bit field encoding location/time/level/gender bits.
  // Information is lost when staging (we don't preserve raw bytes), so
  // write zero — pkhex tolerates zero for cross-gen cover-story mons.
  writeBE16(record, C_MON_CAUGHT_DATA, 0);
  record[C_MON_LEVEL] = mon.level & 0xff;

  // Name fields. Parser stores them already padded to 11 bytes; just copy
  // out a 11-byte slice. If the staged field is shorter, pad with terminator
  // 0x50 then zeros. If longer, truncate.
  const otName = padNameField(mon.otNameBytes);
  const nickname = padNameField(mon.nicknameBytes);

  return { record, otName, nickname };
}

function padNameField(src: Uint8Array): Uint8Array {
  const out = new Uint8Array(GEN2_NAME_BYTES);
  for (let i = 0; i < GEN2_NAME_BYTES; i++) {
    if (i < src.length) out[i] = src[i] ?? 0;
    else if (i === src.length) out[i] = 0x50; // terminator if missing
    // else: stays 0
  }
  return out;
}
