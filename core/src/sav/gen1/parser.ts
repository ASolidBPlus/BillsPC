/**
 * Gen 1 (Pokemon Red/Blue, English) save parser.
 *
 * Direct port of `scripts/demo-red-stat-check.ts` (party @ 0x2F2C) and
 * `scripts/demo-red-boxes.ts` (boxes at 0x4000/0x6000, current PC box at
 * 0x30C0). The demo offsets are verified-correct against `demo-red.sav`.
 *
 * Per PLAN_EVAL A7: PP/PP-Up extraction preserves the masked nibbles
 * (low 6 = current PP, high 2 = PP Ups). Gen 1 DOES support PP Ups
 * (Move Tutor / Celadon Game Corner item) — never zero them out.
 *
 * Per PLAN_EVAL A3: `boxes.length` is always RB_TOTAL_BOXES (12).
 * A box that fails its count probe is returned as an empty array AND
 * a `box_${i}_corrupt` warning is appended.
 */

import type { Gen12Pokemon, Gen12DVs, Gen12StatExp } from '../../types/source.js';
import type { SaveContents, TrainerInfo, SaveFormat } from '../../types/sav.js';
import { decodeGen12 } from '../../data/charmap12.js';
import { internalToNdex } from './internalDex.js';
import {
  GEN1_BOX_MAX_MONS,
  GEN1_BOX_MON_BYTES,
  GEN1_BOX_STRIDE,
  GEN1_NAME_BYTES,
  GEN1_PARTY_MON_BYTES,
  RB_BOX_BANK_OFFSETS,
  RB_BOXES_PER_BANK,
  RB_BOX_MONS_OFFSET,
  RB_BOX_NICK_OFFSET,
  RB_BOX_OT_OFFSET,
  RB_CURRENT_BOX_INDEX_OFFSET,
  RB_CURRENT_BOX_OFFSET,
  RB_MON_DV_WORD,
  RB_MON_EXP,
  RB_MON_BOX_LEVEL,
  RB_MON_MOVES,
  RB_MON_PARTY_LEVEL,
  RB_MON_PP,
  RB_MON_STATEXP_ATK,
  RB_MON_STATEXP_DEF,
  RB_MON_STATEXP_HP,
  RB_MON_STATEXP_SPC,
  RB_MON_STATEXP_SPE,
  RB_PARTY_COUNT_OFFSET,
  RB_PARTY_NICKNAMES_OFFSET,
  RB_PARTY_OT_NAMES_OFFSET,
  RB_PARTY_RECORDS_OFFSET,
  RB_TOTAL_BOXES,
  RB_TRAINER_NAME_BYTES,
  RB_TRAINER_NAME_OFFSET,
  RB_TRAINER_TID_OFFSET,
} from './offsets.js';

const TID_BYTES = 2;

function be16(b: Uint8Array, off: number): number {
  return ((b[off] ?? 0) << 8) | (b[off + 1] ?? 0);
}

function be24(b: Uint8Array, off: number): number {
  return ((b[off] ?? 0) << 16) | ((b[off + 1] ?? 0) << 8) | (b[off + 2] ?? 0);
}

function readDVs(byte: number, byte2: number): Gen12DVs {
  const dvWord = (byte << 8) | byte2;
  return {
    atk: (dvWord >> 12) & 0xf,
    def: (dvWord >> 8) & 0xf,
    spe: (dvWord >> 4) & 0xf,
    special: dvWord & 0xf,
  };
}

function readPP(
  bytes: Uint8Array,
  off: number,
): {
  pp: readonly [number, number, number, number];
  ppUps: readonly [number, number, number, number];
} {
  const raw = [
    bytes[off] ?? 0,
    bytes[off + 1] ?? 0,
    bytes[off + 2] ?? 0,
    bytes[off + 3] ?? 0,
  ] as const;
  return {
    pp: [raw[0] & 0x3f, raw[1] & 0x3f, raw[2] & 0x3f, raw[3] & 0x3f] as const,
    ppUps: [
      (raw[0] >> 6) & 0x3,
      (raw[1] >> 6) & 0x3,
      (raw[2] >> 6) & 0x3,
      (raw[3] >> 6) & 0x3,
    ] as const,
  };
}

function readStatExp(bytes: Uint8Array, off: number): Gen12StatExp {
  return {
    hp: be16(bytes, off + RB_MON_STATEXP_HP),
    atk: be16(bytes, off + RB_MON_STATEXP_ATK),
    def: be16(bytes, off + RB_MON_STATEXP_DEF),
    spe: be16(bytes, off + RB_MON_STATEXP_SPE),
    special: be16(bytes, off + RB_MON_STATEXP_SPC),
  };
}

