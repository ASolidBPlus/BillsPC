/**
 * S10 — pure validators for the edit-modal form fields. These run on
 * every keystroke so they MUST be cheap and side-effect free.
 *
 * OT-name validation uses an `encodeGen3` round-trip (per RA-6): any
 * char that maps to `GEN3_QUESTION_MARK` is flagged as a
 * substitution. The modal surfaces the substitution as a confirm
 * dialog (D6 click-through), not a hard block.
 */

import { encodeGen3, GEN3_QUESTION_MARK } from '../../data/charmap3.js';

export interface ValidationOk {
  readonly ok: true;
}
export interface ValidationFail {
  readonly ok: false;
  readonly message: string;
  /** When true the modal should warn but allow click-through (D6).
   *  When false, it's a hard block (e.g. wrong-radix PID). */
  readonly canOverride?: boolean;
}
export type Validation = ValidationOk | ValidationFail;

const OK: ValidationOk = { ok: true };

/**
 * Parse + validate a PID. Accepts hex (8 chars, optional `0x` prefix)
 * or decimal. Returns the u32 value when ok.
 */
export function validatePid(text: string): Validation {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, message: 'PID is required (hex or decimal u32)' };
  // Hex form: 8 hex digits, optional `0x` prefix.
  const hex = /^0x[0-9a-fA-F]{1,8}$|^[0-9a-fA-F]{1,8}$/;
  if (hex.test(trimmed)) {
    const cleaned = trimmed.toLowerCase().startsWith('0x') ? trimmed.slice(2) : trimmed;
    if (cleaned.length !== 8) {
      return { ok: false, message: 'PID hex must be exactly 8 digits (e.g. 0x12345678)' };
    }
    return OK;
  }
  // Decimal fallback.
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (n > 0xffffffff) return { ok: false, message: 'PID exceeds u32 range (max 4294967295)' };
    return OK;
  }
  return { ok: false, message: 'PID must be 8-digit hex or non-negative decimal' };
}

export function parsePid(text: string): number | null {
  const v = validatePid(text);
  if (!v.ok) return null;
  const t = text.trim();
  // PID is conventionally hex (PKHeX displays it as 8 hex digits). The
  // validator accepts both forms; we prefer hex unless the input is
  // unambiguously decimal — i.e. it contains only 0-9 AND its length
  // is NOT 8 (which would be the canonical hex display width). This
  // way "12345678" parses as 0x12345678 (matching the PKHeX UX) while
  // "305419896" parses as decimal.
  if (t.toLowerCase().startsWith('0x')) {
    return parseInt(t.slice(2), 16) >>> 0;
  }
  if (/^[0-9]+$/.test(t) && t.length !== 8) {
    return Number(t) >>> 0;
  }
  return parseInt(t, 16) >>> 0;
}

function validateU16(text: string, name: string): Validation {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, message: `${name} is required` };
  if (!/^\d+$/.test(trimmed))
    return { ok: false, message: `${name} must be a non-negative integer` };
  const n = Number(trimmed);
  if (n < 0 || n > 0xffff) {
    return { ok: false, message: `${name} must be in 0..65535 (got ${n})` };
  }
  return OK;
}

export function validateTid(text: string): Validation {
  return validateU16(text, 'TID');
}
export function validateSid(text: string): Validation {
  return validateU16(text, 'SID');
}

export function validateIv(text: string): Validation {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, message: 'IV is required' };
  if (!/^-?\d+$/.test(trimmed)) {
    return { ok: false, message: 'IV must be an integer 0..31' };
  }
  const n = Number(trimmed);
  if (!Number.isInteger(n)) return { ok: false, message: 'IV must be an integer (got fractional)' };
  if (n < 0 || n > 31) {
    return {
      ok: false,
      message: `IV must be in 0..31 (got ${n}); patcher will clamp on apply.`,
      canOverride: true,
    };
  }
  return OK;
}

/**
 * OT-name validation. Hard-blocks lengths > 7. For chars that don't
 * survive the `encodeGen3` round-trip (substituted with '?') we return
 * a warn-and-override result so the modal can show a confirm dialog
 * (D6 click-through).
 */
export function validateOtName(text: string): Validation {
  if (text.length === 0) return { ok: false, message: 'OT name is required (max 7 chars)' };
  // Char-count, not byte-count: emoji are multi-codepoint but read as 1
  // visible glyph; spread to get the visible-char count.
  const visible = [...text];
  if (visible.length > 7) {
    return { ok: false, message: `OT name must be 7 chars or fewer (got ${visible.length})` };
  }
  // Round-trip through encodeGen3. Any '?' substitution at a position
  // where the source wasn't '?' = lossy.
  const encoded = encodeGen3(text);
  const positions: number[] = [];
  let idx = 0;
  for (const ch of visible) {
    const byte = encoded[idx];
    if (byte === GEN3_QUESTION_MARK && ch !== '?') positions.push(idx);
    idx += 1;
  }
  if (positions.length > 0) {
    return {
      ok: false,
      message: `OT name has ${positions.length} char${positions.length === 1 ? '' : 's'} that don't survive Gen 3 encoding (will become '?')`,
      canOverride: true,
    };
  }
  return OK;
}
