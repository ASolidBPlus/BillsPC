/**
 * Gen 1/2 base-stats table (per PLAN_EVAL S5 A1).
 *
 * The rows source from `pret/pokecrystal`'s `data/pokemon/base_stats/*.asm`
 * via PKHeX's `personal_c` binary mirror — see `scripts/gen-personal-info-gen2.ts`
 * for the regenerator. Indexed by national dex 1..251.
 *
 * Gen 2's PersonalInfo splits SpA and SpD as separate base-stat bytes
 * even though Gen 1/2 cartridges share a single `Special` DV /
 * StatExp. Gen 1 mons collapse to `spa === spd === <single Special>`;
 * the regenerator does not enforce equality (Gen 2 may differ — e.g.
 * Charizard 109/85). The S5 comparison view computes Gen 1/2 final
 * stats via the Gen 1/2 formula (HP and non-HP variants) using
 * `(base.spa, dvs.special, statExp.special)` for the SpA stat and
 * `(base.spd, dvs.special, statExp.special)` for the SpD stat — both
 * derive from the same shared Special DV/EV.
 */
import raw from './raw/personal-gen2.json' with { type: 'json' };

export interface PersonalInfoGen2 {
  readonly ndex: number;
  readonly base: {
    readonly hp: number;
    readonly atk: number;
    readonly def: number;
    readonly spe: number;
    readonly spa: number;
    readonly spd: number;
  };
  /**
   * Gen 1 single Special (1..151 only). On the Gen 1 cart, Special was
   * one shared base-stat byte; the Gen 2 split sometimes rebalanced
   * (e.g. Charizard 85 → SpA 109 / SpD 85). When the source mon's
   * `sourceGen === 1`, the comparison view's Gen 1/2 pane uses
   * `gen1Special` for both SpA and SpD; for Gen 2 mons we use the split
   * `base.spa` / `base.spd`. Sourced from `smogon/pokemon-showdown`'s
   * `data/mods/gen1/pokedex.ts` (historical Gen 1 single-Special values).
   */
  readonly gen1Special?: number;
}

const TABLE: ReadonlyMap<number, PersonalInfoGen2> = new Map(
  (raw as readonly PersonalInfoGen2[]).map((p) => [p.ndex, p] as const),
);

export function getPersonalGen2(ndex: number): PersonalInfoGen2 {
  const p = TABLE.get(ndex);
  if (!p) throw new Error(`Unknown Gen 2 ndex for personal-info lookup: ${ndex}`);
  return p;
}
