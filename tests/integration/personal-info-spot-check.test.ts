import { describe, it, expect } from 'vitest';
import { getPersonal } from '../../core/src/__internal__.js';

/** PLAN_EVAL A15: spot-check 10 species to catch transcription typos. */
describe('personal-info spot checks', () => {
  it('Bulbasaur (1): 12.5% F, friendship 70, Overgrow', () => {
    const p = getPersonal(1);
    expect(p.genderRatio).toBe(31);
    expect(p.baseFriendship).toBe(70);
    expect(p.ability0).toBe(65); // Overgrow
  });

  it('Pikachu (25): 50% F, friendship 70, Static', () => {
    const p = getPersonal(25);
    expect(p.genderRatio).toBe(127);
    expect(p.baseFriendship).toBe(70);
    expect(p.ability0).toBe(9); // Static
  });

  it('Mewtwo (150): genderless, friendship 0, Pressure', () => {
    const p = getPersonal(150);
    expect(p.genderRatio).toBe(255);
    expect(p.baseFriendship).toBe(0);
    expect(p.ability0).toBe(46); // Pressure
  });

  it('Snorlax (143): 12.5% F, friendship 70, Immunity', () => {
    const p = getPersonal(143);
    expect(p.genderRatio).toBe(31);
    expect(p.baseFriendship).toBe(70);
    expect(p.ability0).toBe(17); // Immunity
  });

  it('Dragonite (149): 12.5% F, friendship 35, Inner Focus', () => {
    const p = getPersonal(149);
    expect(p.genderRatio).toBe(31); // 12.5% female (Dratini line is male-biased)
    expect(p.baseFriendship).toBe(35);
    expect(p.ability0).toBe(39); // InnerFocus
  });

  it('Chikorita (152): 12.5% F, friendship 70, Overgrow', () => {
    const p = getPersonal(152);
    expect(p.genderRatio).toBe(31);
    expect(p.baseFriendship).toBe(70);
    expect(p.ability0).toBe(65);
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

  it('Celebi (251): genderless, friendship 100, Natural Cure', () => {
    const p = getPersonal(251);
    expect(p.genderRatio).toBe(255);
    expect(p.baseFriendship).toBe(100);
    expect(p.ability0).toBe(30); // NaturalCure
  });

  it('Kingdra (230): 50% F, friendship 70, SwiftSwim', () => {
    const p = getPersonal(230);
    expect(p.genderRatio).toBe(127);
    expect(p.baseFriendship).toBe(70);
    expect(p.ability0).toBe(33); // SwiftSwim
  });
});
