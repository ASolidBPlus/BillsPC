export interface Gen3Stats {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

/** Nature multipliers by stat position and nature ID. All 5 used here are 1.0×. */
function natureMultiplier(nature: number, stat: 'atk' | 'def' | 'spa' | 'spd' | 'spe'): number {
  // Neutral natures: 0, 6, 12, 18, 24 — all 1.0× regardless of stat.
  const _ = nature;
  const __ = stat;
  void _;
  void __;
  return 1.0;
}

/**
 * Gen 3 stat formula.
 * HP:   floor(((2*base + iv + floor(ev/4)) * level) / 100) + level + 10
 * Other:floor(((((2*base + iv + floor(ev/4)) * level) / 100) + 5) * nature_mult)
 */
export function gen3Stats(
  base: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number },
  ivs: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number },
  evs: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number },
  level: number,
  nature: number,
): Gen3Stats {
  const hp =
    Math.floor(((2 * base.hp + ivs.hp + Math.floor(evs.hp / 4)) * level) / 100) + level + 10;
  const atk = Math.floor(
    (Math.floor(((2 * base.atk + ivs.atk + Math.floor(evs.atk / 4)) * level) / 100) + 5) *
      natureMultiplier(nature, 'atk'),
  );
  const def = Math.floor(
    (Math.floor(((2 * base.def + ivs.def + Math.floor(evs.def / 4)) * level) / 100) + 5) *
      natureMultiplier(nature, 'def'),
  );
  const spa = Math.floor(
    (Math.floor(((2 * base.spa + ivs.spa + Math.floor(evs.spa / 4)) * level) / 100) + 5) *
      natureMultiplier(nature, 'spa'),
  );
  const spd = Math.floor(
    (Math.floor(((2 * base.spd + ivs.spd + Math.floor(evs.spd / 4)) * level) / 100) + 5) *
      natureMultiplier(nature, 'spd'),
  );
  const spe = Math.floor(
    (Math.floor(((2 * base.spe + ivs.spe + Math.floor(evs.spe / 4)) * level) / 100) + 5) *
      natureMultiplier(nature, 'spe'),
  );
  return { hp, atk, def, spa, spd, spe };
}
