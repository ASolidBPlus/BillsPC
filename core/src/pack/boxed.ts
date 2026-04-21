/**
 * Top-level boxed-record packer/unpacker. 80 bytes total:
 *   off  0..31   header (PID, TID, SID, nickname, language, misc flags,
 *                OT name, markings, checksum, sanity)
 *   off 32..79   encrypted substructure block (G/A/E/M shuffled per
 *                PID%24, XOR-encrypted with key = PID ^ ((SID<<16)|TID))
 *
 * Per PLAN §5.1 + PLAN_EVAL A6 the canonical packing sequence is:
 *   1. build G/A/E/M plaintext (each 12 bytes, LE)
 *   2. wire = shuffle(G,A,E,M, pid%24)        // 48 bytes, plaintext
 *   3. checksum = sumU16LE(wire) & 0xFFFF     // BEFORE encryption
 *   4. encrypted = xorCrypt48(wire, key)
 *   5. header[28..30] = u16LE(checksum)
 *   6. output = header || encrypted
 *
 * Unpack is the strict inverse and never throws — any malformed input
 * surfaces as a `DecodeError` (see `decodeError.ts`). On a clean decode
 * the returned `Gen3Intermediate` has `_meta` set to a sentinel marking
 * the value as "decoded-from-bytes" — round-trip tests must compare
 * excluding `_meta` (PLAN_EVAL A5).
 */

import type { Gen3Intermediate, ConvertMetadata } from '../types/target.js';
import { decryptBlock, encryptBlock, ENCRYPTED_BLOCK_SIZE, makeOtFull } from './gen3Crypt.js';
import { computeChecksum } from './gen3Checksum.js';
import { shuffleSubstructures, unshuffleSubstructures } from './gen3Shuffle.js';
import { encodeGrowth, decodeGrowth, GROWTH_SIZE } from './growth.js';
import { encodeAttacks, decodeAttacks, ATTACKS_SIZE } from './attacks.js';
import { encodeEvsCondition, decodeEvsCondition, EV_CONDITION_SIZE } from './evsCondition.js';
import { encodeMisc, decodeMisc, MISC_SIZE } from './misc.js';
import { readU16LE, readU32LE, writeU16LE, writeU32LE } from './leBytes.js';
import { type DecodeError, makeDecodeError } from './decodeError.js';

export const BOXED_SIZE = 80 as const;
export const HEADER_SIZE = 32 as const;

const NICKNAME_FIELD = 10;
const OT_NAME_FIELD = 7;
const GEN3_TERMINATOR = 0xff;

/** Misc-flags byte at offset 19: bit 1 (has-species) set, others clear. */
const MISC_FLAGS_NORMAL = 0x02;

/** Origin-game ID for FireRed (matches misc.ts ORIGIN_GAME_ID). */
const ORIGIN_GAME_FIRERED = 4;
const BALL_POKEBALL = 4;

const SPECIES_MIN = 1;
const SPECIES_MAX = 412;

/**
 * Pad a 0xFF-terminated string field to the fixed wire length. The
 * input may be ≤ field-len with a terminator anywhere, OR exactly
 * field-len with no terminator. Trailing bytes are filled with 0xFF.
 */
function padNameField(src: Uint8Array, fieldLen: number): Uint8Array {
  const out = new Uint8Array(fieldLen);
  out.fill(GEN3_TERMINATOR);
  const copyLen = Math.min(src.length, fieldLen);
  out.set(src.subarray(0, copyLen), 0);
  return out;
}

/**
 * Validate a name field on decode: every byte at or after the first
 * 0xFF must also be 0xFF (no embedded terminators followed by data).
 * Returns true if valid.
 */
function validateNameField(field: Uint8Array): boolean {
  let seenTerminator = false;
  for (let i = 0; i < field.length; i++) {
    if (seenTerminator) {
      if (field[i] !== GEN3_TERMINATOR) return false;
    } else if (field[i] === GEN3_TERMINATOR) {
      seenTerminator = true;
    }
  }
  return true;
}

/** Trim to first 0xFF inclusive, or full length if no terminator. */
function trimNameField(field: Uint8Array): Uint8Array {
  for (let i = 0; i < field.length; i++) {
    if (field[i] === GEN3_TERMINATOR) {
      return field.slice(0, i + 1);
    }
  }
  return field.slice();
}

