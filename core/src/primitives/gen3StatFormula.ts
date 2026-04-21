/**
 * Gen 3 production stat formula.
 *
 * Formula (identical to `tests/harness/gen3Stats.ts`):
 *   HP:     floor(((2*base + iv + floor(ev/4)) * level) / 100) + level + 10
 *   Other:  floor(floor(((2*base + iv + floor(ev/4)) * level) / 100 + 5) * nature)
 *
 * Nature multipliers are `[0.9, 1.0, 1.1]` — the standard Gen 3+ table.
 * Every one of the five neutral natures S1 can emit (IDs 0, 6, 12, 18,
 * 24) produces 1.0× on every stat, so in S2's current wire the outer
 * `floor(... * 1.0)` is a no-op. We still apply it so a future sprint
 * that relaxes the neutral-nature rule keeps rounding behaviour right
 * (PLAN §10 Q6 / PLAN_EVAL A18).
 *
 * The table is the standard 25-row × 5-stat arrangement from Bulbapedia
 * "Nature" — row index = nature ID (0..24), column index =
 * stat-position (atk=0, def=1, spe=2, spa=3, spd=4). HP is never
 * affected by nature.
 */

export interface Gen3StatBase {
  readonly hp: number;
  readonly atk: number;
  readonly def: number;
  readonly spa: number;
  readonly spd: number;
  readonly spe: number;
}

export interface Gen3StatInputs {
  readonly hp: number;
  readonly atk: number;
  readonly def: number;
  readonly spa: number;
  readonly spd: number;
  readonly spe: number;
}

export interface Gen3Stats {
  readonly hp: number;
  readonly atk: number;
  readonly def: number;
  readonly spa: number;
  readonly spd: number;
  readonly spe: number;
}

/** Nature-affected stats in canonical index order: atk, def, spe, spa, spd. */
type NatureStat = 'atk' | 'def' | 'spe' | 'spa' | 'spd';
const NATURE_STATS: readonly NatureStat[] = ['atk', 'def', 'spe', 'spa', 'spd'];

/**
 * `NATURE_TABLE[natureId][statIdx]` = multiplier (0.9, 1.0, or 1.1).
 * Statically-sized 25×5 table. Derived from Bulbapedia "Nature":
 * - Nature ID = 5 * rising + falling  (rising, falling ∈ 0..4 over stats
 *   atk, def, spe, spa, spd)
 * - rising == falling → neutral (all 1.0×)
 * - else: rising stat = 1.1×, falling stat = 0.9×
 */
const NATURE_TABLE: ReadonlyArray<readonly [number, number, number, number, number]> = (() => {
  const rows: [number, number, number, number, number][] = [];
  for (let id = 0; id < 25; id++) {
    const rising = Math.floor(id / 5);
    const falling = id % 5;
    const row: [number, number, number, number, number] = [1.0, 1.0, 1.0, 1.0, 1.0];
    if (rising !== falling) {
      row[rising] = 1.1;
      row[falling] = 0.9;
    }
    rows.push(row);
  }
  return rows;
})();

function natureMultiplier(nature: number, stat: NatureStat): number {
  const row = NATURE_TABLE[nature];
  if (!row) throw new RangeError(`natureMultiplier: nature ${nature} out of range (0..24)`);
  const idx = NATURE_STATS.indexOf(stat);
  return row[idx]!;
}

function computeHp(base: number, iv: number, ev: number, level: number): number {
  return Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + level + 10;
}

function computeOther(
  base: number,
  iv: number,
  ev: number,
  level: number,
  nature: number,
  stat: NatureStat,
): number {
  const core = Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + 5;
  return Math.floor(core * natureMultiplier(nature, stat));
}

export function computeGen3Stats(
  base: Gen3StatBase,
  ivs: Gen3StatInputs,
  evs: Gen3StatInputs,
  level: number,
  nature: number,
): Gen3Stats {
  if (level < 1 || level > 100) {
    throw new RangeError(`computeGen3Stats: level ${level} out of range (1..100)`);
  }
  return {
    hp: computeHp(base.hp, ivs.hp, evs.hp, level),
    atk: computeOther(base.atk, ivs.atk, evs.atk, level, nature, 'atk'),
    def: computeOther(base.def, ivs.def, evs.def, level, nature, 'def'),
    spe: computeOther(base.spe, ivs.spe, evs.spe, level, nature, 'spe'),
    spa: computeOther(base.spa, ivs.spa, evs.spa, level, nature, 'spa'),
    spd: computeOther(base.spd, ivs.spd, evs.spd, level, nature, 'spd'),
  };
}
