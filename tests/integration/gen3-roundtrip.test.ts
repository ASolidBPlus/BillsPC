/**
 * Boxed pack/unpack round-trip across each non-refused §9 fixture.
 * `convert(src)` → `packBoxed` → `unpackBoxed` should yield a
 * `Gen3Intermediate` deep-equal to the original (modulo `_meta` and
 * the party-only fields `level` / `nature` per the boxed-record
 * inverse contract; see `intermediateDeepEqualExceptMeta`).
 */

import { describe, expect, it } from 'vitest';
import { convert, isDecodeError, isRefusal, packBoxed, unpackBoxed } from '../../core/src/index.js';
import type { Gen12Pokemon } from '../../core/src/types/source.js';
import { intermediateDeepEqualExceptMeta } from '../harness/intermediateEquals.js';
import { pikachuUntrainedLv25 } from '../fixtures/pikachu-untrained-lv25.js';
import { feraligatrUntrainedLv55 } from '../fixtures/feraligatr-untrained-lv55.js';
import { charizardMaxDvUntrained } from '../fixtures/charizard-maxdv-untrained.js';
import { alakazamCompetitive } from '../fixtures/alakazam-competitive.js';
import { snorlaxMaxTrained } from '../fixtures/snorlax-maxtrained.js';
import { partialTrained } from '../fixtures/partial-trained.js';

const FIXTURES: ReadonlyArray<readonly [string, Gen12Pokemon]> = [
  ['pikachu-untrained-lv25', pikachuUntrainedLv25],
  ['feraligatr-untrained-lv55', feraligatrUntrainedLv55],
  ['charizard-maxdv-lv100', charizardMaxDvUntrained],
  ['alakazam-competitive', alakazamCompetitive],
  ['snorlax-maxtrained', snorlaxMaxTrained],
  ['partial-trained', partialTrained],
];

describe('packBoxed / unpackBoxed round-trip', () => {
  for (const [name, src] of FIXTURES) {
    it(`round-trip: ${name}`, () => {
      const intermediate = convert(src);
      if (isRefusal(intermediate)) throw new Error(`${name}: unexpected refusal`);
      const packed = packBoxed(intermediate);
      expect(packed.length).toBe(80);
      const decoded = unpackBoxed(packed);
      if (isDecodeError(decoded)) {
        throw new Error(`${name}: decode error ${decoded.reason}: ${decoded.message}`);
      }
      const eq = intermediateDeepEqualExceptMeta(intermediate, decoded);
      expect(eq).toBe(true);
    });
  }
});
