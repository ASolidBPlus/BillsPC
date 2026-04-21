import { describe, it, expect } from 'vitest';
import { convert, isRefusal } from '../../core/src/index.js';
import { deriveIVs, seedRng } from '../../core/src/__internal__.js';
import { snorlaxMaxTrained } from '../fixtures/snorlax-maxtrained.js';
import { pikachuUntrainedLv25 } from '../fixtures/pikachu-untrained-lv25.js';

describe('determinism', () => {
  it('convert(x) == convert(x) on Snorlax fixture (deep equal)', () => {
    const a = convert(snorlaxMaxTrained);
    const b = convert(snorlaxMaxTrained);
    expect(a).toEqual(b);
  });

  it('convert(x) == convert(x) on Pikachu fixture', () => {
    const a = convert(pikachuUntrainedLv25);
    const b = convert(pikachuUntrainedLv25);
    expect(a).toEqual(b);
  });

  it('different species produce different PIDs', () => {
    const a = convert(snorlaxMaxTrained);
    const b = convert(pikachuUntrainedLv25);
    if (isRefusal(a) || isRefusal(b)) throw new Error('unexpected refusal');
    expect(a.pid).not.toBe(b.pid);
  });

  it('deriveIVs is deterministic under a fixed seed', () => {
    const dvs = { atk: 10, def: 12, spe: 8, special: 14 };
    const s = new Uint8Array([1, 2, 3, 4]);
    const r1 = deriveIVs(dvs, seedRng(s), { preserveZeroDV: false });
    const r2 = deriveIVs(dvs, seedRng(s), { preserveZeroDV: false });
    expect(r1.ivs).toEqual(r2.ivs);
  });

  it('same trainer, different species → different PID but same SID (PLAN_EVAL A7)', () => {
    const a = convert({ ...snorlaxMaxTrained, speciesGen2Id: 143 });
    const b = convert({ ...snorlaxMaxTrained, speciesGen2Id: 25 });
    if (isRefusal(a) || isRefusal(b)) throw new Error('unexpected refusal');
    expect(a.sid).toBe(b.sid);
    expect(a.tid).toBe(b.tid);
    expect(a.pid).not.toBe(b.pid);
  });

  it('different OT bytes → different SID', () => {
    const a = convert(snorlaxMaxTrained);
    const b = convert({
      ...snorlaxMaxTrained,
      otNameBytes: new Uint8Array([0x80, 0x81, 0x82, 0x50]),
    });
    if (isRefusal(a) || isRefusal(b)) throw new Error('unexpected refusal');
    expect(a.sid).not.toBe(b.sid);
  });
});
