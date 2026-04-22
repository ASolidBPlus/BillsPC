/**
 * Gen 1 (Pokemon Red/Blue, English) save writer — slot delete only.
 *
 * Used by the save-to-save transfer flow to evict a transferred mon from
 * the source cart, mirroring real cart-to-cart behaviour.
 *
 * Box format (party + each PC box use the same 5-region layout):
 *   count (1 byte) | species_list (N+1, 0xFF terminated) |
 *   data_records (N * record_bytes) | OT_names (N * 11) | nicknames (N * 11)
 *
 * Delete semantics:
 *   1. Shift species[K+1..count-1] down one; place 0xFF terminator at the
 *      new end of the active range.
 *   2. Shift each of records / OT_names / nicknames down by one slot worth
 *      of bytes.
 *   3. Decrement the count byte.
 *   4. Recompute the 8-bit XOR checksum at 0x3523 over 0x2598..0x3522.
 *      Only fires for buckets inside the checksum range (party + current
 *      box). Stored boxes 1..12 sit outside the range; they're modified
 *      in place and the checksum byte is left alone.
 *
 * Layout overlap caveat (Gen 1 RB only): the existing parser's
 * `RB_PARTY_NICKNAMES_OFFSET = 0x30a5` extends the party nickname table
 * into the live current PC box buffer at 0x30c0. Any shift of the
 * nickname table for a party delete therefore corrupts the current box.
 * PKHeX-style zero-fill is also off the table for the same reason. We
 * shift count, species_list, records, and OT_names (which DON'T overlap
 * the current box). Nicknames are intentionally NOT shifted: the result
 * is that post-delete party slots may show stale nickname strings, but
 * the current PC box stays byte-identical and the core mon data
 * (species/level/IVs/EVs/moves) is correct. This is a deliberate
 * trade-off; nicknames on already-evicted-from-the-cart party slots are
 * the least-important piece of state.
 *
 * Stored boxes 1..12 don't suffer this overlap; their nicknames shift
 * normally.
 */

import {
  GEN1_BOX_MAX_MONS,
  GEN1_BOX_MON_BYTES,
  GEN1_BOX_STRIDE,
  GEN1_NAME_BYTES,
  GEN1_PARTY_MON_BYTES,
  RB_BOX_BANK_OFFSETS,
  RB_BOX_MONS_OFFSET,
  RB_BOX_NICK_OFFSET,
  RB_BOX_OT_OFFSET,
  RB_BOXES_PER_BANK,
  RB_CHECKSUM_OFFSET,
  RB_CHECKSUM_RANGE_END_INCLUSIVE,
  RB_CHECKSUM_RANGE_START,
  RB_CURRENT_BOX_OFFSET,
  RB_PARTY_COUNT_OFFSET,
  RB_PARTY_NICKNAMES_OFFSET,
  RB_PARTY_OT_NAMES_OFFSET,
  RB_PARTY_RECORDS_OFFSET,
  RB_PARTY_SPECIES_OFFSET,
  RB_TOTAL_BOXES,
} from './offsets.js';

export type Gen1WriterFormat = 'RBY-RED' | 'RBY-BLUE' | 'RBY-YELLOW';

export interface Gen1DeleteRef {
  readonly bucket: 'party' | 'box' | 'currentBox';
  /** 0..11 stored-box index; required when `bucket === 'box'`. */
  readonly boxIndex?: number;
  /** 0-based slot within the bucket. */
  readonly slot: number;
}

const GEN1_PARTY_MAX_MONS = 6;

interface BlockLayout {
  readonly countOffset: number;
  readonly speciesOffset: number;
  readonly recordsOffset: number;
  readonly otNamesOffset: number;
  readonly nicknamesOffset: number;
  readonly recordBytes: number;
  readonly maxMons: number;
  readonly speciesListLen: number;
  /** True when this block's nickname table overlaps an unrelated region. */
  readonly skipNicknameShift: boolean;
}

function partyLayout(): BlockLayout {
  return {
    countOffset: RB_PARTY_COUNT_OFFSET,
    speciesOffset: RB_PARTY_SPECIES_OFFSET,
    recordsOffset: RB_PARTY_RECORDS_OFFSET,
    otNamesOffset: RB_PARTY_OT_NAMES_OFFSET,
    nicknamesOffset: RB_PARTY_NICKNAMES_OFFSET,
    recordBytes: GEN1_PARTY_MON_BYTES,
    maxMons: GEN1_PARTY_MAX_MONS,
    speciesListLen: GEN1_PARTY_MAX_MONS + 1,
    skipNicknameShift: true,
  };
}

function boxLayout(boxBase: number): BlockLayout {
  return {
    countOffset: boxBase,
    speciesOffset: boxBase + 1,
    recordsOffset: boxBase + RB_BOX_MONS_OFFSET,
    otNamesOffset: boxBase + RB_BOX_OT_OFFSET,
    nicknamesOffset: boxBase + RB_BOX_NICK_OFFSET,
    recordBytes: GEN1_BOX_MON_BYTES,
    maxMons: GEN1_BOX_MAX_MONS,
    speciesListLen: GEN1_BOX_MAX_MONS + 1,
    skipNicknameShift: false,
  };
}

