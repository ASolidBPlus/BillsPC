import { sha256 } from '../primitives/sha256.js';

/**
 * §4.7: SID = readU16LE(sha256(otNameBytes || u16le(tid)).slice(0,2)).
 *
 * Stable per (OT name bytes, TID) pair. Uses raw Gen 1/2 encoding for the
 * OT name — not the Gen 3-remapped bytes — so the SID is invariant across
 * conversions of the same source Pokemon.
 */
export function deriveSID(otNameBytes: Uint8Array, tid: number): number {
  const buf = new Uint8Array(otNameBytes.length + 2);
  buf.set(otNameBytes, 0);
  buf[otNameBytes.length] = tid & 0xff;
  buf[otNameBytes.length + 1] = (tid >>> 8) & 0xff;
  const h = sha256(buf);
  return (h[0]! | (h[1]! << 8)) & 0xffff;
}
