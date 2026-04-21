import { describe, expect, it } from 'vitest';
import { decodeAttacks, encodeAttacks } from '../../core/src/pack/attacks.js';
import {
  decodeGrowth,
  encodeGrowth,
  packPpBonuses,
  unpackPpBonuses,
} from '../../core/src/pack/growth.js';
import { decodeEvsCondition, encodeEvsCondition } from '../../core/src/pack/evsCondition.js';
import { decodeMisc, encodeMisc } from '../../core/src/pack/misc.js';
import { convert } from '../../core/src/index.js';
import { isRefusal } from '../../core/src/index.js';
import { snorlaxMaxTrained } from '../fixtures/snorlax-maxtrained.js';
import { readU16LE, readU32LE } from '../../core/src/pack/leBytes.js';
import type { Gen3Intermediate } from '../../core/src/types/target.js';

function intermediate(): Gen3Intermediate {
  const out = convert(snorlaxMaxTrained, { rng: undefined });
  if (isRefusal(out)) throw new Error('expected non-refusal');
  return out;
}

describe('Growth substructure', () => {
  it('round-trips encode/decode for snorlax fixture', () => {
    const it = intermediate();
    const bytes = encodeGrowth(it);
    expect(bytes.length).toBe(12);
    const decoded = decodeGrowth(bytes);
    expect(decoded.species).toBe(it.species);
    expect(decoded.heldItem).toBe(it.heldItem);
    expect(decoded.exp).toBe(it.exp);
    expect(decoded.friendship).toBe(it.friendship);
    expect(decoded.ppUps).toEqual(it.ppUps);
  });

  it('species at offset 0 (LE u16), exp at offset 4 (LE u32)', () => {
    const it = intermediate();
    const bytes = encodeGrowth(it);
    expect(readU16LE(bytes, 0)).toBe(it.species);
    expect(readU32LE(bytes, 4)).toBe(it.exp);
  });

  it('packPpBonuses packs slot 0 in low bits', () => {
    expect(packPpBonuses([0, 0, 0, 0])).toBe(0);
    expect(packPpBonuses([3, 0, 0, 0])).toBe(0b00000011);
    expect(packPpBonuses([0, 3, 0, 0])).toBe(0b00001100);
    expect(packPpBonuses([3, 3, 3, 3])).toBe(0xff);
    expect(unpackPpBonuses(0xff)).toEqual([3, 3, 3, 3]);
    expect(unpackPpBonuses(0)).toEqual([0, 0, 0, 0]);
  });
});

describe('Attacks substructure', () => {
  it('round-trips encode/decode', () => {
    const it = intermediate();
    const bytes = encodeAttacks(it);
    expect(bytes.length).toBe(12);
    const decoded = decodeAttacks(bytes);
    expect(decoded.moves).toEqual(it.moves);
    expect(decoded.pp).toEqual(it.pp);
  });

  it('moves at u16 offsets 0/2/4/6', () => {
    const it = intermediate();
    const bytes = encodeAttacks(it);
    expect(readU16LE(bytes, 0)).toBe(it.moves[0]);
    expect(readU16LE(bytes, 2)).toBe(it.moves[1]);
    expect(readU16LE(bytes, 4)).toBe(it.moves[2]);
    expect(readU16LE(bytes, 6)).toBe(it.moves[3]);
  });
});

describe('EVs/Condition substructure', () => {
  it('reorders evs to wire order H/A/D/Spe/SpA/SpD', () => {
    const it = intermediate();
    const bytes = encodeEvsCondition(it);
    expect(bytes[0]).toBe(it.evs.hp);
    expect(bytes[1]).toBe(it.evs.atk);
    expect(bytes[2]).toBe(it.evs.def);
    expect(bytes[3]).toBe(it.evs.spe); // speed before specials
    expect(bytes[4]).toBe(it.evs.spa);
    expect(bytes[5]).toBe(it.evs.spd);
  });

  it('contest stats are all zero (S1 invariant)', () => {
    const it = intermediate();
    const bytes = encodeEvsCondition(it);
    for (let off = 6; off < 12; off++) expect(bytes[off]).toBe(0);
  });

  it('round-trips encode/decode', () => {
    const it = intermediate();
    const bytes = encodeEvsCondition(it);
    const decoded = decodeEvsCondition(bytes);
    expect(decoded.evs).toEqual(it.evs);
  });
});

describe('Misc substructure', () => {
  it('round-trips encode/decode (IVs reordered to wire order)', () => {
    const it = intermediate();
    const bytes = encodeMisc(it, it.sid);
    expect(bytes.length).toBe(12);
    const decoded = decodeMisc(bytes);
    expect(decoded.ivs).toEqual(it.ivs);
    expect(decoded.metLocation).toBe(146);
    expect(decoded.metLevel).toBe(5);
    expect(decoded.isEgg).toBe(false);
    expect(decoded.abilityBit).toBe(0);
    expect(decoded.ribbonsAndObedience).toBe(0);
  });

  it('IV bit packing: HP[0..4], Atk[5..9], Def[10..14], Spe[15..19], SpA[20..24], SpD[25..29]', () => {
    const it = intermediate();
    const bytes = encodeMisc(it, it.sid);
    const word = readU32LE(bytes, 4);
    expect((word >>> 0) & 0x1f).toBe(it.ivs.hp);
    expect((word >>> 5) & 0x1f).toBe(it.ivs.atk);
    expect((word >>> 10) & 0x1f).toBe(it.ivs.def);
    expect((word >>> 15) & 0x1f).toBe(it.ivs.spe); // speed before specials
    expect((word >>> 20) & 0x1f).toBe(it.ivs.spa);
    expect((word >>> 25) & 0x1f).toBe(it.ivs.spd);
    expect((word >>> 30) & 0x1).toBe(0); // isEgg
    expect((word >>> 31) & 0x1).toBe(0); // abilityBit
  });

  it('originsInfo packs metLevel 5, originGame FRLG (4), ball Pokeball (4)', () => {
    const it = intermediate();
    const bytes = encodeMisc(it, it.sid);
    const word = readU16LE(bytes, 2);
    expect(word & 0x7f).toBe(5); // metLevel
    expect((word >>> 7) & 0xf).toBe(4); // origin = FRLG
    expect((word >>> 11) & 0xf).toBe(4); // ball = Pokeball
  });
});