function storedBoxOffset(boxIndex: number): number {
  const bank = Math.floor(boxIndex / RB_BOXES_PER_BANK);
  const within = boxIndex % RB_BOXES_PER_BANK;
  const bankOff = RB_BOX_BANK_OFFSETS[bank];
  if (bankOff === undefined) throw new Error(`gen1 deleteMon: boxIndex ${boxIndex} out of range`);
  return bankOff + within * GEN1_BOX_STRIDE;
}

function deleteFromBlock(out: Uint8Array, layout: BlockLayout, slot: number): void {
  const count = out[layout.countOffset] ?? 0;
  if (slot < 0 || slot >= count) {
    throw new Error(`gen1 deleteMon: slot ${slot} out of range (count=${count})`);
  }

  // Species list: shift slot+1..count-1 down by one, terminate.
  // The trailing freed byte (sp + count - 1 was the old terminator slot
  // OR a real species; sp + count is the new terminator position).
  const sp = layout.speciesOffset;
  for (let i = slot; i < count - 1; i++) out[sp + i] = out[sp + i + 1] ?? 0;
  out[sp + count - 1] = 0xff;
  // Note: bytes past sp + count are left as-is (see header comment re:
  // overlap with the current box buffer in RB SRAM).

  // Data records — shift in place, leave the freed trailing slot as-is.
  const rec = layout.recordsOffset;
  const rb = layout.recordBytes;
  for (let i = slot; i < count - 1; i++) {
    const dst = rec + i * rb;
    const src = rec + (i + 1) * rb;
    for (let j = 0; j < rb; j++) out[dst + j] = out[src + j] ?? 0;
  }

  // OT names.
  const ot = layout.otNamesOffset;
  for (let i = slot; i < count - 1; i++) {
    const dst = ot + i * GEN1_NAME_BYTES;
    const src = ot + (i + 1) * GEN1_NAME_BYTES;
    for (let j = 0; j < GEN1_NAME_BYTES; j++) out[dst + j] = out[src + j] ?? 0;
  }

  // Nicknames — see header note re: party-vs-current-box overlap.
  if (!layout.skipNicknameShift) {
    const nk = layout.nicknamesOffset;
    for (let i = slot; i < count - 1; i++) {
      const dst = nk + i * GEN1_NAME_BYTES;
      const src = nk + (i + 1) * GEN1_NAME_BYTES;
      for (let j = 0; j < GEN1_NAME_BYTES; j++) out[dst + j] = out[src + j] ?? 0;
    }
  }

  out[layout.countOffset] = count - 1;
}

function rangeOverlapsChecksum(start: number, endExclusive: number): boolean {
  return start <= RB_CHECKSUM_RANGE_END_INCLUSIVE && endExclusive > RB_CHECKSUM_RANGE_START;
}

function recomputeRbChecksum(out: Uint8Array): void {
  let sum = 0;
  for (let i = RB_CHECKSUM_RANGE_START; i <= RB_CHECKSUM_RANGE_END_INCLUSIVE; i++) {
    sum = (sum + (out[i] ?? 0)) & 0xff;
  }
  out[RB_CHECKSUM_OFFSET] = (0xff - sum) & 0xff;
}

export function deleteMonGen1(
  bytes: Uint8Array,
  format: Gen1WriterFormat,
  ref: Gen1DeleteRef,
): Uint8Array {
  void format; // RB and Yellow share layout for our purposes; param kept for API symmetry with gen2.
  const out = new Uint8Array(bytes);

  let layout: BlockLayout;
  switch (ref.bucket) {
    case 'party':
      layout = partyLayout();
      break;
    case 'currentBox':
      layout = boxLayout(RB_CURRENT_BOX_OFFSET);
      break;
    case 'box': {
      const boxIndex = ref.boxIndex ?? -1;
      if (boxIndex < 0 || boxIndex >= RB_TOTAL_BOXES) {
        throw new Error(`gen1 deleteMon: boxIndex ${boxIndex} out of [0, ${RB_TOTAL_BOXES})`);
      }
      layout = boxLayout(storedBoxOffset(boxIndex));
      break;
    }
  }

  // The block's footprint runs from countOffset through the end of the
  // last shifted region. (For party we skip nicknames; the OT-names
  // table is the highest touched range there.)
  const blockStart = layout.countOffset;
  const blockEnd = layout.skipNicknameShift
    ? layout.otNamesOffset + layout.maxMons * GEN1_NAME_BYTES
    : layout.nicknamesOffset + layout.maxMons * GEN1_NAME_BYTES;

  deleteFromBlock(out, layout, ref.slot);

  if (rangeOverlapsChecksum(blockStart, blockEnd)) {
    recomputeRbChecksum(out);
  }

  return out;
}
