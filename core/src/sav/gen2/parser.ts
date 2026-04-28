/**
 * Pokemon Crystal (English) save parser.
 *
 * Per PLAN_EVAL A4: stride between boxes within a bank is 1104 bytes,
 * box content uses 1102 bytes (1 + 21 + 640 + 220 + 220), 2 bytes pad.
 * Per PLAN_EVAL A3: `boxes.length` is always 14; corrupt boxes return
 * empty arrays + a `box_${i}_corrupt` warning.
 *
 * Field layout follows pret/pokecrystal disasm and is verified against
 * `scripts/demo-crystal.sav` — Feraligatr at slot 2 with species id
 * 160, Typhlosion at slot 0, etc.
 */

import type { Gen12Pokemon, Gen12DVs, Gen12StatExp } from '../../types/source.js';
import type { SaveContents, TrainerInfo } from '../../types/sav.js';
import { decodeGen12 } from '../../data/charmap12.js';
import {
  C_BOX_BANK_OFFSETS,
  C_BOXES_PER_BANK,
  C_BOX_MONS_OFFSET,
  C_BOX_NICK_OFFSET,
  C_BOX_OT_OFFSET,
  C_CURRENT_BOX_INDEX_OFFSET,
  C_CURRENT_BOX_OFFSET,
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
  C_PARTY_COUNT_OFFSET,
  C_PARTY_NICKNAMES_OFFSET,
  C_PARTY_OT_NAMES_OFFSET,
  C_PARTY_RECORDS_OFFSET,
  C_TOTAL_BOXES,
  C_TRAINER_GENDER_OFFSET,
  C_TRAINER_NAME_OFFSET,
  C_TRAINER_NAME_BYTES,
  C_TRAINER_TID_OFFSET,
  GEN2_BOX_MAX_MONS,
  GEN2_BOX_MON_BYTES,
  GEN2_BOX_STRIDE,
  GEN2_NAME_BYTES,
  GEN2_PARTY_MON_BYTES,
} from './offsetsCrystal.js';

function be16(b: Uint8Array, off: number): number {
  return ((b[off] ?? 0) << 8) | (b[off + 1] ?? 0);
}

function be24(b: Uint8Array, off: number): number {
  return ((b[off] ?? 0) << 16) | ((b[off + 1] ?? 0) << 8) | (b[off + 2] ?? 0);
}

function readDVs(b: Uint8Array, off: number): Gen12DVs {
  const dvWord = be16(b, off);
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
    hp: be16(bytes, off + C_MON_STATEXP_HP),
    atk: be16(bytes, off + C_MON_STATEXP_ATK),
    def: be16(bytes, off + C_MON_STATEXP_DEF),
    spe: be16(bytes, off + C_MON_STATEXP_SPE),
    special: be16(bytes, off + C_MON_STATEXP_SPC),
  };
}

function readMon(
  bytes: Uint8Array,
  monOff: number,
  otNameBytes: Uint8Array,
  nicknameBytes: Uint8Array,
  trainerGender: 0 | 1 | undefined,
): Gen12Pokemon | null {
  const species = bytes[monOff + C_MON_SPECIES];
  if (species === undefined || species === 0 || species === 0xff) return null;

  const dvs = readDVs(bytes, monOff + C_MON_DV_WORD);
  const { pp, ppUps } = readPP(bytes, monOff + C_MON_PP);
  const statExp = readStatExp(bytes, monOff);
  const moves = [
    bytes[monOff + C_MON_MOVES] ?? 0,
    bytes[monOff + C_MON_MOVES + 1] ?? 0,
    bytes[monOff + C_MON_MOVES + 2] ?? 0,
    bytes[monOff + C_MON_MOVES + 3] ?? 0,
  ] as const;
  const exp = be24(bytes, monOff + C_MON_EXP);
  const heldItemRaw = bytes[monOff + C_MON_HELD_ITEM] ?? 0;
  const heldItemGen2Id = heldItemRaw === 0 ? null : heldItemRaw;
  const friendship = bytes[monOff + C_MON_FRIENDSHIP] ?? 0;
  const pokerusByte = bytes[monOff + C_MON_POKERUS] ?? 0;
  const level = bytes[monOff + C_MON_LEVEL] ?? 0;
  // Per-mon OT TID — for traded mons this differs from the cart's player TID.
  const otTid = be16(bytes, monOff + C_MON_OT_TID);

  const mon: Gen12Pokemon = {
    sourceGen: 2,
    speciesGen2Id: species,
    level,
    exp,
    dvs,
    statExp,
    moves: moves as readonly [number, number, number, number],
    pp,
    ppUps,
    heldItemGen2Id,
    friendship,
    pokerusByte,
    otNameBytes: new Uint8Array(otNameBytes),
    tid: otTid,
    nicknameBytes: new Uint8Array(nicknameBytes),
    language: 2,
    ...(trainerGender !== undefined ? { otGender: trainerGender } : {}),
  };
  return mon;
}