/** Sentinel `_meta` returned by `unpackBoxed` (PLAN §4.7 step 9). */
export const DECODED_META: ConvertMetadata = {
  pidSearchIterations: -1,
  evScalingApplied: false,
  evRemainderDistributed: 0,
  zeroDvOverridesApplied: [],
  unownLetterConstrained: false,
  warnings: ['decoded-from-bytes: _meta reflects decode, not original convert()'],
};

/**
 * Pack a `Gen3Intermediate` into the 80-byte boxed/storage record,
 * fully encrypted and checksummed. Always succeeds (S1's typed
 * intermediate is constrained tightly enough that no invalid input
 * is reachable).
 */
export function packBoxed(intermediate: Gen3Intermediate): Uint8Array {
  // 1. Build plaintext substructures.
  const g = encodeGrowth(intermediate);
  const a = encodeAttacks(intermediate);
  const e = encodeEvsCondition(intermediate);
  const m = encodeMisc(intermediate, intermediate.sid);

  // 2. Shuffle into wire order per PID%24 (still plaintext).
  const wire = shuffleSubstructures(g, a, e, m, intermediate.pid);

  // 3. Checksum over decrypted, wire-ordered block.
  const checksum = computeChecksum(wire);

  // 4. Encrypt with key = PID ^ ((SID<<16)|TID).
  const otFull = makeOtFull(intermediate.tid, intermediate.sid);
  const encrypted = encryptBlock(wire, intermediate.pid, otFull);

  // 5. Header.
  const out = new Uint8Array(BOXED_SIZE);
  writeU32LE(out, 0, intermediate.pid);
  writeU16LE(out, 4, intermediate.tid);
  writeU16LE(out, 6, intermediate.sid);

  const nickname = padNameField(intermediate.nickname, NICKNAME_FIELD);
  out.set(nickname, 8);

  out[18] = intermediate.language & 0xff;
  out[19] = MISC_FLAGS_NORMAL;

  const otName = padNameField(intermediate.otName, OT_NAME_FIELD);
  out.set(otName, 20);

  out[27] = 0; // markings (S1 literal 0)
  writeU16LE(out, 28, checksum);
  writeU16LE(out, 30, 0); // sanity / unknown

  // 6. Encrypted substructure block.
  out.set(encrypted, HEADER_SIZE);

  return out;
}

/**
 * Inverse of `packBoxed`. Returns a fully-populated `Gen3Intermediate`
 * with `_meta = DECODED_META` on success, or a `DecodeError` on any
 * malformed input. Never throws.
 */
