/**
 * Attacks substructure (12 bytes). Layout per Bulbapedia §Substructure A
 * and PKHeX `PK3.cs`.
 *
 *   off 0..1   u16 move1
 *   off 2..3   u16 move2
 *   off 4..5   u16 move3
 *   off 6..7   u16 move4
 *   off 8      u8  pp1 (current PP, masked to 6 bits)
 *   off 9      u8  pp2
 *   off 10     u8  pp3
 *   off 11     u8  pp4
 *
 * PKHeX masks PP with `& 0x3F` on read (bits 6..7 are reserved). The
 * Gen 1/2 sources cannot produce PP > 63 in practice (Hyper Beam base
 * 5 + 3 PP Ups = 8), so the mask on write is defensive — if a fixture
 * ever exceeds 63 we silently drop the high bits to keep round-trip
 * stable, per PLAN_EVAL A15.
 */

import type { Gen3Intermediate } from '../types/target.js';
import { readU16LE, writeU16LE } from './leBytes.js';

export const ATTACKS_SIZE = 12;

export interface AttacksPartial {
  readonly moves: readonly [number, number, number, number];
  readonly pp: readonly [number, number, number, number];
}

export function encodeAttacks(intermediate: Gen3Intermediate): Uint8Array {
  const out = new Uint8Array(ATTACKS_SIZE);
  writeU16LE(out, 0, intermediate.moves[0]);
  writeU16LE(out, 2, intermediate.moves[1]);
  writeU16LE(out, 4, intermediate.moves[2]);
  writeU16LE(out, 6, intermediate.moves[3]);
  out[8] = intermediate.pp[0] & 0x3f;
  out[9] = intermediate.pp[1] & 0x3f;
  out[10] = intermediate.pp[2] & 0x3f;
  out[11] = intermediate.pp[3] & 0x3f;
  return out;
}

export function decodeAttacks(bytes: Uint8Array): AttacksPartial {
  if (bytes.length !== ATTACKS_SIZE) {
    throw new RangeError(`decodeAttacks expected ${ATTACKS_SIZE} bytes, got ${bytes.length}`);
  }
  return {
    moves: [readU16LE(bytes, 0), readU16LE(bytes, 2), readU16LE(bytes, 4), readU16LE(bytes, 6)],
    pp: [bytes[8]! & 0x3f, bytes[9]! & 0x3f, bytes[10]! & 0x3f, bytes[11]! & 0x3f],
  };
}
