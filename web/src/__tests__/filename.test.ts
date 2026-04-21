/**
 * Filename sanitisation. Per PLAN §6.5 and PLAN_EVAL: the Gen 1 default
 * nickname is the uppercase species name and must round-trip verbatim;
 * empty nicknames substitute `no-nickname`; collisions are not the
 * sanitiser's job (the zip prefixes with a slot index).
 */
import { describe, it, expect } from 'vitest';
import { sanitiseFilename } from '../filename.js';

describe('sanitiseFilename', () => {
  it('keeps an alphanumeric species/nickname/tid as-is', () => {
    expect(sanitiseFilename('Pikachu', 'Sparky', 12345)).toBe('Pikachu-Sparky-12345.pk3');
  });

  it('replaces non-safe characters with dashes and collapses runs', () => {
    expect(sanitiseFilename('Mr. Mime', 'Hi/There!', 42)).toBe('Mr.-Mime-Hi-There-42.pk3');
  });

  it('substitutes "no-nickname" when nickname is empty after sanitisation', () => {
    expect(sanitiseFilename('Charizard', '', 7)).toBe('Charizard-no-nickname-7.pk3');
    expect(sanitiseFilename('Charizard', '???', 7)).toBe('Charizard-no-nickname-7.pk3');
  });

  it('keeps Gen 1 default nicknames (uppercase species names) verbatim', () => {
    expect(sanitiseFilename('Clefairy', 'CLEFAIRY', 52308)).toBe('Clefairy-CLEFAIRY-52308.pk3');
  });

  it('truncates the species+nickname portion to 64 characters', () => {
    const longSpecies = 'A'.repeat(40);
    const longNick = 'B'.repeat(40);
    const out = sanitiseFilename(longSpecies, longNick, 1);
    const base = out.replace(/-1\.pk3$/, '');
    expect(base.length).toBeLessThanOrEqual(64);
    expect(out.endsWith('-1.pk3')).toBe(true);
  });

  it('is deterministic across calls', () => {
    const a = sanitiseFilename('Pidgeot', 'Pidgey!', 999);
    const b = sanitiseFilename('Pidgeot', 'Pidgey!', 999);
    expect(a).toBe(b);
  });

  it('two mons with same species/nickname/TID get identical sanitised filenames (zip prefix is the dedupe layer)', () => {
    const a = sanitiseFilename('Bulbasaur', 'BULBA', 1);
    const b = sanitiseFilename('Bulbasaur', 'BULBA', 1);
    expect(a).toBe(b);
  });

  it('falls back to "unknown" when species is also empty', () => {
    expect(sanitiseFilename('', '', 0)).toBe('unknown-no-nickname-0.pk3');
  });
});
