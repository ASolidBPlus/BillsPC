import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { detectFormat, parseSave, isSaveError } from '../../core/src/index.js';
import { demoCrystalPath, demoRedPath } from '../fixtures/saves/index.js';

describe('save format autodetect', () => {
  it('detects Pokemon Red from demo-red.sav', () => {
    const bytes = new Uint8Array(readFileSync(demoRedPath));
    const det = detectFormat(bytes);
    expect(det).not.toBeNull();
    expect(det?.format).toBe('RBY-RED');
    expect(det?.checksumValid).toBe(true);
  });

  it('detects Crystal from demo-crystal.sav (after 48-byte trailer strip)', () => {
    const bytes = new Uint8Array(readFileSync(demoCrystalPath));
    // Direct detect on the whole 32816-byte buffer would fail length triage;
    // parseSave does the strip then detection. We verify by parseSave.
    const result = parseSave(bytes);
    expect(isSaveError(result)).toBe(false);
    if (isSaveError(result)) return;
    expect(result.format).toBe('CRYSTAL');
    expect(result.warnings).toContain('emulator_trailer_stripped(48)');
  });

  it('detects Crystal directly when SRAM is exactly 32 KB', () => {
    const bytes = new Uint8Array(readFileSync(demoCrystalPath)).subarray(0, 32768);
    const det = detectFormat(bytes);
    expect(det?.format).toBe('CRYSTAL');
  });

  it('returns null for buffers that are too short', () => {
    const det = detectFormat(new Uint8Array(0x100));
    expect(det).toBeNull();
  });

  it('parseSave rejects buffers smaller than 32 KB with TOO_SHORT', () => {
    const tiny = new Uint8Array(1024);
    const r = parseSave(tiny);
    expect(isSaveError(r)).toBe(true);
    if (isSaveError(r)) {
      expect(r.reason).toBe('TOO_SHORT');
    }
  });

  it('parseSave returns UNRECOGNIZED_FORMAT on a zeroed 32 KB buffer', () => {
    const r = parseSave(new Uint8Array(32768));
    expect(isSaveError(r)).toBe(true);
    if (isSaveError(r)) {
      expect(r.reason).toBe('UNRECOGNIZED_FORMAT');
    }
  });

  it('parseSave returns UNRECOGNIZED_FORMAT on random noise (100 RNG seeds)', () => {
    let falsePositives = 0;
    let s = 0xdeadbeef >>> 0;
    for (let i = 0; i < 100; i++) {
      const buf = new Uint8Array(32768);
      for (let j = 0; j < buf.length; j++) {
        // xorshift32
        s ^= s << 13;
        s = (s ^ (s >>> 17)) >>> 0;
        s = (s ^ (s << 5)) >>> 0;
        buf[j] = s & 0xff;
      }
      const r = parseSave(buf);
      if (!isSaveError(r)) falsePositives++;
    }
    expect(falsePositives).toBe(0);
  });

  it('content-only detection: rename the buffer in caller, parseSave still gets the right format', () => {
    // The point is that detection ignores filename — pass the bytes from
    // demo-red.sav and demo-crystal.sav and verify the format reflects the
    // data, not the path.
    const redBytes = new Uint8Array(readFileSync(demoRedPath));
    const cBytes = new Uint8Array(readFileSync(demoCrystalPath));
    const r1 = parseSave(redBytes);
    const r2 = parseSave(cBytes);
    expect(isSaveError(r1)).toBe(false);
    expect(isSaveError(r2)).toBe(false);
    if (isSaveError(r1) || isSaveError(r2)) return;
    expect(r1.format).toBe('RBY-RED');
    expect(r2.format).toBe('CRYSTAL');
  });

  it('parseSave returns CORRUPTED if input is not a Uint8Array', () => {
    // @ts-expect-error: deliberate misuse.
    const r = parseSave([1, 2, 3]);
    expect(isSaveError(r)).toBe(true);
    if (isSaveError(r)) expect(r.reason).toBe('CORRUPTED');
  });
});