function nameSlice(bytes: Uint8Array, base: number, slot: number): Uint8Array {
  return bytes.subarray(base + slot * GEN2_NAME_BYTES, base + (slot + 1) * GEN2_NAME_BYTES);
}

function readBox(
  bytes: Uint8Array,
  boxOff: number,
  trainerGender: 0 | 1 | undefined,
): { mons: Gen12Pokemon[]; warning: string | null } {
  const count = bytes[boxOff] ?? 0;
  if (count > GEN2_BOX_MAX_MONS) {
    return { mons: [], warning: `box_corrupt: count=${count}` };
  }
  const monsBase = boxOff + C_BOX_MONS_OFFSET;
  const otBase = boxOff + C_BOX_OT_OFFSET;
  const nickBase = boxOff + C_BOX_NICK_OFFSET;
  const out: Gen12Pokemon[] = [];
  for (let s = 0; s < count; s++) {
    const monOff = monsBase + s * GEN2_BOX_MON_BYTES;
    const otBytes = nameSlice(bytes, otBase, s);
    const nickBytes = nameSlice(bytes, nickBase, s);
    const mon = readMon(bytes, monOff, otBytes, nickBytes, trainerGender);
    if (mon) out.push(mon);
  }
  return { mons: out, warning: null };
}

export function parseCrystal(sram: Uint8Array): SaveContents {
  const warnings: string[] = [];

  const nameBytes = sram.subarray(
    C_TRAINER_NAME_OFFSET,
    C_TRAINER_NAME_OFFSET + C_TRAINER_NAME_BYTES,
  );
  const tid = be16(sram, C_TRAINER_TID_OFFSET);
  const genderByte = sram[C_TRAINER_GENDER_OFFSET];
  const gender: 0 | 1 | undefined = genderByte === 0 ? 0 : genderByte === 1 ? 1 : undefined;

  const trainer: TrainerInfo = {
    name: decodeGen12(nameBytes),
    nameBytes: new Uint8Array(nameBytes),
    tid,
    ...(gender !== undefined ? { gender } : {}),
  };

  // Party
  const partyCount = sram[C_PARTY_COUNT_OFFSET] ?? 0;
  const party: Gen12Pokemon[] = [];
  for (let i = 0; i < partyCount; i++) {
    const monOff = C_PARTY_RECORDS_OFFSET + i * GEN2_PARTY_MON_BYTES;
    const otBytes = nameSlice(sram, C_PARTY_OT_NAMES_OFFSET, i);
    const nickBytes = nameSlice(sram, C_PARTY_NICKNAMES_OFFSET, i);
    const mon = readMon(sram, monOff, otBytes, nickBytes, gender);
    if (mon) party.push(mon);
  }

  // Stored boxes 1..14
  const boxes: Gen12Pokemon[][] = [];
  for (let bank = 0; bank < C_BOX_BANK_OFFSETS.length; bank++) {
    for (let bIdx = 0; bIdx < C_BOXES_PER_BANK; bIdx++) {
      const bankOffset = C_BOX_BANK_OFFSETS[bank] ?? 0;
      const boxOff = bankOffset + bIdx * GEN2_BOX_STRIDE;
      const storedBoxIndex = bank * C_BOXES_PER_BANK + bIdx;
      const result = readBox(sram, boxOff, gender);
      if (result.warning) {
        warnings.push(`box_${storedBoxIndex}_corrupt: ${result.warning}`);
        boxes.push([]);
      } else {
        boxes.push(result.mons);
      }
    }
  }
  while (boxes.length < C_TOTAL_BOXES) boxes.push([]);

  // Current box
  const currentBoxResult = readBox(sram, C_CURRENT_BOX_OFFSET, gender);
  if (currentBoxResult.warning) {
    warnings.push(`current_box_corrupt: ${currentBoxResult.warning}`);
  }
  const currentBox = currentBoxResult.mons;

  const cbiByte = sram[C_CURRENT_BOX_INDEX_OFFSET];
  const currentBoxIndex = cbiByte === undefined ? undefined : cbiByte & 0x3f;
  const safeCurrentBoxIndex =
    currentBoxIndex !== undefined && currentBoxIndex < C_TOTAL_BOXES ? currentBoxIndex : undefined;

  return {
    format: 'CRYSTAL',
    trainer,
    party,
    boxes,
    currentBox,
    currentBoxIndex: safeCurrentBoxIndex,
    warnings,
  };
}
