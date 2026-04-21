/**
 * Growth substructure (12 bytes). Layout per Bulbapedia §Substructure G
 * and PKHeX `PK3.cs`.
 *
 *   off 0  u16  species
 *   off 2  u16  heldItem
 *   off 4  u32  experience
 *   off 8  u8   ppBonuses (2 bits per move slot, slot 0 = bits 1..0)
 *   off 9  u8   friendship (0..255)
 *   off 10 u16  unused / pad (PKHeX `G_Unused_A`); always 0
 */

import type { Gen3Intermediate } from '../types/target.js';
import { readU16LE, readU32LE, writeU16LE, writeU32LE } from './leBytes.js';

export const GROWTH_SIZE = 12;

export interface GrowthPartial {
  readonly species: number;
  readonly heldItem: number;
  readonly exp: number;
  readonly ppUps: readonly [number, number, number, number];
  readonly friendship: number;
}

export function encodeGrowth(intermediate: Gen3Intermediate): Uint8Array {
  const out = new Uint8Array(GROWTH_SIZE);
  writeU16LE(out, 0, intermediate.species);
  writeU16LE(out, 2, intermediate.heldItem);
  writeU32LE(out, 4, intermediate.exp);
  out[8] = packPpBonuses(intermediate.ppUps);
  out[9] = intermediate.friendship & 0xff;
  // out[10..12] left at 0 (G_Unused_A pad).
  return out;
}

export function decodeGrowth(bytes: Uint8Array): GrowthPartial {
  if (bytes.length !== GROWTH_SIZE) {
    throw new RangeError(`decodeGrowth expected ${GROWTH_SIZE} bytes, got ${bytes.length}`);
  }
  return {
    species: readU16LE(bytes, 0),
    heldItem: readU16LE(bytes, 2),
    exp: readU32LE(bytes, 4),
    ppUps: unpackPpBonuses(bytes[8]!),
    friendship: bytes[9]!,
  };
}

/** Slot 0 in bits 1..0, slot 3 in bits 7..6. Each value masked to 2 bits. */
export function packPpBonuses(ppUps: readonly [number, number, number, number]): number {
  return (
    ((ppUps[0] & 0x3) << 0) |
    ((ppUps[1] & 0x3) << 2) |
    ((ppUps[2] & 0x3) << 4) |
    ((ppUps[3] & 0x3) << 6)
  );
}

export function unpackPpBonuses(byte: number): readonly [number, number, number, number] {
  return [(byte >>> 0) & 0x3, (byte >>> 2) & 0x3, (byte >>> 4) & 0x3, (byte >>> 6) & 0x3] as const;
}
