import { baseGen2 } from './common.js';

/** §9 hardcoded EV case C: partial training. */
export const partialTrained = baseGen2({
  speciesGen2Id: 143,
  level: 50,
  dvs: { atk: 12, def: 8, spe: 10, special: 6 },
  statExp: {
    hp: 65535,
    atk: 65535,
    def: 10000,
    spe: 5000,
    special: 0,
  },
});
