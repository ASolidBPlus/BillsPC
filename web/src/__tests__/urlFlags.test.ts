/**
 * S7b — `parseUrlFlags` unit test (Gap 3 from EVAL.md "Headline gaps").
 *
 * Asserts the URL-flag parser correctly resolves the two HIL bisection
 * levers from a search string. The end-to-end protocol path is covered
 * by the existing flashgbx-write tests + cartFlasher test — here we
 * only verify the parser shape so the controller's `buildDefaultFlashDeps`
 * threads the right values into `CartFlasherDeps`.
 *
 * Per AMEND-S7b-3 / DECISION-6: `?cart-write-chunk=64` → 64; default 256.
 * Per AMEND-S7b-19 #2: `?cart-write-baud=1m` → 1_000_000; default 1.5M.
 */

import { describe, it, expect } from 'vitest';
import { parseUrlFlags } from '../cart/urlFlags.js';

describe('parseUrlFlags', () => {
  it('returns empty when no relevant flags are present', () => {
    expect(parseUrlFlags('')).toEqual({});
    expect(parseUrlFlags('?debug=1')).toEqual({});
    expect(parseUrlFlags('?foo=bar&baz=qux')).toEqual({});
  });

  it('?cart-write-chunk=64 → writeChunkBytes: 64 (AMEND-S7b-3 / DECISION-6)', () => {
    expect(parseUrlFlags('?cart-write-chunk=64')).toEqual({ writeChunkBytes: 64 });
  });

  it('?cart-write-chunk=256 → writeChunkBytes: 256', () => {
    expect(parseUrlFlags('?cart-write-chunk=256')).toEqual({ writeChunkBytes: 256 });
  });

  it('?cart-write-chunk=128 (unknown value) → writeChunkBytes omitted (default applies downstream)', () => {
    expect(parseUrlFlags('?cart-write-chunk=128')).toEqual({});
  });

  it('?cart-write-baud=1m → writeBaud: 1_000_000 (AMEND-S7b-19)', () => {
    expect(parseUrlFlags('?cart-write-baud=1m')).toEqual({ writeBaud: 1_000_000 });
  });

  it('?cart-write-baud=1.5m → writeBaud: 1_500_000', () => {
    expect(parseUrlFlags('?cart-write-baud=1.5m')).toEqual({ writeBaud: 1_500_000 });
  });

  it('case-insensitive M suffix accepted', () => {
    expect(parseUrlFlags('?cart-write-baud=1M')).toEqual({ writeBaud: 1_000_000 });
    expect(parseUrlFlags('?cart-write-baud=1.5M')).toEqual({ writeBaud: 1_500_000 });
  });

  it('?cart-write-baud=2m (unknown) → writeBaud omitted', () => {
    expect(parseUrlFlags('?cart-write-baud=2m')).toEqual({});
  });

  it('combines both flags', () => {
    expect(parseUrlFlags('?cart-write-chunk=64&cart-write-baud=1m')).toEqual({
      writeChunkBytes: 64,
      writeBaud: 1_000_000,
    });
  });

  it('mocking window.location.search-equivalent strings parses correctly', () => {
    // Verify the parser tolerates both with and without leading "?".
    expect(parseUrlFlags('cart-write-chunk=64')).toEqual({ writeChunkBytes: 64 });
  });
});
