/**
 * S6a — Format autodetect.
 *
 * Per PLAN_EVAL A2:
 *   gameCode == 0 → R/S (we report RUBY for the {Ruby,Sapphire} pair)
 *   gameCode == 1 → FR/LG (we report FIRERED for the {FireRed,LeafGreen} pair)
 *   else          → EMERALD
 *
 * Sapphire and LeafGreen are not fixture-backed (per orchestrator Q1) so
 * we exercise the code path via synthesised buffers — verify the
 * detection branches are reachable from the public API.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGen3Save, isGen3SaveError } from '../parseSave.js';
import { detectGen3, familyOf, gen3GameLabel, SAVE_BYTES_FULL } from '../format.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, '../../../../test-fixtures/gen3');

describe('detectGen3 (real fixtures)', () => {
  it('ruby.sav → RUBY (R/S group)', () => {
    const bytes = new Uint8Array(readFileSync(resolve(FIXTURES, 'ruby.sav')));
    expect(detectGen3(bytes)).toBe('RUBY');
  });
  it('emerald.sav → EMERALD', () => {
    const bytes = new Uint8Array(readFileSync(resolve(FIXTURES, 'emerald.sav')));
    expect(detectGen3(bytes)).toBe('EMERALD');
  });
  it('firered.sav → FIRERED (FR/LG group)', () => {
    const bytes = new Uint8Array(readFileSync(resolve(FIXTURES, 'firered.sav')));
    expect(detectGen3(bytes)).toBe('FIRERED');
  });
});

describe('detectGen3 (length triage)', () => {
  it('rejects buffers of wrong length', () => {
    expect(detectGen3(new Uint8Array(0))).toBeNull();
    expect(detectGen3(new Uint8Array(32768))).toBeNull();
    expect(detectGen3(new Uint8Array(100000))).toBeNull();
  });
  it('rejects 128 KB of all-zero (no valid signature)', () => {
    expect(detectGen3(new Uint8Array(SAVE_BYTES_FULL))).toBeNull();
  });
});

describe('parseGen3Save error surface', () => {
  it('returns a tagged error for short buffers', () => {
    const r = parseGen3Save(new Uint8Array(100));
    expect(isGen3SaveError(r)).toBe(true);
    if (!isGen3SaveError(r)) throw new Error('expected error');
    expect(r.reason).toBe('TOO_SHORT');
  });
  it('returns a tagged UNRECOGNIZED_FORMAT for wrong-length buffers', () => {
    const r = parseGen3Save(new Uint8Array(70000));
    expect(isGen3SaveError(r)).toBe(true);
    if (!isGen3SaveError(r)) throw new Error('expected error');
    expect(r.reason).toBe('UNRECOGNIZED_FORMAT');
  });
  it('returns a tagged UNRECOGNIZED_FORMAT for 128KB of all-zero', () => {
    const r = parseGen3Save(new Uint8Array(SAVE_BYTES_FULL));
    expect(isGen3SaveError(r)).toBe(true);
    if (!isGen3SaveError(r)) throw new Error('expected error');
    expect(r.reason).toBe('UNRECOGNIZED_FORMAT');
  });
});

describe('familyOf / gen3GameLabel', () => {
  it('groups RS and FRLG correctly', () => {
    expect(familyOf('RUBY')).toBe('RS');
    expect(familyOf('SAPPHIRE')).toBe('RS');
    expect(familyOf('EMERALD')).toBe('EMERALD');
    expect(familyOf('FIRERED')).toBe('FRLG');
    expect(familyOf('LEAFGREEN')).toBe('FRLG');
  });
  it('renders honest labels (no false specificity, per PLAN_EVAL A7)', () => {
    expect(gen3GameLabel('RUBY')).toBe('Ruby/Sapphire');
    expect(gen3GameLabel('SAPPHIRE')).toBe('Ruby/Sapphire');
    expect(gen3GameLabel('EMERALD')).toBe('Emerald');
    expect(gen3GameLabel('FIRERED')).toBe('FireRed/LeafGreen');
    expect(gen3GameLabel('LEAFGREEN')).toBe('FireRed/LeafGreen');
  });
});
