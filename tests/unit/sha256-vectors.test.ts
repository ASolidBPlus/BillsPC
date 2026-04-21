import { describe, it, expect } from 'vitest';
import { sha256Hex } from '../../core/src/__internal__.js';

/**
 * NIST FIPS 180-2 test vectors. Per PLAN_EVAL A6 these must pass before any
 * other test relies on SHA-256 — an endian or padding bug would silently
 * corrupt every PID and SID.
 */
describe('SHA-256 NIST FIPS 180-2 vectors', () => {
  const enc = new TextEncoder();

  it('empty string', () => {
    expect(sha256Hex(enc.encode(''))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('"abc"', () => {
    // Canonical per RFC 6234 / verified against Node crypto.
    // (PLAN_EVAL A6 listed a typo'd value.)
    expect(sha256Hex(enc.encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('FIPS 180-2 example 3 (448-bit message)', () => {
    // Standard FIPS 180-2 example 3:
    // "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"
    const msg = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq';
    expect(sha256Hex(enc.encode(msg))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('one million "a"', () => {
    const msg = 'a'.repeat(1_000_000);
    expect(sha256Hex(enc.encode(msg))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    );
  });
});
