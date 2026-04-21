import { baseGen2 } from './common.js';

/** Snorlax, fully trained (all StatExp = 65535) — §9 row 5 / EV case B. */
export const snorlaxMaxTrained = baseGen2({
  speciesGen2Id: 143,
  level: 100,
  dvs: { atk: 15, def: 15, spe: 15, special: 15 },
  statExp: {
    hp: 65535,
    atk: 65535,
    def: 65535,
    spe: 65535,
    special: 65535,
  },
});
