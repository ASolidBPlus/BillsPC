import { baseGen2 } from './common.js';

/** §9 row 4: Lv100 max-DV Alakazam, fully trained on Spe + Special. */
export const alakazamCompetitive = baseGen2({
  speciesGen2Id: 65,
  level: 100,
  dvs: { atk: 15, def: 15, spe: 15, special: 15 },
  statExp: { hp: 0, atk: 0, def: 0, spe: 65535, special: 65535 },
});
