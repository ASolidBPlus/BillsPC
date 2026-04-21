/**
 * Gen 3 substructure checksum.
 *
 * Spec: PKHeX `PKX.cs` (sum of u16 LE words across the decrypted 48-byte
 * substructure block, modulo 0x10000) and Bulbapedia §Checksum. The
 * checksum is computed on the **decrypted, wire-ordered** (post-shuffle)
 * block — which is mathematically the same as the pre-shuffle sum because
 * addition is commutative, but PKHeX canonicalises the post-shuffle
 * order and we mirror it for byte-for-byte parity with the harness packer
 * (PLAN_EVAL A6).
 *
 * Final mask `& 0xFFFF` is sufficient — JS numbers handle 12 + 16 = 28-bit
 * sums exactly, so per-iteration masking is unnecessary, but the final
 * mask is load-bearing (a sum of 0x10000 must become 0x0000, not stay
 * 0x10000 or, worse, get clamped to 0xFFFF — see PLAN_EVAL Risks #7).
 */

import { readU16LE } from './leBytes.js';
import { ENCRYPTED_BLOCK_SIZE } from './gen3Crypt.js';

/**
 * Sum the 24 little-endian u16 words of a 48-byte plaintext block
 * (decrypted, wire-ordered) and return `sum & 0xFFFF`.
 */
export function computeChecksum(plaintext: Uint8Array): number {
  if (plaintext.length !== ENCRYPTED_BLOCK_SIZE) {
    throw new RangeError(
      `computeChecksum expected ${ENCRYPTED_BLOCK_SIZE}-byte block, got ${plaintext.length}`,
    );
  }
  let sum = 0;
  for (let off = 0; off < ENCRYPTED_BLOCK_SIZE; off += 2) {
    sum += readU16LE(plaintext, off);
  }
  return sum & 0xffff;
}
