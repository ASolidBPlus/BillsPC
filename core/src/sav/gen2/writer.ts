/**
 * Gen 2 (Pokemon Crystal English) save writer — slot delete only.
 *
 * Used by the save-to-save transfer flow to evict a transferred mon from
 * the source cart, mirroring real cart-to-cart behaviour.
 *
 * Box format mirrors the layout in `offsetsCrystal.ts` (PKHeX-verified):
 *   count(1) | species(N+1, 0xFF terminated) |
 *   records(N * 32) | OT_names(N * 11) | nicknames(N * 11)
 *
 * Crystal English checksum layout (PKHeX SAV2 Crystal):
 *   primary  : 0x2D69 (LE16) over 0x2009..0x2B82
 *   backup   : 0x1F0D (LE16) over 0x1209..0x1D82  (a verbatim mirror of
 *              the primary block, byte-for-byte; the game checks this on
 *              boot if the primary checksum fails)
 *
 * Box banks at 0x4000/0x6000 and the live current-box buffer at 0x2D10
 * sit OUTSIDE both checksum ranges, so deletes from a non-current PC
 * box require no checksum work at all. Party deletes (0x2865 inside the
 * primary range) write to the primary block AND its 0x1209 mirror, then
 * recompute both checksums.
 *
 * The `format` parameter is reserved for GS support but unused today —
 * GS parsing is gated to a later sprint. Passing 'GS' throws so the
 * caller doesn't get a silently-broken save.
 */

import {
  C_BOX_BANK_OFFSETS,
  C_BOXES_PER_BANK,
  C_BOX_MONS_OFFSET,
  C_BOX_NICK_OFFSET,
  C_BOX_OT_OFFSET,
  C_CHECKSUM_OFFSET,
  C_CHECKSUM_RANGE_END_INCLUSIVE,
  C_CHECKSUM_RANGE_START,
  C_CURRENT_BOX_OFFSET,
  C_PARTY_COUNT_OFFSET,
  C_PARTY_NICKNAMES_OFFSET,
  C_PARTY_OT_NAMES_OFFSET,
  C_PARTY_RECORDS_OFFSET,
  C_PARTY_SPECIES_OFFSET,
  C_TOTAL_BOXES,
  GEN2_BOX_MAX_MONS,
  GEN2_BOX_MON_BYTES,
  GEN2_BOX_STRIDE,
  GEN2_NAME_BYTES,
  GEN2_PARTY_MON_BYTES,
} from './offsetsCrystal.js';

export type Gen2WriterFormat = 'GS' | 'CRYSTAL';

export interface Gen2DeleteRef {
  readonly bucket: 'party' | 'box' | 'currentBox';
  /** 0..13 stored-box index; required when `bucket === 'box'`. */
  readonly boxIndex?: number;
  /** 0-based slot within the bucket. */
  readonly slot: number;
}

const GEN2_PARTY_MAX_MONS = 6;

// Backup mirror: the primary block (0x2009..0x2B82) is duplicated
// verbatim at 0x1209..0x1D82. The mirror's checksum is at 0x1F0D.
// Verified empirically against demo-crystal.sav.
const C_BACKUP_MIRROR_OFFSET = 0x1209;
const C_BACKUP_CHECKSUM_OFFSET = 0x1f0d;

interface BlockLayout {
  readonly countOffset: number;
  readonly speciesOffset: number;
  readonly recordsOffset: number;
  readonly otNamesOffset: number;
  readonly nicknamesOffset: number;
  readonly recordBytes: number;
  readonly maxMons: number;
  readonly speciesListLen: number;
}

function partyLayout(): BlockLayout {
  return {
    countOffset: C_PARTY_COUNT_OFFSET,
    speciesOffset: C_PARTY_SPECIES_OFFSET,
    recordsOffset: C_PARTY_RECORDS_OFFSET,
    otNamesOffset: C_PARTY_OT_NAMES_OFFSET,
    nicknamesOffset: C_PARTY_NICKNAMES_OFFSET,
    recordBytes: GEN2_PARTY_MON_BYTES,
    maxMons: GEN2_PARTY_MAX_MONS,
    speciesListLen: GEN2_PARTY_MAX_MONS + 1,
  };
}

function boxLayout(boxBase: number): BlockLayout {
  return {
    countOffset: boxBase,
    speciesOffset: boxBase + 1,
    recordsOffset: boxBase + C_BOX_MONS_OFFSET,
    otNamesOffset: boxBase + C_BOX_OT_OFFSET,
    nicknamesOffset: boxBase + C_BOX_NICK_OFFSET,
    recordBytes: GEN2_BOX_MON_BYTES,
    maxMons: GEN2_BOX_MAX_MONS,
    speciesListLen: GEN2_BOX_MAX_MONS + 1,
  };
}

function storedBoxOffset(boxIndex: number): number {
  const bank = Math.floor(boxIndex / C_BOXES_PER_BANK);
  const within = boxIndex % C_BOXES_PER_BANK;
  const bankOff = C_BOX_BANK_OFFSETS[bank];
  if (bankOff === undefined) throw new Error(`gen2 deleteMon: boxIndex ${boxIndex} out of range`);
  return bankOff + within * GEN2_BOX_STRIDE;
}

