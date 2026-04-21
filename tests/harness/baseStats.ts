/**
 * Minimal base-stat table for the Pokemon that appear in the §9 fixtures.
 * Gen 3 values (R/S personal info). Only the stats we need for
 * stat-preservation tests. Gen 2 base stats are identical for these entries
 * in the cases we test (RBY/Gen2/Gen3 base-stat parity holds for these).
 *
 * Where Gen 2 differs (e.g., Gen 2 had a single Special stat), we use the
 * Gen 2 Special base as both SpA-base and SpD-base for the Gen 2 formula
 * reference.
 */
export interface BaseStatBlock {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
  /** Gen 2 Special base (when different from Gen 3 split). */
  spc?: number;
}

export const BASE: Readonly<Record<number, BaseStatBlock>> = {
  // Pikachu (Gen 2): HP 35, Atk 55, Def 30, Spe 90, Spc 50 (both SpA/SpD in Gen 3 = 50/40? R/S: SpA 50, SpD 40)
  // For Gen 2 single Special = 50; Gen 3 SpA=50, SpD=40.
  25: { hp: 35, atk: 55, def: 30, spa: 50, spd: 40, spe: 90, spc: 50 },
  // Charizard: Gen 3: 78/84/78/109/85/100. Gen 2: Spc=85.
  6: { hp: 78, atk: 84, def: 78, spa: 109, spd: 85, spe: 100, spc: 85 },
  // Feraligatr: Gen 3: 85/105/100/79/83/78. Gen 2: Spc=79.
  160: { hp: 85, atk: 105, def: 100, spa: 79, spd: 83, spe: 78, spc: 79 },
  // Snorlax: Gen 3: 160/110/65/65/110/30. Gen 2: Spc=65.
  143: { hp: 160, atk: 110, def: 65, spa: 65, spd: 110, spe: 30, spc: 65 },
  // Alakazam: Gen 3: 55/50/45/135/95/120. Gen 2: Spc=135.
  65: { hp: 55, atk: 50, def: 45, spa: 135, spd: 95, spe: 120, spc: 135 },
};
