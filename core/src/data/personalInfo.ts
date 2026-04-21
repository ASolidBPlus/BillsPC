import raw from './raw/personal-gen3.json' with { type: 'json' };

export interface PersonalInfo {
  readonly gen3DexId: number;
  /**
   * Gender ratio byte (Gen 3 R/S convention):
   *   0   = male-only
   *   254 = female-only
   *   255 = genderless
   *   else = female threshold; `pid & 0xFF < ratio` ⇒ female.
   *
   * Common non-extreme values: 31 (12.5% F), 63 (25% F),
   * 127 (50% F), 191 (75% F), 223 (87.5% F).
   */
  readonly genderRatio: number;
  /** Species base friendship (used for Gen 1 sources that lack the field). */
  readonly baseFriendship: number;
  /** Primary ability (slot 0) — always used per HANDOFF §4.14. */
  readonly ability0: number;
  /**
   * Gen 3 species base stats. Field order is the canonical
   * `hp, atk, def, spa, spd, spe` (matches `Gen3Intermediate.ivs`/`evs`),
   * NOT the wire-stored `hp, atk, def, spe, spa, spd` order. The packer
   * reorders when writing to bytes.
   */
  readonly base: {
    readonly hp: number;
    readonly atk: number;
    readonly def: number;
    readonly spa: number;
    readonly spd: number;
    readonly spe: number;
  };
}

const TABLE: ReadonlyMap<number, PersonalInfo> = new Map(
  (raw as readonly PersonalInfo[]).map((p) => [p.gen3DexId, p] as const),
);

export function getPersonal(gen3DexId: number): PersonalInfo {
  const p = TABLE.get(gen3DexId);
  if (!p) throw new Error(`Unknown Gen 3 dex id for personal-info lookup: ${gen3DexId}`);
  return p;
}
