/**
 * Misc substructure (12 bytes). Layout per Bulbapedia §Substructure M
 * and PKHeX `PK3.cs`.
 *
 *   off 0      u8   pokerus (raw byte: low nibble = days remaining,
 *                   high nibble = strain id)
 *   off 1      u8   metLocation (0..255; HANDOFF pins 146 = Four Island)
 *   off 2..3   u16  originsInfo (bit-packed; see below)
 *   off 4..7   u32  ivsEggAbility (bit-packed; see below)
 *   off 8..11  u32  ribbonsAndObedience (bit-packed; see below)
 *
 * **originsInfo** (u16 LE):
 *   bits  0..6  metLevel (0..127)        — HANDOFF pins 5
 *   bits  7..10 originGame (0..15)       — 4=FRLG mapping; see ORIGIN_GAME_ID
 *   bits 11..14 ball (0..15)             — PLAN_EVAL A11 pins 4=Poké Ball
 *   bit  15     otGender (0=male, 1=female)
 *
 * **ivsEggAbility** (u32 LE):
 *   bits  0..4   HP IV
 *   bits  5..9   Atk IV
 *   bits 10..14  Def IV
 *   bits 15..19  Spe IV   ← stored order: speed BEFORE specials
 *   bits 20..24  SpA IV
 *   bits 25..29  SpD IV
 *   bit  30      isEgg
 *   bit  31      abilityBit — selects Ability 1 (0) vs Ability 2 (1).
 *                **NOT** "hasHiddenAbility" (Gen 5+ concept). PLAN's
 *                naming was wrong; the correct Gen-3 semantic is the
 *                ability-slot bit. PLAN_EVAL A2 binds the rename.
 *                S1 emits `abilitySlot: 0` always → bit 31 = 0.
 *
 * **ribbonsAndObedience** (u32 LE): all bits zero for our pipeline.
 *   bits  0..2   Cool ribbon rank (0..4)
 *   bits  3..5   Beauty
 *   bits  6..8   Cute
 *   bits  9..11  Smart
 *   bits 12..14  Tough
 *   bit  15      Champion
 *   bit  16      Winning
 *   bit  17      Victory
 *   bit  18      Artist
 *   bit  19      Effort
 *   bits 20..25  Marine/Land/Sky/Country/National/Earth gift ribbons
 *   bit  26      World gift ribbon
 *   bits 27..30  unused / pad
 *   bit  31      Obedience (Gen 3 semantic for Mew/Deoxys disobedience).
 *                PKHeX aliases this as `FatefulEncounter` for cross-gen
 *                API uniformity, and S1's `Gen3Intermediate.fatefulEncounter`
 *                follows that alias — keep the S1 name intact, but
 *                document the Gen-3 semantic here. Per HANDOFF the bred-egg
 *                cover story implies obedience=0 always. PLAN_EVAL A3.
 */

import type { Gen3Intermediate } from '../types/target.js';
import { writeU16LE, writeU32LE, u32 } from './leBytes.js';

export const MISC_SIZE = 12;

const BALL_POKEBALL = 4;

/** PKHeX origin-game IDs, Gen 3 subset. */
const ORIGIN_GAME_ID: Readonly<Record<Gen3Intermediate['originGame'], number>> = {
  FireRed: 4,
};

export interface MiscPartial {
  readonly pokerus: number;
  readonly metLocation: number;
  readonly metLevel: number;
  readonly originGameId: number;
  readonly ballId: number;
  readonly otGender: 0 | 1;
  readonly ivs: {
    readonly hp: number;
    readonly atk: number;
    readonly def: number;
    readonly spa: number;
    readonly spd: number;
    readonly spe: number;
  };
  readonly isEgg: boolean;
  readonly abilityBit: 0 | 1;
  readonly ribbonsAndObedience: number;
}

