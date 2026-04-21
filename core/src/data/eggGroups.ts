import raw from './raw/egg-groups.json' with { type: 'json' };

/** Gen 3 egg group codes (PKHeX personal_rs convention). */
export enum EggGroup {
  Monster = 1,
  Water1 = 2,
  Bug = 3,
  Flying = 4,
  Field = 5,
  Fairy = 6,
  Grass = 7,
  HumanLike = 8,
  Water3 = 9,
  Mineral = 10,
  Amorphous = 11,
  Water2 = 12,
  Ditto = 13,
  Dragon = 14,
  Undiscovered = 15,
}

interface RawEntry {
  readonly gen2Id: number;
  readonly primary: number;
  readonly secondary: number;
}

const TABLE: ReadonlyMap<number, readonly [EggGroup, EggGroup]> = new Map(
  (raw as readonly RawEntry[]).map(
    (r) => [r.gen2Id, [r.primary as EggGroup, r.secondary as EggGroup] as const] as const,
  ),
);

export function getEggGroups(gen2Id: number): readonly [EggGroup, EggGroup] {
  const entry = TABLE.get(gen2Id);
  if (!entry) throw new Error(`Unknown species id for egg-group lookup: ${gen2Id}`);
  return entry;
}
