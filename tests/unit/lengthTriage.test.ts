import { describe, it, expect } from 'vitest';
import { triage, ACCEPTED_TRAILER_LENGTHS, SRAM_BYTES } from '../../core/src/sav/lengthTriage.js';

const alwaysOk = () => true;
const neverOk = () => false;

describe('length triage (PLAN_EVAL A2)', () => {
  it('passes a buffer of exactly 32768 bytes through unchanged', () => {
    const bytes = new Uint8Array(SRAM_BYTES);
    const r = triage(bytes, alwaysOk);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.bytes.length).toBe(SRAM_BYTES);
    expect(r.warnings).toEqual([]);
  });

  it('strips a 48-byte trailer (Crystal demo case) and reports a warning', () => {
    const bytes = new Uint8Array(SRAM_BYTES + 48);
    const r = triage(bytes, alwaysOk);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.bytes.length).toBe(SRAM_BYTES);
    expect(r.warnings).toContain('emulator_trailer_stripped(48)');
  });

  it('rejects a too-short buffer with TOO_SHORT', () => {
    const r = triage(new Uint8Array(1024), alwaysOk);
    expect(r.kind).toBe('fail');
    if (r.kind !== 'fail') return;
    expect(r.reason).toBe('TOO_SHORT');
  });

  it('rejects a buffer larger than 128 KB outright', () => {
    const r = triage(new Uint8Array(200_000), alwaysOk);
    expect(r.kind).toBe('fail');
    if (r.kind !== 'fail') return;
    expect(r.reason).toBe('UNRECOGNIZED_LENGTH');
  });

  it('accepts every documented trailer length', () => {
    for (const len of ACCEPTED_TRAILER_LENGTHS) {
      const r = triage(new Uint8Array(SRAM_BYTES + len), alwaysOk);
      expect(r.kind).toBe('ok');
      if (r.kind !== 'ok') continue;
      expect(r.warnings).toContain(`emulator_trailer_stripped(${len})`);
    }
  });

  it('falls back to head-strip when tail-stripped window does not look valid', () => {
    const bytes = new Uint8Array(SRAM_BYTES + 48);
    // probe says the tail-stripped (i.e., head-aligned) buffer is bad,
    // but the head-stripped (i.e., tail-aligned) buffer is good.
    const probe = (sram: Uint8Array) => sram[0] === 1;
    bytes[48] = 1; // head-stripped buffer starts at byte 48
    const r = triage(bytes, probe);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.warnings).toContain('emulator_header_stripped(48)');
  });

  it('rejects a 32K + N buffer when N is not a recognised trailer length', () => {
    const r = triage(new Uint8Array(SRAM_BYTES + 17), alwaysOk);
    expect(r.kind).toBe('fail');
  });

  it('handles 64 KB and 128 KB padded chip dumps by truncating to 32 KB', () => {
    for (const len of [SRAM_BYTES * 2, SRAM_BYTES * 4]) {
      const bytes = new Uint8Array(len);
      const r = triage(bytes, alwaysOk);
      expect(r.kind).toBe('ok');
      if (r.kind !== 'ok') continue;
      expect(r.bytes.length).toBe(SRAM_BYTES);
    }
  });

  it('returns failure when probe rejects every candidate window', () => {
    const r = triage(new Uint8Array(SRAM_BYTES + 48), neverOk);
    expect(r.kind).toBe('fail');
  });
});
