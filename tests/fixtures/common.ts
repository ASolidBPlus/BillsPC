import type { Gen12Pokemon } from '../../core/src/types/source.js';

/** Encode an ASCII OT name into Gen 1/2 bytes (A = 0x80, a = 0xA0, etc.). */
export function encodeAsciiGen12(text: string, terminator = true, padTo?: number): Uint8Array {
  const bytes: number[] = [];
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (ch === ' ') bytes.push(0x7f);
    else if (code >= 65 && code <= 90) bytes.push(0x80 + (code - 65));
    else if (code >= 97 && code <= 122) bytes.push(0xa0 + (code - 97));
    else if (code >= 48 && code <= 57) bytes.push(0xf6 + (code - 48));
    else bytes.push(0xe6); // '?' fallback
  }
  if (terminator) bytes.push(0x50);
  if (padTo !== undefined) {
    while (bytes.length < padTo) bytes.push(0x50);
  }
  return Uint8Array.from(bytes);
}

/** A baseline Gen 2 Pokemon used by fixtures. */
export function baseGen2(partial: Partial<Gen12Pokemon>): Gen12Pokemon {
  const base: Gen12Pokemon = {
    sourceGen: 2,
    speciesGen2Id: 143, // Snorlax
    level: 50,
    exp: 125000,
    dvs: { atk: 10, def: 10, spe: 10, special: 10 },
    statExp: { hp: 0, atk: 0, def: 0, spe: 0, special: 0 },
    moves: [33, 34, 35, 36],
    pp: [30, 25, 20, 15],
    ppUps: [0, 0, 0, 0],
    heldItemGen2Id: null,
    friendship: 70,
    pokerusByte: 0,
    otNameBytes: encodeAsciiGen12('ASH'),
    tid: 12345,
    nicknameBytes: encodeAsciiGen12('SNORLAX'),
    language: 2,
    otGender: 0,
  };
  return { ...base, ...partial };
}
