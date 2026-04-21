import { describe, it, expect } from 'vitest';
import { getPersonal } from '../../core/src/__internal__.js';

/**
 * PLAN_EVAL A17: spot-check the new `PersonalInfo.base` field for the
 * highest-bug-density risk in S2. The 250×6 = 1500-value table was
 * regenerated from PKHeX's `personal_rs`, but we still need direct
 * value assertions to catch any silent transcription/regeneration drift.
 *
 * Values below are PKHeX-canonical Gen 3 (R/S/E/FRLG) base stats,
 * verified directly against the upstream `personal_rs` binary
 * (kwsch/PKHeX master). Notable transcription traps included:
 *   - Alakazam SpD = 85 in Gen 3 (Game Freak buffed it to 95 in Gen 6+;
 *     sources that backport from modern dex listings get this wrong).
 *   - Snorlax  SpD = 110 (NOT 65 — Gen 1's "Special" was a single number;
 *     when Gen 2 split it, Snorlax's SpD stayed at 110 rather than
 *     dropping to the original Gen 1 Special-Defense-equivalent.)
 *
 * Field order is the PersonalInfo canonical: hp/atk/def/spa/spd/spe.
 */
describe('personal-info base-stat spot checks (PLAN_EVAL A17)', () => {
  it('Bulbasaur (1): 45/49/49/65/65/45', () => {
    const b = getPersonal(1).base;
    expect(b.hp).toBe(45);
    expect(b.atk).toBe(49);
    expect(b.def).toBe(49);
    expect(b.spa).toBe(65);
    expect(b.spd).toBe(65);
    expect(b.spe).toBe(45);
  });

  it('Charizard (6): 78/84/78/109/85/100', () => {
    const b = getPersonal(6).base;
    expect(b.hp).toBe(78);
    expect(b.atk).toBe(84);
    expect(b.def).toBe(78);
    expect(b.spa).toBe(109);
    expect(b.spd).toBe(85);
    expect(b.spe).toBe(100);
  });

  it('Blastoise (9): 79/83/100/85/105/78', () => {
    const b = getPersonal(9).base;
    expect(b.hp).toBe(79);
    expect(b.atk).toBe(83);
    expect(b.def).toBe(100);
    expect(b.spa).toBe(85);
    expect(b.spd).toBe(105);
    expect(b.spe).toBe(78);
  });

  it('Pikachu (25): 35/55/30/50/40/90', () => {
    const b = getPersonal(25).base;
    expect(b.hp).toBe(35);
    expect(b.atk).toBe(55);
    expect(b.def).toBe(30);
    expect(b.spa).toBe(50);
    expect(b.spd).toBe(40);
    expect(b.spe).toBe(90);
  });

  it('Alakazam (65): 55/50/45/135/85/120 — Gen 3 SpD is 85 (Gen 6+ buffed to 95)', () => {
    const b = getPersonal(65).base;
    expect(b.hp).toBe(55);
    expect(b.atk).toBe(50);
    expect(b.def).toBe(45);
    expect(b.spa).toBe(135);
    expect(b.spd).toBe(85);
    expect(b.spe).toBe(120);
  });

  it('Snorlax (143): 160/110/65/65/110/30 — SpD trap (NOT 65)', () => {
    const b = getPersonal(143).base;
    expect(b.hp).toBe(160);
    expect(b.atk).toBe(110);
    expect(b.def).toBe(65);
    expect(b.spa).toBe(65);
    expect(b.spd).toBe(110);
    expect(b.spe).toBe(30);
  });

  it('Dragonite (149): 91/134/95/100/100/80', () => {
    const b = getPersonal(149).base;
    expect(b.hp).toBe(91);
    expect(b.atk).toBe(134);
    expect(b.def).toBe(95);
    expect(b.spa).toBe(100);
    expect(b.spd).toBe(100);
    expect(b.spe).toBe(80);
  });

  it('Mewtwo (150): 106/110/90/154/90/130', () => {
    const b = getPersonal(150).base;
    expect(b.hp).toBe(106);
    expect(b.atk).toBe(110);
    expect(b.def).toBe(90);
    expect(b.spa).toBe(154);
    expect(b.spd).toBe(90);
    expect(b.spe).toBe(130);
  });

  it('Feraligatr (160): 85/105/100/79/83/78', () => {
    const b = getPersonal(160).base;
    expect(b.hp).toBe(85);
    expect(b.atk).toBe(105);
    expect(b.def).toBe(100);
    expect(b.spa).toBe(79);
    expect(b.spd).toBe(83);
    expect(b.spe).toBe(78);
  });

  it('Unown (201): 48/72/48/72/48/48 — all-symmetric oddity', () => {
    const b = getPersonal(201).base;
    expect(b.hp).toBe(48);
    expect(b.atk).toBe(72);
    expect(b.def).toBe(48);
    expect(b.spa).toBe(72);
    expect(b.spd).toBe(48);
    expect(b.spe).toBe(48);
  });

  it('Celebi (251): 100/100/100/100/100/100 — uniform stats', () => {
    const b = getPersonal(251).base;
    expect(b.hp).toBe(100);
    expect(b.atk).toBe(100);
    expect(b.def).toBe(100);
    expect(b.spa).toBe(100);
    expect(b.spd).toBe(100);
    expect(b.spe).toBe(100);
  });

  // Generator-picked extra: Gyarados — physical sweeper with high SpD,
  // verified against PKHeX personal_rs (gen3DexId 130).
  it('Gyarados (130): 95/125/79/60/100/81', () => {
    const b = getPersonal(130).base;
    expect(b.hp).toBe(95);
    expect(b.atk).toBe(125);
    expect(b.def).toBe(79);
    expect(b.spa).toBe(60);
    expect(b.spd).toBe(100);
    expect(b.spe).toBe(81);
  });
});