function deleteFromBlock(out: Uint8Array, layout: BlockLayout, slot: number): void {
  const count = out[layout.countOffset] ?? 0;
  if (slot < 0 || slot >= count) {
    throw new Error(`gen2 deleteMon: slot ${slot} out of range (count=${count})`);
  }

  const sp = layout.speciesOffset;
  for (let i = slot; i < count - 1; i++) out[sp + i] = out[sp + i + 1] ?? 0;
  out[sp + count - 1] = 0xff;
  if (count < layout.speciesListLen) out[sp + count] = 0x00;

  const rec = layout.recordsOffset;
  const rb = layout.recordBytes;
  for (let i = slot; i < count - 1; i++) {
    const dst = rec + i * rb;
    const src = rec + (i + 1) * rb;
    for (let j = 0; j < rb; j++) out[dst + j] = out[src + j] ?? 0;
  }
  const freedRecOff = rec + (count - 1) * rb;
  for (let j = 0; j < rb; j++) out[freedRecOff + j] = 0x00;

  const ot = layout.otNamesOffset;
  for (let i = slot; i < count - 1; i++) {
    const dst = ot + i * GEN2_NAME_BYTES;
    const src = ot + (i + 1) * GEN2_NAME_BYTES;
    for (let j = 0; j < GEN2_NAME_BYTES; j++) out[dst + j] = out[src + j] ?? 0;
  }
  const freedOtOff = ot + (count - 1) * GEN2_NAME_BYTES;
  for (let j = 0; j < GEN2_NAME_BYTES; j++) out[freedOtOff + j] = 0x00;

  const nk = layout.nicknamesOffset;
  for (let i = slot; i < count - 1; i++) {
    const dst = nk + i * GEN2_NAME_BYTES;
    const src = nk + (i + 1) * GEN2_NAME_BYTES;
    for (let j = 0; j < GEN2_NAME_BYTES; j++) out[dst + j] = out[src + j] ?? 0;
  }
  const freedNkOff = nk + (count - 1) * GEN2_NAME_BYTES;
  for (let j = 0; j < GEN2_NAME_BYTES; j++) out[freedNkOff + j] = 0x00;

  out[layout.countOffset] = count - 1;
}

function rangeOverlapsPrimary(start: number, endExclusive: number): boolean {
  return start <= C_CHECKSUM_RANGE_END_INCLUSIVE && endExclusive > C_CHECKSUM_RANGE_START;
}

function syncBackupMirror(out: Uint8Array): void {
  const len = C_CHECKSUM_RANGE_END_INCLUSIVE - C_CHECKSUM_RANGE_START + 1;
  for (let i = 0; i < len; i++) {
    out[C_BACKUP_MIRROR_OFFSET + i] = out[C_CHECKSUM_RANGE_START + i] ?? 0;
  }
}

function checksum16(out: Uint8Array, start: number, endInclusive: number): number {
  let sum = 0;
  for (let i = start; i <= endInclusive; i++) sum = (sum + (out[i] ?? 0)) & 0xffff;
  return sum;
}

function writeU16LE(out: Uint8Array, off: number, val: number): void {
  out[off] = val & 0xff;
  out[off + 1] = (val >> 8) & 0xff;
}

function recomputeChecksums(out: Uint8Array): void {
  syncBackupMirror(out);
  const primary = checksum16(out, C_CHECKSUM_RANGE_START, C_CHECKSUM_RANGE_END_INCLUSIVE);
  writeU16LE(out, C_CHECKSUM_OFFSET, primary);
  const mirrorLen = C_CHECKSUM_RANGE_END_INCLUSIVE - C_CHECKSUM_RANGE_START;
  const backup = checksum16(out, C_BACKUP_MIRROR_OFFSET, C_BACKUP_MIRROR_OFFSET + mirrorLen);
  writeU16LE(out, C_BACKUP_CHECKSUM_OFFSET, backup);
}

export function deleteMonGen2(
  bytes: Uint8Array,
  format: Gen2WriterFormat,
  ref: Gen2DeleteRef,
): Uint8Array {
  if (format === 'GS') {
    throw new Error('gen2 deleteMon: GS write support is deferred to a later sprint.');
  }
  const out = new Uint8Array(bytes);

  let layout: BlockLayout;
  switch (ref.bucket) {
    case 'party':
      layout = partyLayout();
      break;
    case 'currentBox':
      layout = boxLayout(C_CURRENT_BOX_OFFSET);
      break;
    case 'box': {
      const boxIndex = ref.boxIndex ?? -1;
      if (boxIndex < 0 || boxIndex >= C_TOTAL_BOXES) {
        throw new Error(`gen2 deleteMon: boxIndex ${boxIndex} out of [0, ${C_TOTAL_BOXES})`);
      }
      layout = boxLayout(storedBoxOffset(boxIndex));
      break;
    }
  }

  const blockStart = layout.countOffset;
  const blockEnd = layout.nicknamesOffset + layout.maxMons * GEN2_NAME_BYTES;

  deleteFromBlock(out, layout, ref.slot);

  if (rangeOverlapsPrimary(blockStart, blockEnd)) {
    recomputeChecksums(out);
  }

  return out;
}
