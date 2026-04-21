import { describe, it, expect } from 'vitest';
import { getPersonal } from '../../core/src/__internal__.js';

/**
 * PLAN_EVAL A15: spot-check species to catch transcription typos.
 *
 * The original 10-species check (prior sprint) asserted values that matched
 * a hand-transcribed `personal-gen3.json` containing 36 errors — see
 * EVAL.md AMEND-5. After regenerating the JSON from PKHeX's `personal_rs`
 * (scripts/gen-personal-info.ts), these assertions are re-derived from the
 * canonical binary and cover every distinct gender-ratio byte value that
 * appears among Gen 1/2 species (0, 31, 63, 127, 191, 254, 255).
 *
 * Ability IDs follow PKHeX.Core ability enumeration (slot 0 = Ability1).
 */
describe('personal-info spot checks', () => {
  // ---- gender byte 0 (male-only) ----
  it('Hitmonlee (106): male-only, friendship 70, Limber', () => {
    const p = getPersonal(106);
    expect(p.genderRatio).toBe(0);
    expect(p.baseFriendship).toBe(70);
    expect(p.ability0).toBe(7);
  });

  it('Hitmonchan (107): male-only, friendship 70, KeenEye', () => {
    const p = getPersonal(107);
    expect(p.genderRatio).toBe(0);
    expect(p.baseFriendship).toBe(70);
    expect(p.ability0).toBe(51);
  });

  it('Tauros (128): male-only, friendship 70, Intimidate', () => {
    const p = getPersonal(128);
    expect(p.genderRatio).toBe(0);
    expect(p.baseFriendship).toBe(70);
    expect(p.ability0).toBe(22);
  });

  it('Tyrogue (236): male-only, friendship 70, Guts', () => {
    const p = getPersonal(236);
    expect(p.genderRatio).toBe(0);
    expect(p.baseFriendship).toBe(70);
  });

  it('Hitmontop (237): male-only, friendship 70, Intimidate', () => {
    const p = getPersonal(237);
    expect(p.genderRatio).toBe(0);
    expect(p.ability0).toBe(22);
  });

  // ---- gender byte 31 (12.5% female) ----
  it('Bulbasaur (1): 12.5% F, friendship 70, Overgrow', () => {
    const p = getPersonal(1);
    expect(p.genderRatio).toBe(31);
    expect(p.baseFriendship).toBe(70);
    expect(p.ability0).toBe(65);
  });

  it('Charmander (4): 12.5% F, friendship 70, Blaze', () => {
    const p = getPersonal(4);
    expect(p.genderRatio).toBe(31);
    expect(p.baseFriendship).toBe(70);
    expect(p.ability0).toBe(66);
  });

  it('Squirtle (7): 12.5% F, friendship 70, Torrent', () => {
    const p = getPersonal(7);
    expect(p.genderRatio).toBe(31);
    expect(p.ability0).toBe(67);
  });

  it('Snorlax (143): 12.5% F, friendship 70, Immunity', () => {
    const p = getPersonal(143);
    expect(p.genderRatio).toBe(31);
    expect(p.baseFriendship).toBe(70);
    expect(p.ability0).toBe(17);
  });

  it('Omanyte (138): 12.5% F (Gen 3 corrects Gen-1 fossil line)', () => {
    const p = getPersonal(138);
    expect(p.genderRatio).toBe(31);
  });

  it('Chikorita (152): 12.5% F, friendship 70, Overgrow', () => {
    const p = getPersonal(152);
    expect(p.genderRatio).toBe(31);
    expect(p.baseFriendship).toBe(70);
    expect(p.ability0).toBe(65);
  });

  it('Umbreon (197): 12.5% F, friendship 35 (met-at-night line)', () => {
    const p = getPersonal(197);
    expect(p.genderRatio).toBe(31);
    expect(p.baseFriendship).toBe(35);
  });

  // ---- gender byte 63 (25% female) ----
  it('Abra (63): 25% F, Synchronize', () => {
    const p = getPersonal(63);
    expect(p.genderRatio).toBe(63);
    expect(p.baseFriendship).toBe(70);
    expect(p.ability0).toBe(28);
  });

  it('Machop (66): 25% F, Guts', () => {
    const p = getPersonal(66);
    expect(p.genderRatio).toBe(63);
    expect(p.ability0).toBe(62);
  });

  it('Electabuzz (125): 25% F, Static', () => {
    const p = getPersonal(125);
    expect(p.genderRatio).toBe(63);
    expect(p.ability0).toBe(9);
  });

  // ---- gender byte 127 (50/50) ----
  it('Pidgey (16): 50% F, friendship 70', () => {
    const p = getPersonal(16);
    expect(p.genderRatio).toBe(127);
    expect(p.baseFriendship).toBe(70);
    expect(p.ability0).toBe(51);
  });

  it('Rattata (19): 50% F, friendship 70', () => {
    const p = getPersonal(19);
    expect(p.genderRatio).toBe(127);
    expect(p.ability0).toBe(50);
  });

  it('Pikachu (25): 50% F, friendship 70, Static', () => {
    const p = getPersonal(25);
    expect(p.genderRatio).toBe(127);
    expect(p.baseFriendship).toBe(70);
    expect(p.ability0).toBe(9);
  });

  it('Pinsir (127): 50% F', () => {
    const p = getPersonal(127);
    expect(p.genderRatio).toBe(127);
  });

  it('Dratini (147): 50% F, friendship 35 (Dragon line)', () => {
    const p = getPersonal(147);
    expect(p.genderRatio).toBe(127);
    expect(p.baseFriendship).toBe(35);
  });

  it('Dragonite (149): 50% F, friendship 35, InnerFocus', () => {
    const p = getPersonal(149);
    expect(p.genderRatio).toBe(127);
    expect(p.baseFriendship).toBe(35);
    expect(p.ability0).toBe(39);
  });

  it('Mareep (179)-class / Kingdra (230): 50% F, SwiftSwim', () => {
    const p = getPersonal(230);
    expect(p.genderRatio).toBe(127);
    expect(p.ability0).toBe(33);
  });

  it('Larvitar (246): 50% F, friendship 35 (Pseudolegendary)', () => {
    const p = getPersonal(246);
    expect(p.genderRatio).toBe(127);
    expect(p.baseFriendship).toBe(35);
  });

  it('Tyranitar (248): 50% F, SandStream', () => {
    const p = getPersonal(248);
    expect(p.genderRatio).toBe(127);
    expect(p.ability0).toBe(45);
  });

  // ---- gender byte 191 (75% female) ----
  it('Clefairy (35): 75% F, friendship 140, CuteCharm', () => {
    const p = getPersonal(35);
    expect(p.genderRatio).toBe(191);
    expect(p.baseFriendship).toBe(140);
    expect(p.ability0).toBe(56);
  });

  it('Jigglypuff (39): 75% F, CuteCharm', () => {
    const p = getPersonal(39);
    expect(p.genderRatio).toBe(191);
    expect(p.ability0).toBe(56);
  });

  it('Snubbull (209): 75% F', () => {
    const p = getPersonal(209);
    expect(p.genderRatio).toBe(191);
  });

  it('Corsola (222): 75% F', () => {
    const p = getPersonal(222);
    expect(p.genderRatio).toBe(191);
  });

  // ---- gender byte 254 (female-only) ----
  it('Chansey (113): female-only, friendship 140, NaturalCure', () => {
    const p = getPersonal(113);
    expect(p.genderRatio).toBe(254);
    expect(p.baseFriendship).toBe(140);
    expect(p.ability0).toBe(30);
  });

  it('Kangaskhan (115): female-only, EarlyBird', () => {
    const p = getPersonal(115);
    expect(p.genderRatio).toBe(254);
    expect(p.ability0).toBe(48);
  });

  it('Miltank (241): female-only, ThickFat', () => {
    const p = getPersonal(241);
    expect(p.genderRatio).toBe(254);
    expect(p.ability0).toBe(47);
  });

  // ---- gender byte 255 (genderless) ----
  it('Magnemite (81): genderless, MagnetPull', () => {
    const p = getPersonal(81);
    expect(p.genderRatio).toBe(255);
    expect(p.ability0).toBe(42);
  });

  it('Voltorb (100): genderless, SoundProof', () => {
    const p = getPersonal(100);
    expect(p.genderRatio).toBe(255);
    expect(p.ability0).toBe(43);
  });

  it('Staryu (120): genderless', () => {
    const p = getPersonal(120);
    expect(p.genderRatio).toBe(255);
    expect(p.ability0).toBe(35);
  });

  it('Ditto (132): genderless, Limber', () => {
    const p = getPersonal(132);
    expect(p.genderRatio).toBe(255);
    expect(p.ability0).toBe(7);
  });

  it('Porygon (137): genderless, Trace', () => {
    const p = getPersonal(137);
    expect(p.genderRatio).toBe(255);
    expect(p.ability0).toBe(36);
  });

  it('Mewtwo (150): genderless, friendship 0, Pressure', () => {
    const p = getPersonal(150);
    expect(p.genderRatio).toBe(255);
    expect(p.baseFriendship).toBe(0);
    expect(p.ability0).toBe(46);
  });

  it('Mew (151): genderless, friendship 100, Synchronize', () => {
    const p = getPersonal(151);
    expect(p.genderRatio).toBe(255);
    expect(p.baseFriendship).toBe(100);
    expect(p.ability0).toBe(28);
  });

  it('Unown (201): genderless', () => {
    const p = getPersonal(201);
    expect(p.genderRatio).toBe(255);
  });

  it('Lugia (249): genderless, friendship 0, Pressure', () => {
    const p = getPersonal(249);
    expect(p.genderRatio).toBe(255);
    expect(p.baseFriendship).toBe(0);
    expect(p.ability0).toBe(46);
  });

  it('Ho-Oh (250): genderless, friendship 0, Pressure', () => {
    const p = getPersonal(250);
    expect(p.genderRatio).toBe(255);
    expect(p.baseFriendship).toBe(0);
    expect(p.ability0).toBe(46);
  });

  it('Celebi (251): genderless, friendship 100, NaturalCure', () => {
    const p = getPersonal(251);
    expect(p.genderRatio).toBe(255);
    expect(p.baseFriendship).toBe(100);
    expect(p.ability0).toBe(30);
  });

  // ---- meta assertion: every distinct Gen-1/2 gender byte is covered above ----
  it('covers every distinct gender byte present in Gen 1/2 personal data', () => {
    const seen = new Set<number>();
    for (let id = 1; id <= 251; id++) seen.add(getPersonal(id).genderRatio);
    // Anchor the surprise: if PKHeX ever adds a new byte here, this fails loud.
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 31, 63, 127, 191, 254, 255]);
  });
});
