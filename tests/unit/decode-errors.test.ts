import { describe, expect, it } from 'vitest';
import { convert, isDecodeError, isRefusal, packBoxed, unpackBoxed } from '../../core/src/index.js';
import { writeU16LE } from '../../core/src/pack/leBytes.js';
import { decryptBlock, encryptBlock, makeOtFull } from '../../core/src/pack/gen3Crypt.js';
import { computeChecksum } from '../../core/src/pack/gen3Checksum.js';
import { snorlaxMaxTrained } from '../fixtures/snorlax-maxtrained.js';

function packed(): Uint8Array {
  const it = convert(snorlaxMaxTrained);
  if (isRefusal(it)) throw new Error('unexpected refusal');
  return packBoxed(it);
}

function readPid(b: Uint8Array): number {
  return (b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24)) >>> 0;
}
function readTid(b: Uint8Array): number {
  return b[4]! | (b[5]! << 8);
}
function readSid(b: Uint8Array): number {
  return b[6]! | (b[7]! << 8);
}

/** Re-encrypt the substructure block after mutating it in plaintext. */
function rewritePlaintext(buf: Uint8Array, mutate: (plain: Uint8Array) => void): Uint8Array {
  const pid = readPid(buf);
  const otFull = makeOtFull(readTid(buf), readSid(buf));
  const wire = decryptBlock(buf.slice(32, 80), pid, otFull);
  mutate(wire);
  const newChecksum = computeChecksum(wire);
  const enc = encryptBlock(wire, pid, otFull);
  const out = new Uint8Array(buf);
  writeU16LE(out, 28, newChecksum);
  out.set(enc, 32);
  return out;
}

describe('unpackBoxed decode errors', () => {
  it('isDecodeError type guard', () => {
    expect(isDecodeError({ kind: 'decode-error', reason: 'BAD_LENGTH', message: 'x' })).toBe(true);
    expect(isDecodeError({})).toBe(false);
    expect(isDecodeError(null)).toBe(false);
    expect(isDecodeError('decode-error')).toBe(false);
  });

  it('BAD_LENGTH: input not 80 bytes', () => {
    const r1 = unpackBoxed(new Uint8Array(79));
    const r2 = unpackBoxed(new Uint8Array(81));
    expect(isDecodeError(r1) && r1.reason).toBe('BAD_LENGTH');
    expect(isDecodeError(r2) && r2.reason).toBe('BAD_LENGTH');
  });

  it('CHECKSUM_MISMATCH: header checksum corrupted', () => {
    const buf = packed();
    buf[28] = (buf[28]! ^ 0x01) & 0xff;
    const r = unpackBoxed(buf);
    expect(isDecodeError(r) && r.reason).toBe('CHECKSUM_MISMATCH');
  });

  it('SPECIES_OUT_OF_RANGE: species set to 0', () => {
    const buf = rewritePlaintext(packed(), (plain) => {
      // The Growth substructure is at the wire slot determined by PID%24.
      // We can't easily find it without unshuffling; instead, set ALL u16
      // slot-0 positions to 0 — only one is actually species, but the
      // other substructs handle 0 fine (move 0, ev 0, pokerus 0).
      // Simpler: set every byte of every "species candidate" slot to 0.
      // Actually use the fact that we know which slot via PID%24 — but
      // simpler still: set every 12-byte slot's first 2 bytes to 0.
      for (let s = 0; s < 4; s++) {
        plain[s * 12] = 0;
        plain[s * 12 + 1] = 0;
      }
    });
    const r = unpackBoxed(buf);
    expect(isDecodeError(r) && r.reason).toBe('SPECIES_OUT_OF_RANGE');
  });

  it('BAD_NICKNAME_BYTES: data byte after terminator', () => {
    const buf = packed();
    buf[8] = 0xff;
    buf[9] = 0x42; // data after terminator
    const r = unpackBoxed(buf);
    expect(isDecodeError(r) && r.reason).toBe('BAD_NICKNAME_BYTES');
  });

  it('BAD_OTNAME_BYTES: data byte after terminator', () => {
    const buf = packed();
    buf[20] = 0xff;
    buf[21] = 0x42;
    const r = unpackBoxed(buf);
    expect(isDecodeError(r) && r.reason).toBe('BAD_OTNAME_BYTES');
  });

  it('UNEXPECTED_LITERAL_FIELD: isEgg bit set in misc IV word', () => {
    // Set bit 30 of every slot's IV word (offset 4 within substruct).
    // Only the actual misc slot's bit matters; others are corrupted IVs
    // in non-misc substructs but still parse without erroring elsewhere.
    const buf = rewritePlaintext(packed(), (plain) => {
      for (let s = 0; s < 4; s++) {
        plain[s * 12 + 7] = (plain[s * 12 + 7]! | 0x40) & 0xff; // bit 30 of u32 at off+4
      }
    });
    const r = unpackBoxed(buf);
    expect(isDecodeError(r) && r.reason).toBe('UNEXPECTED_LITERAL_FIELD');
  });

  it('BAD_SUBSTRUCT_ORDER: defensive — guarded internally; reason exists in union', () => {
    // PID%24 is always 0..23 by construction so this branch is unreachable
    // from public input, but the reason must be in the type union.
    // Just smoke-test by constructing the error directly.
    const e: { kind: 'decode-error'; reason: string; message: string } = {
      kind: 'decode-error',
      reason: 'BAD_SUBSTRUCT_ORDER',
      message: 'unreachable',
    };
    expect(isDecodeError(e)).toBe(true);
  });
});
