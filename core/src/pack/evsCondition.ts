/**
 * EVs/Condition substructure (12 bytes). Layout per Bulbapedia
 * §Substructure E and PKHeX `PK3.cs`.
 *
 * **EV byte order is HP/Atk/Def/Spe/SpA/SpD** — speed BEFORE the specials.
 * The S1 `Gen3Intermediate.evs` object uses the canonical
 * hp/atk/def/spa/spd/spe key order; the packer reorders here at the byte
 * boundary. Same applies to the IV bit-pack in `misc.ts`.
 *
 *   off 0..5   u8 EVs in stored order (HP, Atk, Def, Spe, SpA, SpD)
 *   off 6      u8 cool
 *   off 7      u8 beauty
 *   off 8      u8 cute
 *   off 9      u8 smart  (a.k.a. "clever" in Gen 5+ rename; Gen 3 canonical: smart)
 *   off 10     u8 tough
 *   off 11     u8 sheen
 *
 * S1 guarantees all six contest stats are literal-zero (HANDOFF §4.16),
 * so offsets 6..11 are always 0x00 on encode. On decode we surface the
 * raw bytes and the boxed-record decoder enforces the literal-zero
 * constraint per PLAN_EVAL A1 / §4.7 step 9.
 */

import type { Gen3Intermediate } from '../types/target.js';

export const EV_CONDITION_SIZE = 12;

export interface EvsConditionPartial {
  readonly evs: {
    readonly hp: number;
    readonly atk: number;
    readonly def: number;
    readonly spa: number;
    readonly spd: number;
    readonly spe: number;
  };
  readonly contestStats: {
    readonly cool: number;
    readonly beauty: number;
    readonly cute: number;
    readonly clever: number;
    readonly tough: number;
    readonly sheen: number;
  };
}

export function encodeEvsCondition(intermediate: Gen3Intermediate): Uint8Array {
  const out = new Uint8Array(EV_CONDITION_SIZE);
  out[0] = intermediate.evs.hp & 0xff;
  out[1] = intermediate.evs.atk & 0xff;
  out[2] = intermediate.evs.def & 0xff;
  out[3] = intermediate.evs.spe & 0xff; // speed before specials in stored order
  out[4] = intermediate.evs.spa & 0xff;
  out[5] = intermediate.evs.spd & 0xff;
  out[6] = intermediate.contestStats.cool;
  out[7] = intermediate.contestStats.beauty;
  out[8] = intermediate.contestStats.cute;
  out[9] = intermediate.contestStats.clever;
  out[10] = intermediate.contestStats.tough;
  out[11] = intermediate.contestStats.sheen;
  return out;
}

export function decodeEvsCondition(bytes: Uint8Array): EvsConditionPartial {
  if (bytes.length !== EV_CONDITION_SIZE) {
    throw new RangeError(
      `decodeEvsCondition expected ${EV_CONDITION_SIZE} bytes, got ${bytes.length}`,
    );
  }
  return {
    evs: {
      hp: bytes[0]!,
      atk: bytes[1]!,
      def: bytes[2]!,
      spe: bytes[3]!,
      spa: bytes[4]!,
      spd: bytes[5]!,
    },
    contestStats: {
      cool: bytes[6]!,
      beauty: bytes[7]!,
      cute: bytes[8]!,
      clever: bytes[9]!,
      tough: bytes[10]!,
      sheen: bytes[11]!,
    },
  };
}
