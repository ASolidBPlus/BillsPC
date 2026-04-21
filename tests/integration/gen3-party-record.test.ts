/**
 * Party-record packer (100 bytes). Verifies:
 *   - first 80 bytes match `packBoxed` output exactly
 *   - tail layout matches PLAN §4.4 (status u32, level u8, mail u8,
 *     curHP/maxHP u16, atk/def/spe/spa/spd u16 — speed BEFORE specials)
 *   - stat values match the production `computeGen3Stats`
 */

import { describe, expect, it } from 'vitest';
import { convert, isRefusal, packBoxed, packParty } from '../../core/src/index.js';
import { computeGen3Stats } from '../../core/src/primitives/gen3StatFormula.js';
import { getPersonal } from '../../core/src/__internal__.js';
import { readU16LE, readU32LE } from '../../core/src/pack/leBytes.js';
import { snorlaxMaxTrained } from '../fixtures/snorlax-maxtrained.js';
import { alakazamCompetitive } from '../fixtures/alakazam-competitive.js';
import { pikachuUntrainedLv25 } from '../fixtures/pikachu-untrained-lv25.js';

const SRCS = [
  ['snorlax-maxtrained', snorlaxMaxTrained] as const,
  ['alakazam-competitive', alakazamCompetitive] as const,
  ['pikachu-untrained-lv25', pikachuUntrainedLv25] as const,
];

describe('packParty', () => {
  for (const [name, src] of SRCS) {
    it(`${name}: 100 bytes; first 80 == packBoxed`, () => {
      const it = convert(src);
      if (isRefusal(it)) throw new Error('unexpected refusal');
      const party = packParty(it);
      const boxed = packBoxed(it);
      expect(party.length).toBe(100);
      expect(party.slice(0, 80)).toEqual(boxed);
    });

    it(`${name}: tail layout matches stat formula`, () => {
      const it = convert(src);
      if (isRefusal(it)) throw new Error('unexpected refusal');
      const party = packParty(it);
      const personal = getPersonal(it.species);
      const stats = computeGen3Stats(personal.base, it.ivs, it.evs, it.level, it.nature);

      expect(readU32LE(party, 80)).toBe(0); // status
      expect(party[84]).toBe(it.level);
      expect(party[85]).toBe(0); // mail-remaining
      expect(readU16LE(party, 86)).toBe(stats.hp); // current HP
      expect(readU16LE(party, 88)).toBe(stats.hp); // max HP
      expect(readU16LE(party, 90)).toBe(stats.atk);
      expect(readU16LE(party, 92)).toBe(stats.def);
      expect(readU16LE(party, 94)).toBe(stats.spe); // speed BEFORE specials
      expect(readU16LE(party, 96)).toBe(stats.spa);
      expect(readU16LE(party, 98)).toBe(stats.spd);
    });
  }
});
