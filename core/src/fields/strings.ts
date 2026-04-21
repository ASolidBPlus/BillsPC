import { decodeGen12 } from '../data/charmap12.js';
import { encodeGen3, GEN3_TERMINATOR, GEN3_QUESTION_MARK } from '../data/charmap3.js';

const NICKNAME_MAX = 10;
const OT_NAME_MAX = 7;

/**
 * Two-pass conversion: Gen 1/2 bytes → Unicode → Gen 3 bytes. Unmapped chars
 * become 0xAC ('?'). Output is truncated to the field max BEFORE the 0xFF
 * terminator is appended.
 */
function convert(bytes: Uint8Array, max: number): Uint8Array {
  const text = decodeGen12(bytes);
  // Replace U+FFFD (decode-time unmapped) with '?' so encodeGen3 takes the
  // fallback path consistently.
  const cleaned = text.replace(/�/g, '?');
  const truncated = [...cleaned].slice(0, max).join('');
  const encoded = encodeGen3(truncated, GEN3_QUESTION_MARK);
  const out = new Uint8Array(encoded.length + 1);
  out.set(encoded, 0);
  out[encoded.length] = GEN3_TERMINATOR;
  return out;
}

/** §4.15 nickname conversion (max 10 chars). */
export function convertNickname(bytes: Uint8Array): Uint8Array {
  return convert(bytes, NICKNAME_MAX);
}

/** §4.15 OT name conversion (max 7 chars). */
export function convertOTName(bytes: Uint8Array): Uint8Array {
  return convert(bytes, OT_NAME_MAX);
}
