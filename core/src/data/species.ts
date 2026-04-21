import speciesRaw from './raw/species.json' with { type: 'json' };

export interface SpeciesEntry {
  readonly gen2Id: number;
  readonly gen3DexId: number;
  readonly name: string;
}

const SPECIES: readonly SpeciesEntry[] = speciesRaw as readonly SpeciesEntry[];

const BY_GEN2_ID: ReadonlyMap<number, SpeciesEntry> = new Map(
  SPECIES.map((s) => [s.gen2Id, s] as const),
);

export function getSpecies(gen2Id: number): SpeciesEntry | undefined {
  return BY_GEN2_ID.get(gen2Id);
}

export function allSpecies(): readonly SpeciesEntry[] {
  return SPECIES;
}
