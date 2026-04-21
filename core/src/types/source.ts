/**
 * Source-side Gen 1/2 Pokemon model.
 *
 * Gen 1 lacks several fields (held item, friendship, pokerus, language).
 * Callers must still supply the Gen12Pokemon shape — use `sourceGen: 1` and the
 * documented defaults (`heldItemGen2Id: null`, `friendship: null`, `pokerusByte: 0`,
 * `ppUps: [0,0,0,0]`, `language: 2`).
 *
 * The S3 save-file reader will populate this struct from bytes; the conversion
 * core takes it as a plain typed input and is pure / synchronous.
 */

export type SourceGen = 1 | 2;

export interface Gen12DVs {
  readonly atk: number; // 0-15
  readonly def: number; // 0-15
  readonly spe: number; // 0-15
  readonly special: number; // 0-15 (shared SpA/SpD)
}

export interface Gen12StatExp {
  readonly hp: number; // 0-65535
  readonly atk: number; // 0-65535
  readonly def: number; // 0-65535
  readonly spe: number; // 0-65535
  readonly special: number; // 0-65535, shared SpA/SpD
}

export interface Gen12Pokemon {
  readonly sourceGen: SourceGen;
  readonly speciesGen2Id: number;
  readonly level: number;
  readonly exp: number;
  readonly dvs: Gen12DVs;
  readonly statExp: Gen12StatExp;
  readonly moves: readonly [number, number, number, number];
  readonly pp: readonly [number, number, number, number];
  readonly ppUps: readonly [number, number, number, number];
  readonly heldItemGen2Id: number | null;
  readonly friendship: number | null;
  readonly pokerusByte: number;
  readonly otNameBytes: Uint8Array;
  readonly tid: number;
  readonly nicknameBytes: Uint8Array;
  /**
   * Gen 3 language code. 1=JP, 2=EN, 3=FR, 4=IT, 5=DE, 7=ES.
   * Default 2 (English). S3 save-reader may override per cart region.
   */
  readonly language: number;
  /**
   * Optional caller-supplied entropy bytes mixed into the personality seed
   * (per PLAN_EVAL A12). If absent, the seed derives from
   * (otNameBytes || tid || speciesGen2Id || stable DV bytes).
   */
  readonly sourcePersonalityBytes?: Uint8Array;
  readonly otGender?: 0 | 1;
}

/**
 * Gen 2 HP DV derivation: LSBs of (Atk, Def, Spe, Special) packed MSB-first
 * as `(atk&1)<<3 | (def&1)<<2 | (spe&1)<<1 | (special&1)`.
 */
export function hpDv(dvs: Gen12DVs): number {
  return ((dvs.atk & 1) << 3) | ((dvs.def & 1) << 2) | ((dvs.spe & 1) << 1) | (dvs.special & 1);
}

/**
 * Gen 2 shiny check: `Def==Spe==Special==10` && `Atk in {2,3,6,7,10,11,14,15}`
 * (i.e., Atk DV LSBs `(atk>>1)&1 == 1` → low bit is binary 1 in bit1).
 * Simpler: Atk & 2 === 2 (the "2 or 3 or 6 or 7 or 10 or 11 or 14 or 15" set
 * is exactly `atk % 4 >= 2`).
 */
export function gen2Shiny(dvs: Gen12DVs): boolean {
  if (dvs.def !== 10 || dvs.spe !== 10 || dvs.special !== 10) return false;
  const atkLow = dvs.atk & 0x3;
  return atkLow === 2 || atkLow === 3;
}

/**
 * Species gender determination.
 * genderRatioByte: 0=male-only, 254=female-only, 255=genderless, else female threshold.
 * Gen 2 Atk DV < (threshold_nibble) → female.
 * The threshold nibble in Gen 2 maps to ratios as:
 *   255 → genderless (return 2)
 *   0   → always male
 *   254 → always female
 *   31  → ≥ atk_dv? Actually Gen2 uses a 4-bit threshold from personal data.
 *
 * We translate the Gen 3 byte threshold back to a Gen 2 nibble test:
 *   female if `dvs.atk * 16 < ratio`? No: Gen 2 test is simpler.
 *
 * Gen 2 gender algorithm (per Bulbapedia "Gender"):
 *   if Atk_DV < species_gender_threshold (a nibble 0..15) → female
 *   else → male
 * Threshold mapping:
 *   255 (genderless) → always genderless
 *   254 (female-only) → always female
 *   0 (male-only)   → always male
 *   31  → 1   (atk < 1 ⇒ 1/16 ≈ 6.25%? actually PKHeX ratio 31 = 12.5% female)
 *   63  → 2   (25%)
 *   127 → 8   (50%)
 *   191 → 12  (75%)
 *   223 → 14  (87.5%)
 */
export function gen2Gender(dvs: Gen12DVs, genderRatioByte: number): 0 | 1 | 2 {
  if (genderRatioByte === 255) return 2; // genderless
  if (genderRatioByte === 254) return 1; // female-only
  if (genderRatioByte === 0) return 0; // male-only
  const threshold = gen2GenderThreshold(genderRatioByte);
  return dvs.atk < threshold ? 1 : 0;
}

function gen2GenderThreshold(byte: number): number {
  switch (byte) {
    case 31:
      return 2;
    case 63:
      return 4;
    case 127:
      return 8;
    case 191:
      return 12;
    case 223:
      return 14;
    default:
      // Fallback: approximate (ratio byte out of 255 → nibble out of 16)
      return Math.floor((byte * 16) / 255);
  }
}
