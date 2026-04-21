import { sha256 } from './sha256.js';

const ENCODER = new TextEncoder();

/** SHA-256 over bytes or a UTF-8 string. Always returns 32 bytes. */
export function hash(input: Uint8Array | string): Uint8Array {
  if (typeof input === 'string') return sha256(ENCODER.encode(input));
  return sha256(input);
}

/** Concatenate any number of byte sequences / strings, then SHA-256. */
export function hashConcat(...parts: ReadonlyArray<Uint8Array | string>): Uint8Array {
  const pieces: Uint8Array[] = parts.map((p) => (typeof p === 'string' ? ENCODER.encode(p) : p));
  let total = 0;
  for (const p of pieces) total += p.length;
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of pieces) {
    buf.set(p, off);
    off += p.length;
  }
  return sha256(buf);
}
