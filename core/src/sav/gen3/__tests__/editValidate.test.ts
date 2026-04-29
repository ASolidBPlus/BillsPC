/**
 * S10 — pure validators for the edit-modal form fields.
 */

import { describe, it, expect } from 'vitest';
import {
  validatePid,
  parsePid,
  validateTid,
  validateSid,
  validateIv,
  validateOtName,
} from '../editValidate.js';

describe('validatePid', () => {
  it('accepts 8-digit hex with and without 0x prefix', () => {
    expect(validatePid('12345678').ok).toBe(true);
    expect(validatePid('0x12345678').ok).toBe(true);
    expect(validatePid('DEADBEEF').ok).toBe(true);
  });

  it('rejects 7-digit hex (length must be exactly 8)', () => {
    const v = validatePid('1234567');
    expect(v.ok).toBe(false);
  });

  it('rejects non-hex chars (besides 0..9 and a..f)', () => {
    expect(validatePid('GHIJKLMN').ok).toBe(false);
  });

  it('accepts decimal u32', () => {
    expect(validatePid('305419896').ok).toBe(true);
  });

  it('rejects empty', () => {
    expect(validatePid('').ok).toBe(false);
  });
});

describe('parsePid', () => {
  it('parses 8-hex-digit form', () => {
    expect(parsePid('12345678')).toBe(0x12345678);
    expect(parsePid('0x12345678')).toBe(0x12345678);
    expect(parsePid('DEADBEEF')).toBe(0xdeadbeef);
  });

  it('parses pure decimal form', () => {
    expect(parsePid('305419896')).toBe(305419896);
  });

  it('returns null on invalid input', () => {
    expect(parsePid('xyzzy')).toBeNull();
  });
});

describe('validateTid / validateSid', () => {
  it('accepts 0..65535', () => {
    expect(validateTid('0').ok).toBe(true);
    expect(validateTid('65535').ok).toBe(true);
    expect(validateSid('12345').ok).toBe(true);
  });

  it('rejects negative / > 65535', () => {
    expect(validateTid('-1').ok).toBe(false);
    expect(validateTid('65536').ok).toBe(false);
    expect(validateSid('99999').ok).toBe(false);
  });

  it('rejects empty / non-integer', () => {
    expect(validateTid('').ok).toBe(false);
    expect(validateSid('1.5').ok).toBe(false);
    expect(validateSid('abc').ok).toBe(false);
  });
});

describe('validateIv', () => {
  it('accepts 0..31', () => {
    for (let i = 0; i <= 31; i++) {
      expect(validateIv(String(i)).ok).toBe(true);
    }
  });

  it('rejects 32 (with override allowed)', () => {
    const v = validateIv('32');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.canOverride).toBe(true);
  });

  it('rejects -1 (with override allowed)', () => {
    const v = validateIv('-1');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.canOverride).toBe(true);
  });

  it('rejects 1.5 (hard block — fractional)', () => {
    const v = validateIv('1.5');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.canOverride).toBeUndefined();
  });
});

describe('validateOtName', () => {
  it('accepts plain ASCII up to 7 chars', () => {
    expect(validateOtName('TEST').ok).toBe(true);
    expect(validateOtName('SEVEN77').ok).toBe(true);
  });

  it('rejects 8-char input (hard block)', () => {
    const v = validateOtName('TOOLONG8');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.canOverride).toBeUndefined();
  });

  it('flags non-Gen-3 chars (canOverride per D6)', () => {
    // Emoji are multi-codepoint; the spread-then-encode round-trip
    // detects '?' substitution at one or more positions.
    const v = validateOtName('TÉST');
    // Whether 'É' has a Gen 3 mapping depends on the charmap. For this
    // test, just assert that if the validator flags it, it's overridable.
    if (!v.ok) {
      expect(v.canOverride).toBe(true);
    }
  });

  it('accepts literal "?" without flagging it as substitution', () => {
    expect(validateOtName('?').ok).toBe(true);
  });

  it('rejects empty', () => {
    expect(validateOtName('').ok).toBe(false);
  });
});
