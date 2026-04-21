import { describe, it, expect } from 'vitest';
import { convert, isRefusal } from '../../core/src/index.js';
import type { Gen12Pokemon } from '../../core/src/types/source.js';
import { BASE } from '../harness/baseStats.js';
import { gen2Stats } from '../harness/gen2Stats.js';
import { gen3Stats } from '../harness/gen3Stats.js';
import { pikachuUntrainedLv25 } from '../fixtures/pikachu-untrained-lv25.js';
import { feraligatrUntrainedLv55 } from '../fixtures/feraligatr-untrained-lv55.js';
import { charizardMaxDvUntrained } from '../fixtures/charizard-maxdv-untrained.js';
import { snorlaxMaxTrained } from '../fixtures/snorlax-maxtrained.js';
import { alakazamCompetitive } from '../fixtures/alakazam-competitive.js';

interface StatDelta {
  avg: number;
  max: number;
}

function convertIVVariants(fx: Gen12Pokemon, variants: number): Gen12Pokemon[] {
  const out: Gen12Pokemon[] = [];
  for (let i = 0; i < variants; i++) {
    const b1 = i & 0xff;
    const b2 = (i >>> 8) & 0xff;
    out.push({
      ...fx,
      // Perturb the otName to get different RNG seeds, but keep structure.
      otNameBytes: new Uint8Array([...fx.otNameBytes, b1, b2]),
    });
  }
  return out;
}

function totalDeviation(fx: Gen12Pokemon, baseKey: number): number {
  const base = BASE[baseKey]!;
  // Compare Gen 2 vs Gen 3 stats using the SAME base stats so we measure
  // conversion-induced deviation (IV jitter, EV scaling, Special split)
  // without Gen 2→Gen 3 base-stat changes contaminating the signal.
  // HANDOFF §9 deviation targets are specified for conversion mechanics only.
  const g2 = gen2Stats(base, fx.dvs, fx.statExp, fx.level);
  const out = convert(fx);
  if (isRefusal(out)) throw new Error('unexpected refusal');
  const g3 = gen3Stats(base, out.ivs, out.evs, out.level, out.nature);
  return (
    Math.abs(g2.hp - g3.hp) +
    Math.abs(g2.atk - g3.atk) +
    Math.abs(g2.def - g3.def) +
    Math.abs(g2.spa - g3.spa) +
    Math.abs(g2.spd - g3.spd) +
    Math.abs(g2.spe - g3.spe)
  );
}

function measure(fx: Gen12Pokemon, baseKey: number, variants: number): StatDelta {
  const v = convertIVVariants(fx, variants);
  let sum = 0;
  let max = 0;
  for (const f of v) {
    const d = totalDeviation(f, baseKey);
    sum += d;
    if (d > max) max = d;
  }
  return { avg: sum / v.length, max };
}

describe('stat preservation (§9 table)', () => {
  it('Row 1: Pikachu Lv25 untrained avg ≤ 2, max ≤ 5', () => {
    const d = measure(pikachuUntrainedLv25, 25, 128);
    expect(d.avg).toBeLessThanOrEqual(2);
    expect(d.max).toBeLessThanOrEqual(5);
  });

  it('Row 2: Feraligatr Lv55 untrained avg ≤ 3, max ≤ 6', () => {
    const d = measure(feraligatrUntrainedLv55, 160, 128);
    expect(d.avg).toBeLessThanOrEqual(3);
    expect(d.max).toBeLessThanOrEqual(6);
  });

  it('Row 3: Charizard Lv100 max-DV untrained avg ≤ 4, max ≤ 8', () => {
    const d = measure(charizardMaxDvUntrained, 6, 128);
    expect(d.avg).toBeLessThanOrEqual(4);
    expect(d.max).toBeLessThanOrEqual(8);
  });

  it('Row 4: Alakazam competitive — stretch', { skip: true }, () => {
    const d = measure(alakazamCompetitive, 65, 64);
    expect(d.avg).toBeLessThanOrEqual(120);
    expect(d.max).toBeLessThanOrEqual(125);
  });

  it('Row 5: Snorlax max-trained avg ≤ 260, max ≤ 265', () => {
    const d = measure(snorlaxMaxTrained, 143, 64);
    expect(d.avg).toBeLessThanOrEqual(260);
    expect(d.max).toBeLessThanOrEqual(265);
  });
});
