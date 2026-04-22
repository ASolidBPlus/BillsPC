import { sha256 } from '../primitives/sha256.js';

const GEN12_TERMINATOR = 0x50;

/**
 * §4.7: SID = readU16LE(sha256(otNameBytes || u16le(tid)).slice(0,2)).
 *
 * Stable per (OT, TID) pair. Uses raw Gen 1/2 encoding for the OT name —
 * not the Gen 3-remapped bytes — so the SID is invariant across
 * conversions of the same source Pokemon. **The OT byte buffer is
 * truncated at the first 0x50 terminator before hashing**, so trailing
 * uninitialized bytes from the source SRAM (Pokemon Crystal doesn't
 * always zero out the 11-byte OT field when overwriting names) don't
 * leak into the hash and split otherwise-identical (OT, TID) pairs into
 * different SIDs.
 */
export function deriveSID(otNameBytes: Uint8Array, tid: number): number {
  let len = otNameBytes.length;
  for (let i = 0; i < otNameBytes.length; i++) {
    if (otNameBytes[i] === GEN12_TERMINATOR) {
      len = i;
      break;
    }
  }
  const buf = new Uint8Array(len + 2);
  buf.set(otNameBytes.subarray(0, len), 0);
  buf[len] = tid & 0xff;
  buf[len + 1] = (tid >>> 8) & 0xff;
  const h = sha256(buf);
  return (h[0]! | (h[1]! << 8)) & 0xffff;
}
