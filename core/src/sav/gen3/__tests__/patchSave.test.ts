/**
 * S10 — patchSlotInSave save-level integration tests.
 *
 * Mirrors `inject.test.ts` shape: parse a known save, inject a known
 * mon into a known empty slot, then patch its PID/TID/SID and assert:
 *   - new PID/TID/SID present after re-parse
 *   - touched-sector checksum recomputed
 *   - non-touched bytes byte-identical
 *   - sector-boundary straddle (slot 19) recomputes BOTH sector checksums
 *   - EMPTY_SLOT for empty target; BAD_TARGET for box=14
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
import { parseGen3Save, isGen3SaveError } from '../parseSave.js';
import { injectIntoSave, isGen3InjectError } from '../injectMon.js';
import { patchSlotInSave } from '../patchSave.js';
import { isGen3PatchError } from '../patchMon.js';
import { PCBUFFER_BOX_COUNT, SECTOR_CHECKSUM_OFFSET } from '../format.js';
import { gen3SectorChecksum } from '../checksum.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, '../../../../test-fixtures/gen3');
const DEMO_CRYSTAL = resolve(HERE, '../../../../../tests/fixtures/saves/demo-crystal.sav');

const FERALIGATR_GEN2_ID = 160;

function loadRuby(): Uint8Array {
  return new Uint8Array(readFileSync(resolve(FIXTURES, 'ruby.sav')));
}

function feraligatrSlot(): Uint8Array {
  const sram = new Uint8Array(readFileSync(DEMO_CRYSTAL));
  const save = parseSave(sram);
  if (isSaveError(save)) throw new Error('demo-crystal parse failed');
  const fer =
    save.party.find((m) => m.speciesGen2Id === FERALIGATR_GEN2_ID) ??
    save.boxes.flat().find((m) => m.speciesGen2Id === FERALIGATR_GEN2_ID);
  if (!fer) throw new Error('Feraligatr not found');
  const conv = convert(fer);
  if (isRefusal(conv)) throw new Error('conversion refused');
  return packBoxed(conv);
}

describe('patchSlotInSave — happy path', () => {
  it('inject a known mon at (box=0, slot=4), then patch its PID; re-parse sees new PID', () => {
    const ruby = loadRuby();
    const parsed = parseGen3Save(ruby);
    if (isGen3SaveError(parsed)) throw new Error(parsed.message);
    // Inject Feraligatr at (box=0, slot=4) — ruby's box 0 is empty.
    const injected = injectIntoSave(parsed, { boxIndex: 0, slot: 4 }, feraligatrSlot());
    if (isGen3InjectError(injected)) throw new Error(injected.message);
    expect(injected.pc.boxes[0]?.[4]?.kind).toBe('filled');

    const newPid = 0xdeadbeef;
    const patched = patchSlotInSave(injected, { boxIndex: 0, slot: 4 }, { pid: newPid });
    if (isGen3PatchError(patched)) throw new Error(patched.message);

    const slot = patched.pc.boxes[0]?.[4];
    if (slot?.kind !== 'filled') throw new Error('expected filled');
    const round = unpackBoxed(slot.bytes);
    if (isDecodeError(round)) throw new Error('round-trip unpack failed');
    expect(round.pid).toBe(newPid);
  });

  it('sector checksum at SECTOR_CHECKSUM_OFFSET matches gen3SectorChecksum after patch', () => {
    const ruby = loadRuby();
    const parsed = parseGen3Save(ruby);
    if (isGen3SaveError(parsed)) throw new Error(parsed.message);
    const injected = injectIntoSave(parsed, { boxIndex: 0, slot: 4 }, feraligatrSlot());
    if (isGen3InjectError(injected)) throw new Error(injected.message);
    const patched = patchSlotInSave(injected, { boxIndex: 0, slot: 4 }, { tid: 999 });
    if (isGen3PatchError(patched)) throw new Error(patched.message);
    // Verify the touched-sector checksum is consistent with re-parse.
    const reparsed = parseGen3Save(patched.bytes);
    if (isGen3SaveError(reparsed)) throw new Error(reparsed.message);
    expect(reparsed.warnings).not.toContain('gen3_checksum_mismatch');
    // Recompute the checksum independently and compare.
    for (const [sid, entry] of patched.active.sectorOrder) {
      const expected = gen3SectorChecksum(patched.bytes, entry.diskOffset, sid);
      const stored =
        patched.bytes[entry.diskOffset + SECTOR_CHECKSUM_OFFSET]! |
        (patched.bytes[entry.diskOffset + SECTOR_CHECKSUM_OFFSET + 1]! << 8);
      expect(stored).toBe(expected);
    }
  });

  it('non-touched slots in the PC region are byte-identical pre/post patch', () => {
    const ruby = loadRuby();
    const parsed = parseGen3Save(ruby);
    if (isGen3SaveError(parsed)) throw new Error(parsed.message);
    const injected = injectIntoSave(parsed, { boxIndex: 0, slot: 4 }, feraligatrSlot());
    if (isGen3InjectError(injected)) throw new Error(injected.message);
    const patched = patchSlotInSave(injected, { boxIndex: 0, slot: 4 }, { pid: 0x11223344 });
    if (isGen3PatchError(patched)) throw new Error(patched.message);
    // Walk every other slot and assert byte equality vs pre-patch.
    for (let b = 0; b < PCBUFFER_BOX_COUNT; b++) {
      const before = injected.pc.boxes[b];
      const after = patched.pc.boxes[b];
      if (!before || !after) continue;
      for (let s = 0; s < before.length; s++) {
        if (b === 0 && s === 4) continue; // the patched slot itself
        const bs = before[s];
        const as = after[s];
        if (!bs || !as) continue;
        expect(as.kind).toBe(bs.kind);
        if (bs.kind === 'filled' && as.kind === 'filled') {
          expect(Buffer.compare(Buffer.from(as.bytes), Buffer.from(bs.bytes))).toBe(0);
        }
      }
    }
  });
});

describe('patchSlotInSave — sector-boundary straddle (PLAN_EVAL §7 #2)', () => {
  it('patching slot 19 of box 1 (straddles sectors 5/6) updates BOTH sector checksums', () => {
    // Ruby box 1 is empty per inject.test.ts fixture metadata. Inject
    // Feraligatr at slot 19 (logical offset 3924, ends at 4004, spans
    // sector 5 → sector 6) then patch its PID. Both touched sectors
    // must have valid checksums after.
    const ruby = loadRuby();
    const parsed = parseGen3Save(ruby);
    if (isGen3SaveError(parsed)) throw new Error(parsed.message);
    expect(parsed.pc.boxes[1]?.[19]?.kind).toBe('empty');
    const injected = injectIntoSave(parsed, { boxIndex: 1, slot: 19 }, feraligatrSlot());
    if (isGen3InjectError(injected)) throw new Error(injected.message);
    const patched = patchSlotInSave(injected, { boxIndex: 1, slot: 19 }, { sid: 0xabcd });
    if (isGen3PatchError(patched)) throw new Error(patched.message);
    // Re-parse: if either sector's checksum is stale, parse logs a
    // warning. The roundtrip MUST be clean.
    const reparsed = parseGen3Save(patched.bytes);
    if (isGen3SaveError(reparsed)) throw new Error(reparsed.message);
    expect(reparsed.warnings).not.toContain('gen3_checksum_mismatch');
    // Independent checksum verification on the two boundary sectors.
    for (const sid of [5, 6]) {
      const entry = patched.active.sectorOrder.get(sid)!;
      const expected = gen3SectorChecksum(patched.bytes, entry.diskOffset, sid);
      const stored =
        patched.bytes[entry.diskOffset + SECTOR_CHECKSUM_OFFSET]! |
        (patched.bytes[entry.diskOffset + SECTOR_CHECKSUM_OFFSET + 1]! << 8);
      expect(stored).toBe(expected);
    }
  });
});

describe('patchSlotInSave — error cases', () => {
  it('EMPTY_SLOT for an empty target', () => {
    const ruby = loadRuby();
    const parsed = parseGen3Save(ruby);
    if (isGen3SaveError(parsed)) throw new Error(parsed.message);
    expect(parsed.pc.boxes[0]?.[0]?.kind).toBe('empty');
    const out = patchSlotInSave(parsed, { boxIndex: 0, slot: 0 }, { pid: 0x12345678 });
    expect(isGen3PatchError(out)).toBe(true);
    if (isGen3PatchError(out)) expect(out.reason).toBe('EMPTY_SLOT');
  });

  it('BAD_TARGET for box=14', () => {
    const ruby = loadRuby();
    const parsed = parseGen3Save(ruby);
    if (isGen3SaveError(parsed)) throw new Error(parsed.message);
    const out = patchSlotInSave(parsed, { boxIndex: 14, slot: 0 }, { pid: 0x1 });
    expect(isGen3PatchError(out)).toBe(true);
    if (isGen3PatchError(out)) expect(out.reason).toBe('BAD_TARGET');
  });

  it('BAD_TARGET for slot=30', () => {
    const ruby = loadRuby();
    const parsed = parseGen3Save(ruby);
    if (isGen3SaveError(parsed)) throw new Error(parsed.message);
    const out = patchSlotInSave(parsed, { boxIndex: 0, slot: 30 }, { pid: 0x1 });
    expect(isGen3PatchError(out)).toBe(true);
    if (isGen3PatchError(out)) expect(out.reason).toBe('BAD_TARGET');
  });
});
