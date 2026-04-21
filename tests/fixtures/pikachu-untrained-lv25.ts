import { baseGen2 } from './common.js';

/** §9 row 1: untrained Lv25 Pikachu (low DVs). */
export const pikachuUntrainedLv25 = baseGen2({
  speciesGen2Id: 25,
  level: 25,
  dvs: { atk: 4, def: 5, spe: 6, special: 7 },
  statExp: { hp: 0, atk: 0, def: 0, spe: 0, special: 0 },
  nicknameBytes: new Uint8Array([0x8f, 0x96, 0xa4, 0xa0, 0xa2, 0xa7, 0xaf, 0x50]),
});
