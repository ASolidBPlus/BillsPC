/**
 * Gen 3 substructure XOR encryption.
 *
 * Spec: PKHeX `PKX.cs#DecryptArray3` and Bulbapedia "Pokemon data
 * substructures (Generation III)" §Encryption. The 48-byte substructure
 * block is treated as 12 little-endian u32 words; each word is XORed
 * against `key = PID ^ ((SID<<16) | TID)`. There is no per-word key
 * rotation. XOR is self-inverse — the same operation
 * encrypts and decrypts.
 *
 * In JS, all bitwise ops produce signed int32; we `>>> 0` defensively
 * after every XOR so the output u32s round-trip cleanly through
 * `writeU32LE` / `readU32LE`.
 */

import { readU32LE, writeU32LE, u32 } from './leBytes.js';

export const ENCRYPTED_BLOCK_SIZE = 48;

/** Derives the XOR key from the PID and the full OT id (SID<<16 | TID). */
export function deriveKey(pid: number, otFull: number): number {
  return u32(pid) ^ u32(otFull);
}

/** Builds otFull = ((SID & 0xFFFF) << 16) | (TID & 0xFFFF) as u32. */
export function makeOtFull(tid: number, sid: number): number {
  return u32(((sid & 0xffff) << 16) | (tid & 0xffff));
}

/**
 * In-place XOR of `block` against the 32-bit `key`, applied to each of
 * the 12 LE u32 words. Returns `block` (the same buffer) for chaining.
 *
 * `block.byteLength` MUST equal 48. This is asserted because a wrong
 * length silently corrupts the round-trip in a way that's nearly
 * impossible to debug from a packed-output diff.
 */
export function xorCrypt48(block: Uint8Array, key: number): Uint8Array {
  if (block.length !== ENCRYPTED_BLOCK_SIZE) {
    throw new RangeError(
      `xorCrypt48 expected ${ENCRYPTED_BLOCK_SIZE}-byte block, got ${block.length}`,
    );
  }
  const k = u32(key);
  for (let off = 0; off < ENCRYPTED_BLOCK_SIZE; off += 4) {
    const word = readU32LE(block, off);
    writeU32LE(block, off, u32(word ^ k));
  }
  return block;
}

/**
 * Encrypt a 48-byte plaintext block with `key = pid ^ otFull`. Returns
 * a new Uint8Array — does not mutate the input. (The lower-level
 * `xorCrypt48` mutates in place; this wrapper is for callers that want
 * value semantics.)
 */
export function encryptBlock(plaintext: Uint8Array, pid: number, otFull: number): Uint8Array {
  if (plaintext.length !== ENCRYPTED_BLOCK_SIZE) {
    throw new RangeError(
      `encryptBlock expected ${ENCRYPTED_BLOCK_SIZE}-byte block, got ${plaintext.length}`,
    );
  }
  const out = new Uint8Array(plaintext);
  xorCrypt48(out, deriveKey(pid, otFull));
  return out;
}

/** Inverse of `encryptBlock`. Same operation; named distinctly for callsite clarity. */
export function decryptBlock(ciphertext: Uint8Array, pid: number, otFull: number): Uint8Array {
  if (ciphertext.length !== ENCRYPTED_BLOCK_SIZE) {
    throw new RangeError(
      `decryptBlock expected ${ENCRYPTED_BLOCK_SIZE}-byte block, got ${ciphertext.length}`,
    );
  }
  const out = new Uint8Array(ciphertext);
  xorCrypt48(out, deriveKey(pid, otFull));
  return out;
}
