/**
 * Gen 3 box-name decoder (per PLAN_EVAL A8).
 *
 * The full Gen 3 byte→Unicode map already lives at
 * `core/src/data/charmap3.ts` (vendored from PKHeX `StringConverter3.cs`
 * for the International English game). This module is a thin wrapper that
 * adds box-name semantics: read until 0xFF terminator, fall back to
 * "BOX N" if the result is empty.
 */

import { GEN3_BYTE_TO_UNICODE, GEN3_TERMINATOR } from '../../data/charmap3.js';
import { PCBUFFER_BOX_NAME_BYTES } from './format.js';

/**
 * Decode a single box-name field (9 bytes). Stops at 0xFF terminator,
 * unmapped bytes become '?'. If the trimmed result is empty (all bytes
 * are spaces or terminators), returns the synthetic "BOX N" label.
 */
export function decodeGen3BoxName(field: Uint8Array, oneBasedIndex: number): string {
  let s = '';
  for (let i = 0; i < field.length; i++) {
    const b = field[i]!;
    if (b === GEN3_TERMINATOR) break;
    s += GEN3_BYTE_TO_UNICODE.get(b) ?? '?';
  }
  const trimmed = s.replace(/\s+$/, '');
  if (trimmed.length === 0) return `BOX ${oneBasedIndex}`;
  return trimmed;
}

/**
 * Decode a 14×9 = 126-byte box-names blob. Returns a fixed-length
 * 14-element string array.
 */
export function decodeGen3BoxNames(boxNamesRaw: Uint8Array): readonly string[] {
  const out: string[] = [];
  for (let i = 0; i < 14; i++) {
    const field = boxNamesRaw.subarray(
      i * PCBUFFER_BOX_NAME_BYTES,
      (i + 1) * PCBUFFER_BOX_NAME_BYTES,
    );
    out.push(decodeGen3BoxName(field, i + 1));
  }
  return out;
}