export function unpackBoxed(bytes: Uint8Array): Gen3Intermediate | DecodeError {
  if (bytes.length !== BOXED_SIZE) {
    return makeDecodeError(
      'BAD_LENGTH',
      `unpackBoxed expected ${BOXED_SIZE} bytes, got ${bytes.length}`,
    );
  }

  // Header.
  const pid = readU32LE(bytes, 0);
  const tid = readU16LE(bytes, 4);
  const sid = readU16LE(bytes, 6);
  const nicknameRaw = bytes.slice(8, 8 + NICKNAME_FIELD);
  const language = bytes[18]!;
  // bytes[19] = misc flags (not enforced beyond decode; we don't surface it)
  const otNameRaw = bytes.slice(20, 20 + OT_NAME_FIELD);
  // bytes[27] = markings
  const headerChecksum = readU16LE(bytes, 28);
  // bytes[30..32] = sanity (ignored)

  if (!validateNameField(nicknameRaw)) {
    return makeDecodeError('BAD_NICKNAME_BYTES', 'nickname field has data after terminator', 8);
  }
  if (!validateNameField(otNameRaw)) {
    return makeDecodeError('BAD_OTNAME_BYTES', 'OT name field has data after terminator', 20);
  }

  // Decrypt + checksum verify.
  const otFull = makeOtFull(tid, sid);
  const cipher = bytes.slice(HEADER_SIZE, HEADER_SIZE + ENCRYPTED_BLOCK_SIZE);
  const wire = decryptBlock(cipher, pid, otFull);
  const computedChecksum = computeChecksum(wire);
  if (computedChecksum !== headerChecksum) {
    return makeDecodeError(
      'CHECKSUM_MISMATCH',
      `checksum mismatch: header=${headerChecksum.toString(16)} computed=${computedChecksum.toString(16)}`,
      28,
    );
  }

  // Unshuffle into G/A/E/M.
  let g: Uint8Array, a: Uint8Array, e: Uint8Array, m: Uint8Array;
  try {
    [g, a, e, m] = unshuffleSubstructures(wire, pid);
  } catch {
    return makeDecodeError('BAD_SUBSTRUCT_ORDER', 'PID%24 lookup out of range');
  }

  if (
    g.length !== GROWTH_SIZE ||
    a.length !== ATTACKS_SIZE ||
    e.length !== EV_CONDITION_SIZE ||
    m.length !== MISC_SIZE
  ) {
    return makeDecodeError('BAD_SUBSTRUCT_ORDER', 'substructure size mismatch after unshuffle');
  }

  const growth = decodeGrowth(g);
  const attacks = decodeAttacks(a);
  const evCond = decodeEvsCondition(e);
  const misc = decodeMisc(m);

  // Species range check.
  if (growth.species < SPECIES_MIN || growth.species > SPECIES_MAX) {
    return makeDecodeError(
      'SPECIES_OUT_OF_RANGE',
      `species ${growth.species} outside Gen 3 range ${SPECIES_MIN}..${SPECIES_MAX}`,
    );
  }

  // Literal-field enforcement (PLAN_EVAL A1).
  if (misc.metLocation !== 146) {
    return makeDecodeError(
      'UNEXPECTED_LITERAL_FIELD',
      `metLocation expected 146, got ${misc.metLocation}`,
    );
  }
  if (misc.metLevel !== 5) {
    return makeDecodeError('UNEXPECTED_LITERAL_FIELD', `metLevel expected 5, got ${misc.metLevel}`);
  }
  if (misc.originGameId !== ORIGIN_GAME_FIRERED) {
    return makeDecodeError(
      'UNEXPECTED_LITERAL_FIELD',
      `originGame expected FireRed (id ${ORIGIN_GAME_FIRERED}), got id ${misc.originGameId}`,
    );
  }
  if (misc.ballId !== BALL_POKEBALL) {
    return makeDecodeError(
      'UNEXPECTED_LITERAL_FIELD',
      `ball expected Poke Ball (id ${BALL_POKEBALL}), got id ${misc.ballId}`,
    );
  }
  if (misc.isEgg) {
    return makeDecodeError('UNEXPECTED_LITERAL_FIELD', 'isEgg bit set; S1 always emits false');
  }
  if (misc.abilityBit !== 0) {
    return makeDecodeError(
      'UNEXPECTED_LITERAL_FIELD',
      'abilityBit set; S1 always emits abilitySlot 0',
    );
  }
  if (misc.ribbonsAndObedience !== 0) {
    return makeDecodeError(
      'UNEXPECTED_LITERAL_FIELD',
      `ribbons/obedience word non-zero (0x${misc.ribbonsAndObedience.toString(16)}); S1 emits no ribbons`,
    );
  }
  const cs = evCond.contestStats;
  if (
    cs.cool !== 0 ||
    cs.beauty !== 0 ||
    cs.cute !== 0 ||
    cs.clever !== 0 ||
    cs.tough !== 0 ||
    cs.sheen !== 0
  ) {
    return makeDecodeError(
      'UNEXPECTED_LITERAL_FIELD',
      'contest stats non-zero; S1 emits all zeros',
    );
  }

  const intermediate: Gen3Intermediate = {
    species: growth.species,
    nickname: trimNameField(nicknameRaw),
    otName: trimNameField(otNameRaw),
    otGender: misc.otGender,
    tid,
    sid,
    pid,
    ivs: misc.ivs,
    evs: evCond.evs,
    nature: 0, // not stored on wire; S1 derives from DVs but decode can't recover
    abilitySlot: 0,
    moves: attacks.moves,
    pp: attacks.pp,
    ppUps: growth.ppUps,
    heldItem: growth.heldItem,
    friendship: growth.friendship,
    exp: growth.exp,
    level: 0, // party-tail field; not in boxed record
    pokerus: misc.pokerus,
    contestStats: {
      cool: 0,
      beauty: 0,
      cute: 0,
      clever: 0,
      tough: 0,
      sheen: 0,
    },
    ribbons: [] as const,
    markings: 0,
    metLocation: 146,
    metLevel: 5,
    metGame: 'FireRed',
    originGame: 'FireRed',
    fatefulEncounter: false,
    isEgg: false,
    language,
    _meta: DECODED_META,
  };

  return intermediate;
}
