import { describe, it, expect } from 'vitest';
import { convert, isRefusal } from '../../core/src/index.js';
import { searchPID, hashConcat } from '../../core/src/__internal__.js';
import { snorlaxMaxTrained } from '../fixtures/snorlax-maxtrained.js';
import { pikachuUntrainedLv25 } from '../fixtures/pikachu-untrained-lv25.js';
import { feraligatrUntrainedLv55 } from '../fixtures/feraligatr-untrained-lv55.js';
import { charizardMaxDvUntrained } from '../fixtures/charizard-maxdv-untrained.js';

describe('searchPID constraint satisfaction', () => {
  it('finds a valid PID quickly for a standard fixture', () => {
    const out = convert(snorlaxMaxTrained);
    expect(isRefusal(out)).toBe(false);
    if (isRefusal(out)) throw new Error('unreachable');
    expect(out._meta.pidSearchIterations).toBeGreaterThan(0);
    // Nature constraint satisfied.
    expect(out.pid % 25).toBe(out.nature);
  });

  it('hard cap throws on impossible constraints', () => {
    // Build inputs with a gender that can never match: require male but
    // species is female-only (ratio 254).
    expect(() =>
      searchPID({
        seed: hashConcat('impossible'),
        nature: 0,
        targetGender: 0,
        genderRatioByte: 254, // forces female
        isShiny: false,
        tid: 0,
        sid: 0,
        ivs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
        isUnown: false,
        unownLetter: null,
        warnThreshold: 100,
        hardCap: 500,
      }),
    ).toThrow();
  });

  it('§9 non-stretch fixtures converge in < 1000 iterations (PLAN_EVAL A8)', () => {
    const fixtures = [
      pikachuUntrainedLv25,
      feraligatrUntrainedLv55,
      charizardMaxDvUntrained,
      snorlaxMaxTrained,
    ];
    for (const fx of fixtures) {
      const out = convert(fx);
      if (isRefusal(out)) throw new Error(`Unexpected refusal for fixture`);
      expect(out._meta.pidSearchIterations).toBeLessThan(1000);
    }
  });
});
