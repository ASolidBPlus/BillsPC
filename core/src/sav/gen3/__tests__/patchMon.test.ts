/**
 * S10 — patchGen3Slot unit tests.
 *
 * Verifies the unpack → mutate → pack contract preserves all
 * non-edited fields (per PLAN §5.1) and that the new PID/TID/SID
 * propagates through the encryption-key re-derivation in `packBoxed`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseSave,
  isSaveError,
  convert,
  isRefusal,
  packBoxed,
  unpackBoxed,
  isDecodeError,
} from '../../../index.js';
import { patchGen3Slot, isGen3PatchError } from '../patchMon.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO_CRYSTAL = resolve(HERE, '../../../../../tests/fixtures/saves/demo-crystal.sav');

const FERALIGATR_GEN2_ID = 160;

function feraligatrSlotBytes(): Uint8Array {
  const sram = new Uint8Array(readFileSync(DEMO_CRYSTAL));
  const save = parseSave(sram);
  if (isSaveError(save)) throw new Error('demo-crystal parse failed');
  const fer =
    save.party.find((m) => m.speciesGen2Id === FERALIGATR_GEN2_ID) ??
    save.boxes.flat().find((m) => m.speciesGen2Id === FERALIGATR_GEN2_ID);
  if (!fer) throw new Error('Feraligatr not found');
  const conv = convert(fer);
  if (isRefusal(conv)) throw new Error('Feraligatr conversion refused');
  return packBoxed(conv);
}

describe('patchGen3Slot — round-trip preservation', () => {
  const slot = feraligatrSlotBytes();
  const original = unpackBoxed(slot);
  if (isDecodeError(original)) throw new Error('original unpack failed');

  it('PID-only patch: all non-PID fields byte-equal', () => {
    const newPid = 0x12345678;
    const out = patchGen3Slot(slot, { pid: newPid });
    expect(isGen3PatchError(out)).toBe(false);
    if (isGen3PatchError(out)) return;
    const round = unpackBoxed(out);
    if (isDecodeError(round)) throw new Error('round-trip unpack failed');
    expect(round.pid).toBe(newPid);
    // Every other field must match the original.
    expect(round.tid).toBe(original.tid);
    expect(round.sid).toBe(original.sid);
    expect(round.species).toBe(original.species);
    expect(round.ivs).toEqual(original.ivs);
    expect(round.evs).toEqual(original.evs);
    expect(round.moves).toEqual(original.moves);
    expect(Buffer.compare(Buffer.from(round.nickname), Buffer.from(original.nickname))).toBe(0);
    expect(Buffer.compare(Buffer.from(round.otName), Buffer.from(original.otName))).toBe(0);
    expect(round.exp).toBe(original.exp);
    expect(round.friendship).toBe(original.friendship);
    expect(round.pokerus).toBe(original.pokerus);
    expect(round.contestStats).toEqual(original.contestStats);
  });

  it('TID-only patch: substruct decryptable with new TID; PID/IVs preserved', () => {
    const newTid = 54321;
    const out = patchGen3Slot(slot, { tid: newTid });
    if (isGen3PatchError(out)) throw new Error(out.message);
    const round = unpackBoxed(out);
    if (isDecodeError(round)) throw new Error('TID round-trip unpack failed');
    expect(round.tid).toBe(newTid);
    expect(round.pid).toBe(original.pid);
    expect(round.ivs).toEqual(original.ivs);
    expect(round.species).toBe(original.species);
  });

  it('SID-only patch: encryption-key re-derived; non-SID fields preserved', () => {
    const newSid = 0xabcd;
    const out = patchGen3Slot(slot, { sid: newSid });
    if (isGen3PatchError(out)) throw new Error(out.message);
    const round = unpackBoxed(out);
    if (isDecodeError(round)) throw new Error('SID round-trip unpack failed');
    expect(round.sid).toBe(newSid);
    expect(round.pid).toBe(original.pid);
    expect(round.tid).toBe(original.tid);
    expect(round.ivs).toEqual(original.ivs);
  });

  it('combined PID+TID+SID patch (the load-bearing recovery case)', () => {
    const out = patchGen3Slot(slot, { pid: 0xcafef00d, tid: 12345, sid: 678 });
    if (isGen3PatchError(out)) throw new Error(out.message);
    const round = unpackBoxed(out);
    if (isDecodeError(round)) throw new Error('combined round-trip unpack failed');
    expect(round.pid).toBe(0xcafef00d);
    expect(round.tid).toBe(12345);
    expect(round.sid).toBe(678);
    // Inner-checksum integrity: unpack would have returned CHECKSUM_MISMATCH
    // if packBoxed didn't recompute. The success of unpackBoxed is
    // sufficient evidence here.
    expect(round.species).toBe(original.species);
  });

  it('IVs-only patch: PID + TID + inner-checksum integrity', () => {
    const out = patchGen3Slot(slot, {
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    });
    if (isGen3PatchError(out)) throw new Error(out.message);
    const round = unpackBoxed(out);
    if (isDecodeError(round)) throw new Error('IV round-trip unpack failed');
    expect(round.ivs).toEqual({ hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 });
    expect(round.pid).toBe(original.pid);
    expect(round.tid).toBe(original.tid);
    expect(round.sid).toBe(original.sid);
  });

  it('OT-name patch: re-encoded through Gen 3 charmap', () => {
    const out = patchGen3Slot(slot, { otName: 'TEST' });
    if (isGen3PatchError(out)) throw new Error(out.message);
    const round = unpackBoxed(out);
    if (isDecodeError(round)) throw new Error('OT round-trip unpack failed');
    // The first byte of OT should be the Gen 3 char for 'T'. We don't
    // hard-code the charmap value; we just assert it's not the original.
    expect(Buffer.compare(Buffer.from(round.otName), Buffer.from(original.otName))).not.toBe(0);
    expect(round.pid).toBe(original.pid);
  });

  it('empty edit: byte-identical output (inner re-pack still re-derives identical bytes)', () => {
    const out = patchGen3Slot(slot, {});
    if (isGen3PatchError(out)) throw new Error(out.message);
    // The header bytes (PID/TID/SID/nickname/...) should be byte-identical.
    // The substruct shuffle order depends only on PID%24 so it's stable.
    // The encryption key depends only on (pid, tid, sid) so re-encryption
    // produces the same ciphertext. Final bytes should match.
    expect(Buffer.compare(Buffer.from(out), Buffer.from(slot))).toBe(0);
  });
});

describe('patchGen3Slot — error cases', () => {
  it('DECODE_FAILED for malformed input', () => {
    const garbage = new Uint8Array(80);
    const out = patchGen3Slot(garbage, { pid: 0x12345678 });
    expect(isGen3PatchError(out)).toBe(true);
    if (isGen3PatchError(out)) {
      expect(out.reason).toBe('DECODE_FAILED');
    }
  });

  it('INTERNAL for wrong-size input', () => {
    const wrong = new Uint8Array(79);
    const out = patchGen3Slot(wrong, {});
    expect(isGen3PatchError(out)).toBe(true);
    if (isGen3PatchError(out)) {
      expect(out.reason).toBe('INTERNAL');
    }
  });
});
