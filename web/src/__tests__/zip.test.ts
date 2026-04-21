/**
 * Zip wrapper tests. Per PLAN §8.3 and PLAN_EVAL "Test matrix gaps":
 * - empty input → valid empty zip
 * - ordering deterministic by name
 * - output round-trips via fflate.unzipSync
 */
import { describe, it, expect } from 'vitest';
import { unzipSync } from 'fflate';
import { zipFiles } from '../zip.js';

describe('zipFiles', () => {
  it('produces a valid (empty) zip when given no entries', () => {
    const out = zipFiles([]);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBeGreaterThan(0); // zip has a central directory header
    const round = unzipSync(out);
    expect(Object.keys(round)).toEqual([]);
  });

  it('round-trips entries through unzipSync byte-exact', () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([0xff, 0xee, 0xdd]);
    const out = zipFiles([
      { name: 'foo.bin', bytes: a },
      { name: 'bar.bin', bytes: b },
    ]);
    const round = unzipSync(out);
    expect(round['foo.bin']).toEqual(a);
    expect(round['bar.bin']).toEqual(b);
  });

  it('orders entries deterministically by name (lexicographic)', () => {
    const e1 = { name: 'zebra.pk3', bytes: new Uint8Array([1]) };
    const e2 = { name: 'apple.pk3', bytes: new Uint8Array([2]) };
    const e3 = { name: 'mango.pk3', bytes: new Uint8Array([3]) };
    const a = zipFiles([e1, e2, e3]);
    const b = zipFiles([e3, e1, e2]);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('handles a 80-byte .pk3 payload (Sprint 2 BOXED_SIZE)', () => {
    const pk3 = new Uint8Array(80);
    for (let i = 0; i < 80; i++) pk3[i] = i;
    const out = zipFiles([{ name: '000-test.pk3', bytes: pk3 }]);
    const round = unzipSync(out);
    expect(round['000-test.pk3']).toEqual(pk3);
  });
});