/**
 * Pack the Misc substructure. The `_sid` parameter is accepted for
 * signature symmetry with the other pack helpers but is unused — Misc
 * has no SID-dependent fields. (Encryption-key derivation lives in
 * `gen3Crypt.ts`, not here.)
 */
export function encodeMisc(intermediate: Gen3Intermediate, _sid: number): Uint8Array {
  const out = new Uint8Array(MISC_SIZE);

  out[0] = intermediate.pokerus & 0xff;
  out[1] = intermediate.metLocation & 0xff;

  const metLevel = intermediate.metLevel & 0x7f; // 7 bits
  const originGameId = ORIGIN_GAME_ID[intermediate.originGame] & 0xf; // 4 bits
  const ball = BALL_POKEBALL & 0xf; // 4 bits
  const otGender = intermediate.otGender & 0x1; // 1 bit
  const originsInfo = (otGender << 15) | (ball << 11) | (originGameId << 7) | metLevel;
  writeU16LE(out, 2, originsInfo);

  const ivs = intermediate.ivs;
  const ivBits =
    ((ivs.hp & 0x1f) << 0) |
    ((ivs.atk & 0x1f) << 5) |
    ((ivs.def & 0x1f) << 10) |
    ((ivs.spe & 0x1f) << 15) | // speed before specials in stored order
    ((ivs.spa & 0x1f) << 20) |
    ((ivs.spd & 0x1f) << 25);
  const isEggBit = (intermediate.isEgg ? 1 : 0) << 30;
  const abilityBit = (intermediate.abilitySlot & 0x1) << 31;
  // `>>> 0` to keep the value unsigned — bit 31 set without it produces
  // a negative int32 that `writeU32LE` will mask, but the round-trip
  // value comparison would silently break elsewhere.
  const ivsEggAbility = u32(ivBits | isEggBit | abilityBit);
  writeU32LE(out, 4, ivsEggAbility);

  // S1 guarantees no ribbons (typed `readonly []`) and `fatefulEncounter: false`.
  // The obedience bit (31) and all ribbon bits are 0.
  void intermediate.ribbons;
  void intermediate.fatefulEncounter;
  writeU32LE(out, 8, 0);

  return out;
}

export function decodeMisc(bytes: Uint8Array): MiscPartial {
  if (bytes.length !== MISC_SIZE) {
    throw new RangeError(`decodeMisc expected ${MISC_SIZE} bytes, got ${bytes.length}`);
  }
  const pokerus = bytes[0]!;
  const metLocation = bytes[1]!;
  const originsInfo = (bytes[2]! | (bytes[3]! << 8)) & 0xffff;
  const metLevel = originsInfo & 0x7f;
  const originGameId = (originsInfo >>> 7) & 0xf;
  const ballId = (originsInfo >>> 11) & 0xf;
  const otGender = ((originsInfo >>> 15) & 0x1) as 0 | 1;

  const ivsEggAbility = u32(bytes[4]! | (bytes[5]! << 8) | (bytes[6]! << 16) | (bytes[7]! << 24));
  const ivs = {
    hp: (ivsEggAbility >>> 0) & 0x1f,
    atk: (ivsEggAbility >>> 5) & 0x1f,
    def: (ivsEggAbility >>> 10) & 0x1f,
    spe: (ivsEggAbility >>> 15) & 0x1f,
    spa: (ivsEggAbility >>> 20) & 0x1f,
    spd: (ivsEggAbility >>> 25) & 0x1f,
  };
  const isEgg = ((ivsEggAbility >>> 30) & 0x1) === 1;
  const abilityBit = ((ivsEggAbility >>> 31) & 0x1) as 0 | 1;

  const ribbonsAndObedience = u32(
    bytes[8]! | (bytes[9]! << 8) | (bytes[10]! << 16) | (bytes[11]! << 24),
  );

  return {
    pokerus,
    metLocation,
    metLevel,
    originGameId,
    ballId,
    otGender,
    ivs,
    isEgg,
    abilityBit,
    ribbonsAndObedience,
  };
}
