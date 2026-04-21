/**
 * Format autodetection.
 *
 * Per PLAN_EVAL A1: detection is structural-first. Checksum is computed
 * but only contributes a `checksum_mismatch` warning — never blocks
 * detection. The Crystal demo file's stored checksum is dead because
 * the emulator save-state export rebuilt SRAM without recomputing it.
 *
 * Order:
 *   1. Crystal probe (Crystal-only gender byte at 0x3E3D + party shape)
 *   2. Gold/Silver probe (party at 0x288A + name at 0x200B)
 *   3. RB probe (RB checksum + party at 0x2F2C)
 *   4. Yellow probe (RB layout + Pikachu friendship marker)
 *
 * Crystal and GS are matched before falling through to Gen 1 because
 * their fingerprints are cheap to test and their failure modes are
 * narrower.
 *
 * GS and Yellow detection match a "format string" but the calling
 * `parseSave` returns `UNSUPPORTED_VARIANT` for them — we have no
 * fixtures, so we refuse to silently parse them as Crystal/RB.
 */

import {
  RB_CHECKSUM_OFFSET,
  RB_CHECKSUM_RANGE_END_INCLUSIVE,
  RB_CHECKSUM_RANGE_START,
  RB_PARTY_COUNT_OFFSET,
  RB_PARTY_SPECIES_OFFSET,
  RB_TRAINER_NAME_OFFSET,
  RB_TRAINER_NAME_BYTES,
  YELLOW_PIKACHU_FRIENDSHIP_OFFSET,
} from './gen1/offsets.js';
import {
  C_CHECKSUM_OFFSET,
  C_CHECKSUM_RANGE_END_INCLUSIVE,
  C_CHECKSUM_RANGE_START,
  C_PARTY_COUNT_OFFSET,
  C_PARTY_SPECIES_OFFSET,
  C_TRAINER_GENDER_OFFSET,
  C_TRAINER_NAME_OFFSET,
  C_TRAINER_NAME_BYTES,
} from './gen2/offsetsCrystal.js';
import { CHARMAP12_TO_UNICODE, GEN12_TERMINATOR } from '../data/charmap12.js';
import type { SaveFormat } from '../types/sav.js';

/** Gen 1/2 species-list terminator. */
const SPECIES_LIST_TERMINATOR = 0xff;
const PARTY_COUNT_MAX = 6;
const PARTY_SPECIES_MAX_SCAN = 7;

// GS probe offsets (matches pokegold disasm). Detection-only — parser
// is deferred to a later sprint.
const GS_PARTY_COUNT_OFFSET = 0x288a;
const GS_PARTY_SPECIES_OFFSET = 0x288b;

export interface DetectionMatch {
  readonly format: SaveFormat;
  readonly checksumValid: boolean | null; // null when no checksum to test
}

export function detectFormat(sram: Uint8Array): DetectionMatch | null {
  if (sram.length < 0x4000) return null;

  if (looksLikeCrystal(sram)) {
    return { format: 'CRYSTAL', checksumValid: crystalChecksumValid(sram) };
  }
  if (looksLikeGS(sram)) {
    return { format: 'GS', checksumValid: null };
  }
  if (looksLikeRBOrYellow(sram)) {
    if (looksLikeYellow(sram)) {
      return { format: 'RBY-YELLOW', checksumValid: rbChecksumValid(sram) };
    }
    return { format: 'RBY-RED', checksumValid: rbChecksumValid(sram) };
  }
  return null;
}

/**
 * Lightweight sanity check used by length-triage as the head-vs-tail
 * window probe. Returns true if `sram` looks parseable as any of our
 * supported formats.
 */
export function structuralProbe(sram: Uint8Array): boolean {
  return detectFormat(sram) !== null;
}

function looksLikeCrystal(sram: Uint8Array): boolean {
  const gender = sram[C_TRAINER_GENDER_OFFSET];
  if (gender !== 0 && gender !== 1) return false;
  const partyCount = sram[C_PARTY_COUNT_OFFSET];
  if (partyCount === undefined || partyCount > PARTY_COUNT_MAX) return false;
  if (!speciesListTerminates(sram, C_PARTY_SPECIES_OFFSET, partyCount)) return false;
  if (!nameDecodesPlausibly(sram, C_TRAINER_NAME_OFFSET, C_TRAINER_NAME_BYTES)) return false;
  return true;
}