function readMon(
  bytes: Uint8Array,
  monOff: number,
  isParty: boolean,
  otNameBytes: Uint8Array,
  nicknameBytes: Uint8Array,
  trainerTid: number,
): Gen12Pokemon | null {
  const internal = bytes[monOff];
  if (internal === undefined || internal === 0 || internal === 0xff) return null;
  const ndex = internalToNdex(internal);

  const dvByte1 = bytes[monOff + RB_MON_DV_WORD] ?? 0;
  const dvByte2 = bytes[monOff + RB_MON_DV_WORD + 1] ?? 0;
  const dvs = readDVs(dvByte1, dvByte2);
  const { pp, ppUps } = readPP(bytes, monOff + RB_MON_PP);
  const statExp = readStatExp(bytes, monOff);
  const moves = [
    bytes[monOff + RB_MON_MOVES] ?? 0,
    bytes[monOff + RB_MON_MOVES + 1] ?? 0,
    bytes[monOff + RB_MON_MOVES + 2] ?? 0,
    bytes[monOff + RB_MON_MOVES + 3] ?? 0,
  ] as const;
  const exp = be24(bytes, monOff + RB_MON_EXP);
  const level = bytes[monOff + (isParty ? RB_MON_PARTY_LEVEL : RB_MON_BOX_LEVEL)] ?? 0;

  return {
    sourceGen: 1,
    speciesGen2Id: ndex,
    level,
    exp,
    dvs,
    statExp,
    moves: moves as readonly [number, number, number, number],
    pp,
    ppUps,
    heldItemGen2Id: null,
    friendship: null,
    pokerusByte: 0,
    otNameBytes: new Uint8Array(otNameBytes),
    tid: trainerTid,
    nicknameBytes: new Uint8Array(nicknameBytes),
    language: 2,
  };
}

function nameSlice(bytes: Uint8Array, base: number, slot: number): Uint8Array {
  return bytes.subarray(base + slot * GEN1_NAME_BYTES, base + (slot + 1) * GEN1_NAME_BYTES);
}

function readBox(
  bytes: Uint8Array,
  boxOff: number,
  trainerTid: number,
): { mons: Gen12Pokemon[]; warning: string | null } {
  const count = bytes[boxOff] ?? 0;
  if (count > GEN1_BOX_MAX_MONS) {
    return { mons: [], warning: `box_corrupt: count=${count}` };
  }
  const monsBase = boxOff + RB_BOX_MONS_OFFSET;
  const otBase = boxOff + RB_BOX_OT_OFFSET;
  const nickBase = boxOff + RB_BOX_NICK_OFFSET;
  const out: Gen12Pokemon[] = [];
  for (let s = 0; s < count; s++) {
    const monOff = monsBase + s * GEN1_BOX_MON_BYTES;
    const otBytes = nameSlice(bytes, otBase, s);
    const nickBytes = nameSlice(bytes, nickBase, s);
    const mon = readMon(bytes, monOff, false, otBytes, nickBytes, trainerTid);
    if (mon) out.push(mon);
  }
  return { mons: out, warning: null };
}

export function parseGen1(sram: Uint8Array, format: SaveFormat): SaveContents {
  const warnings: string[] = [];

  // Trainer
  const nameBytes = sram.subarray(
    RB_TRAINER_NAME_OFFSET,
    RB_TRAINER_NAME_OFFSET + RB_TRAINER_NAME_BYTES,
  );
  const tid = be16(sram, RB_TRAINER_TID_OFFSET);
  void TID_BYTES; // documentation
  const trainer: TrainerInfo = {
    name: decodeGen12(nameBytes),
    nameBytes: new Uint8Array(nameBytes),
    tid,
  };

  // Party
  const partyCount = sram[RB_PARTY_COUNT_OFFSET] ?? 0;
  const party: Gen12Pokemon[] = [];
  for (let i = 0; i < partyCount; i++) {
    const monOff = RB_PARTY_RECORDS_OFFSET + i * GEN1_PARTY_MON_BYTES;
    const otBytes = nameSlice(sram, RB_PARTY_OT_NAMES_OFFSET, i);
    const nickBytes = nameSlice(sram, RB_PARTY_NICKNAMES_OFFSET, i);
    const mon = readMon(sram, monOff, true, otBytes, nickBytes, tid);
    if (mon) party.push(mon);
  }

  // Current PC box
  const currentBoxResult = readBox(sram, RB_CURRENT_BOX_OFFSET, tid);
  if (currentBoxResult.warning) {
    warnings.push(`current_box_corrupt: ${currentBoxResult.warning}`);
  }
  const currentBox = currentBoxResult.mons;

  // Stored boxes 1..12
  const boxes: Gen12Pokemon[][] = [];
  for (let bank = 0; bank < RB_BOX_BANK_OFFSETS.length; bank++) {
    for (let bIdx = 0; bIdx < RB_BOXES_PER_BANK; bIdx++) {
      const bankOffset = RB_BOX_BANK_OFFSETS[bank] ?? 0;
      const boxOff = bankOffset + bIdx * GEN1_BOX_STRIDE;
      const storedBoxIndex = bank * RB_BOXES_PER_BANK + bIdx;
      const result = readBox(sram, boxOff, tid);
      if (result.warning) {
        warnings.push(`box_${storedBoxIndex}_corrupt: ${result.warning}`);
        boxes.push([]);
      } else {
        boxes.push(result.mons);
      }
    }
  }
  if (boxes.length !== RB_TOTAL_BOXES) {
    // Defensive: should never happen.
    while (boxes.length < RB_TOTAL_BOXES) boxes.push([]);
  }

  const cbiByte = sram[RB_CURRENT_BOX_INDEX_OFFSET];
  const currentBoxIndex = cbiByte === undefined ? undefined : cbiByte & 0x3f;
  const safeCurrentBoxIndex =
    currentBoxIndex !== undefined && currentBoxIndex < RB_TOTAL_BOXES ? currentBoxIndex : undefined;

  return {
    format,
    trainer,
    party,
    boxes,
    currentBox,
    currentBoxIndex: safeCurrentBoxIndex,
    warnings,
  };
}
