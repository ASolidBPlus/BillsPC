/**
 * Party-record packer. 100 bytes:
 *   off  0..79   = packBoxed output verbatim
 *   off 80..99   = 20-byte party tail
 *
 * Party-tail layout (per PLAN §4.4 + PLAN_EVAL):
 *   off 80  u32  status (0)
 *   off 84  u8   level
 *   off 85  u8   mail-remaining (0; unrelated to Misc.pokerus)
 *   off 86  u16  current HP (= max HP for a freshly-bred egg cover)
 *   off 88  u16  max HP
 *   off 90  u16  atk
 *   off 92  u16  def
 *   off 94  u16  spe   ← speed BEFORE specials in stored order
 *   off 96  u16  spa
 *   off 98  u16  spd
 *
 * Stats are computed via the production Gen 3 stat formula
 * (`primitives/gen3StatFormula.ts`), not stored in `Gen3Intermediate`.
 * This is why `unpackParty` is deferred to a later sprint — recovering
 * the intermediate from a party record needs species base stats and is
 * lossy w.r.t. anything unique to `Gen3Intermediate._meta`.
 */

import type { Gen3Intermediate } from '../types/target.js';
import { packBoxed, BOXED_SIZE } from './boxed.js';
import { computeGen3Stats } from '../primitives/gen3StatFormula.js';
import { getPersonal } from '../data/personalInfo.js';
import { writeU16LE, writeU32LE } from './leBytes.js';

export const PARTY_SIZE = 100 as const;
export const PARTY_TAIL_SIZE = 20 as const;
export const PARTY_TAIL_OFFSET = BOXED_SIZE; // 80

export function packParty(intermediate: Gen3Intermediate): Uint8Array {
  const out = new Uint8Array(PARTY_SIZE);
  const boxed = packBoxed(intermediate);
  out.set(boxed, 0);

  const personal = getPersonal(intermediate.species);
  const stats = computeGen3Stats(
    personal.base,
    intermediate.ivs,
    intermediate.evs,
    intermediate.level,
    intermediate.nature,
  );

  writeU32LE(out, PARTY_TAIL_OFFSET + 0, 0); // status
  out[PARTY_TAIL_OFFSET + 4] = intermediate.level & 0xff;
  out[PARTY_TAIL_OFFSET + 5] = 0; // mail-remaining
  writeU16LE(out, PARTY_TAIL_OFFSET + 6, stats.hp); // current HP = max
  writeU16LE(out, PARTY_TAIL_OFFSET + 8, stats.hp); // max HP
  writeU16LE(out, PARTY_TAIL_OFFSET + 10, stats.atk);
  writeU16LE(out, PARTY_TAIL_OFFSET + 12, stats.def);
  writeU16LE(out, PARTY_TAIL_OFFSET + 14, stats.spe); // speed before specials
  writeU16LE(out, PARTY_TAIL_OFFSET + 16, stats.spa);
  writeU16LE(out, PARTY_TAIL_OFFSET + 18, stats.spd);

  return out;
}