function looksLikeGS(sram: Uint8Array): boolean {
  const partyCount = sram[GS_PARTY_COUNT_OFFSET];
  if (partyCount === undefined || partyCount > PARTY_COUNT_MAX) return false;
  if (!speciesListTerminates(sram, GS_PARTY_SPECIES_OFFSET, partyCount)) return false;
  if (!nameDecodesPlausibly(sram, C_TRAINER_NAME_OFFSET, C_TRAINER_NAME_BYTES)) return false;
  // If gender byte is 0 or 1, it could be a Crystal save misdetected here —
  // but we ran Crystal probe first and it failed, so this is GS.
  return true;
}

function looksLikeRBOrYellow(sram: Uint8Array): boolean {
  if (sram.length < RB_CHECKSUM_OFFSET + 1) return false;
  const partyCount = sram[RB_PARTY_COUNT_OFFSET];
  if (partyCount === undefined || partyCount > PARTY_COUNT_MAX) return false;
  if (!speciesListTerminates(sram, RB_PARTY_SPECIES_OFFSET, partyCount)) return false;
  if (!nameDecodesPlausibly(sram, RB_TRAINER_NAME_OFFSET, RB_TRAINER_NAME_BYTES)) return false;
  return rbChecksumValid(sram);
}

function looksLikeYellow(sram: Uint8Array): boolean {
  // Per PLAN §5: Yellow's distinguishing structure is the Pikachu
  // friendship byte at 0x271C (non-zero on any played Yellow save).
  // RB stores game-corner data in that byte that may also be non-zero,
  // so this is a HEURISTIC. The detection only matters for the
  // SaveError surface — Yellow parsing is deferred either way.
  const friendship = sram[YELLOW_PIKACHU_FRIENDSHIP_OFFSET];
  if (friendship === undefined) return false;
  // Conservative: only flag Yellow if the byte is in the
  // friendship-plausible range AND non-zero. This will rarely hit on RB.
  return friendship > 0 && friendship < 256;
}

function speciesListTerminates(sram: Uint8Array, offset: number, count: number): boolean {
  // Species list is `count` real entries followed by a 0xFF terminator,
  // padded out to PARTY_SPECIES_MAX_SCAN bytes. Real species bytes are
  // never 0xFF (that's the terminator) and are never 0 (slot empty).
  if (count === 0) {
    // Empty party — first byte must be the terminator.
    const first = sram[offset];
    return first === SPECIES_LIST_TERMINATOR;
  }
  for (let i = 0; i < count; i++) {
    const b = sram[offset + i];
    if (b === undefined || b === SPECIES_LIST_TERMINATOR || b === 0) return false;
  }
  // The byte right after the count entries should be the terminator,
  // up to a fixed scan window.
  if (count >= PARTY_SPECIES_MAX_SCAN) return true;
  return sram[offset + count] === SPECIES_LIST_TERMINATOR;
}

function nameDecodesPlausibly(sram: Uint8Array, offset: number, fieldLen: number): boolean {
  // The trainer name field MUST contain at least one printable Gen 1/2
  // character before the terminator OR a terminator immediately (newgame).
  // Any non-printable bytes BEFORE the terminator → not plausible.
  let printable = 0;
  for (let i = 0; i < fieldLen; i++) {
    const b = sram[offset + i];
    if (b === undefined) return false;
    if (b === GEN12_TERMINATOR) {
      // OK — any number of printable chars followed by terminator.
      return printable > 0 || i === 0;
    }
    if (!CHARMAP12_TO_UNICODE.has(b)) return false;
    printable++;
  }
  // Field-length without terminator is OK only if all bytes mapped.
  return printable === fieldLen;
}

function rbChecksumValid(sram: Uint8Array): boolean {
  const stored = sram[RB_CHECKSUM_OFFSET];
  if (stored === undefined) return false;
  let sum = 0;
  for (let i = RB_CHECKSUM_RANGE_START; i <= RB_CHECKSUM_RANGE_END_INCLUSIVE; i++) {
    sum = (sum + (sram[i] ?? 0)) & 0xff;
  }
  const computed = 0xff - sum;
  return (computed & 0xff) === (stored & 0xff);
}

function crystalChecksumValid(sram: Uint8Array): boolean {
  if (sram.length < C_CHECKSUM_OFFSET + 2) return false;
  const lo = sram[C_CHECKSUM_OFFSET] ?? 0;
  const hi = sram[C_CHECKSUM_OFFSET + 1] ?? 0;
  const stored = lo | (hi << 8);
  let sum = 0;
  for (let i = C_CHECKSUM_RANGE_START; i <= C_CHECKSUM_RANGE_END_INCLUSIVE; i++) {
    sum = (sum + (sram[i] ?? 0)) & 0xffff;
  }
  return sum === stored;
}
