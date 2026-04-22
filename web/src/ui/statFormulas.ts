/**
 * Final-stat calculators for the side-by-side comparison view.
 *
 * Per PLAN_EVAL S5 A1 and the "Side-by-side comparison correctness"
 * section, the Gen 1/2 source side and the Gen 3 destination side
 * use *different* formulas — DO NOT borrow Gen 3's formula and apply
 * it on the Gen 1/2 side.
 *
 * Gen 1/2 formulas (Bulbapedia "Statistic"):
 *   non-HP: floor(((Base + DV) * 2 + floor(sqrt(StatExp)) / 4) * Level / 100) + 5
 *   HP:     floor(((Base + DV) * 2 + floor(sqrt(StatExp)) / 4) * Level / 100) + Level + 10
 *   HP DV is derived from the four LSBs of (Atk, Def, Spe, Special)
 *   per `core/src/types/source.ts` `hpDv()`.
 *
 * Gen 3 formulas:
 *   non-HP: floor((floor((2 * Base + IV + floor(EV / 4)) * Level / 100) + 5) * NatureMod)
 *   HP:     floor((2 * Base + IV + floor(EV / 4)) * Level / 100) + Level + 10
 *
 * NatureMod is 1.0 for the comparison view (the converter picks a
 * neutral nature when DVs allow, and we want apples-to-apples for the
 * delta read-out — adding a non-neutral nature would conflate the
 * "Gen 2 → Gen 3 base-stat shift" delta with a "nature roll" delta).
 *
 * Gen 1/2 share `special` for both DV and StatExp; the Gen 2 personal
 * table splits SpA and SpD as separate base-stat bytes (per S5 A1 the
 * regenerator preserves both columns). We compute SpA stat from
 * `(base.spa, dvs.special, statExp.special)` and SpD stat from
 * `(base.spd, dvs.special, statExp.special)` — both share the same
 * shared Special unit on the source.
 */
import { hpDv } from '@pokeportal/core/internal';
import type { Gen12Pokemon } from '@pokeportal/core';
import type { PersonalInfo, PersonalInfoGen2 } from '@pokeportal/core/internal';

export interface SixStats {
  readonly hp: number;
  readonly atk: number;
  readonly def: number;
  readonly spa: number;
  readonly spd: number;
  readonly spe: number;
}

export interface SixStatDeltas {
  readonly hp: number;
  readonly atk: number;
  readonly def: number;
  readonly spa: number;
  readonly spd: number;
  readonly spe: number;
}

function isqrt(n: number): number {
  // Integer square root for non-negative ints (used for StatExp √).
  if (n < 0) return 0;
  if (n < 2) return n;
  let x = Math.floor(Math.sqrt(n));
  // Math.sqrt is precise enough for n ≤ 2^53, but guard one direction.
  while ((x + 1) * (x + 1) <= n) x++;
  while (x * x > n) x--;
  return x;
}

function gen12NonHp(base: number, dv: number, statExp: number, level: number): number {
  const term = (base + dv) * 2 + Math.floor(isqrt(statExp) / 4);
  return Math.floor((term * level) / 100) + 5;
}

function gen12Hp(base: number, dv: number, statExp: number, level: number): number {
  const term = (base + dv) * 2 + Math.floor(isqrt(statExp) / 4);
  return Math.floor((term * level) / 100) + level + 10;
}

export function computeGen12Stats(
  mon: Gen12Pokemon,
  personal: PersonalInfoGen2,
  level = mon.level,
): SixStats {
  const hpD = hpDv(mon.dvs);
  const hp = gen12Hp(personal.base.hp, hpD, mon.statExp.hp, level);
  const atk = gen12NonHp(personal.base.atk, mon.dvs.atk, mon.statExp.atk, level);
  const def = gen12NonHp(personal.base.def, mon.dvs.def, mon.statExp.def, level);
  // SpA and SpD both derive from the shared Special DV / StatExp.
  // For Gen 1 mons the base-stat bytes are equal (single Special byte
  // on the cart) — we pull `gen1Special` from PersonalInfoGen2 to
  // recover the historical value. For Gen 2 mons we use the split
  // base.spa / base.spd from the Gen 2 personal table.
  const sourceSpaBase =
    mon.sourceGen === 1 && personal.gen1Special !== undefined
      ? personal.gen1Special
      : personal.base.spa;
  const sourceSpdBase =
    mon.sourceGen === 1 && personal.gen1Special !== undefined
      ? personal.gen1Special
      : personal.base.spd;
  const spa = gen12NonHp(sourceSpaBase, mon.dvs.special, mon.statExp.special, level);
  const spd = gen12NonHp(sourceSpdBase, mon.dvs.special, mon.statExp.special, level);
  const spe = gen12NonHp(personal.base.spe, mon.dvs.spe, mon.statExp.spe, level);
  return { hp, atk, def, spa, spd, spe };
}

function gen3NonHp(base: number, iv: number, ev: number, level: number): number {
  const inside = Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100);
  return inside + 5;
}

function gen3Hp(base: number, iv: number, ev: number, level: number): number {
  const inside = Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100);
  return inside + level + 10;
}

export interface Gen3Stats {
  readonly hp: number;
  readonly atk: number;
  readonly def: number;
  readonly spa: number;
  readonly spd: number;
  readonly spe: number;
}

export interface Gen3StatInputs {
  readonly ivs: SixStats;
  readonly evs: SixStats;
  readonly level: number;
}

export function computeGen3Stats(personal: PersonalInfo, inputs: Gen3StatInputs): Gen3Stats {
  const { ivs, evs, level } = inputs;
  return {
    hp: gen3Hp(personal.base.hp, ivs.hp, evs.hp, level),
    atk: gen3NonHp(personal.base.atk, ivs.atk, evs.atk, level),
    def: gen3NonHp(personal.base.def, ivs.def, evs.def, level),
    spa: gen3NonHp(personal.base.spa, ivs.spa, evs.spa, level),
    spd: gen3NonHp(personal.base.spd, ivs.spd, evs.spd, level),
    spe: gen3NonHp(personal.base.spe, ivs.spe, evs.spe, level),
  };
}

export function diffStats(after: SixStats, before: SixStats): SixStatDeltas {
  return {
    hp: after.hp - before.hp,
    atk: after.atk - before.atk,
    def: after.def - before.def,
    spa: after.spa - before.spa,
    spd: after.spd - before.spd,
    spe: after.spe - before.spe,
  };
}
