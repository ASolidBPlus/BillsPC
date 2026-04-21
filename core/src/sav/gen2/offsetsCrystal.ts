/**
 * Pokemon Crystal (English) save layout constants.
 * Verified against `scripts/demo-crystal.sav`.
 *
 * Per PLAN_EVAL A4 — box stride is 1104 bytes; on-disk box content is
 * 1102 bytes (1 + 21 + 640 + 220 + 220). The 2-byte tail is unused
 * padding. Do NOT use `(20 * 32 + 64)` for box content size — that is
 * wrong arithmetic missing the OT and nickname tables.
 */

// Trainer block
export const C_TRAINER_TID_OFFSET = 0x2009; // u16-BE
export const C_TRAINER_NAME_OFFSET = 0x200b;
export const C_TRAINER_NAME_BYTES = 11 as const;
export const C_TRAINER_MONEY_OFFSET = 0x23db; // u24-BE
export const C_TRAINER_GENDER_OFFSET = 0x3e3d; // 0=male, 1=female

// Party
export const C_PARTY_COUNT_OFFSET = 0x2865;
export const C_PARTY_SPECIES_OFFSET = 0x2866; // 6 + 0xff
export const C_PARTY_RECORDS_OFFSET = 0x286d;
export const C_PARTY_OT_NAMES_OFFSET = 0x298d;
export const C_PARTY_NICKNAMES_OFFSET = 0x29cf;

// Box layout
// Stored boxes 1-7 at 0x4000, 8-14 at 0x6000.
// Current box index at 0x2724; current box live data at 0x2D6C.
// Current box index in Crystal: stored as a byte with the MSB used as a
// "box-was-changed" flag. Verified at 0x2700 against `demo-crystal.sav`
// (live buffer @ 0x2D10 matches stored box 2; cbi byte = 1 → 0-indexed
// box 2). PLAN.md §4.3 said 0x2724 but that lands in the RTC block.
export const C_CURRENT_BOX_INDEX_OFFSET = 0x2700;
// Live working box buffer at 0x2D10. PLAN.md §4.3 lists 0x2D6C, but
// inspection of `demo-crystal.sav` shows 0x2D6C falls in the Day-Care /
// RTC block; the live box mirrors a stored box 1:1 at 0x2D10
// (matches PKHeX `Box1` constant for SAV2_C).
export const C_CURRENT_BOX_OFFSET = 0x2d10;
export const C_BOX_BANK_OFFSETS = [0x4000, 0x6000] as const;
export const C_BOXES_PER_BANK = 7 as const;
export const C_TOTAL_BOXES = 14 as const;

// Per-box on-disk content (1102 bytes used; 1104 stride):
//   0x000 count        u8
//   0x001 species[20]  + 0xFF terminator  (21 bytes)
//   0x016 mons[20]     32 bytes each      (640 bytes) -> ends 0x296
//   0x296 ot_names[20] 11 bytes each      (220 bytes) -> ends 0x372
//   0x372 nicks[20]    11 bytes each      (220 bytes) -> ends 0x44E
//   stride 1104 (44E content + 2 padding), pad to next box.
export const GEN2_BOX_MON_BYTES = 32 as const;
export const GEN2_PARTY_MON_BYTES = 48 as const;
export const GEN2_BOX_STRIDE = 1104 as const;
export const GEN2_BOX_MAX_MONS = 20 as const;
export const GEN2_NAME_BYTES = 11 as const;
export const C_BOX_MONS_OFFSET = 0x16;
export const C_BOX_OT_OFFSET = 0x296;
export const C_BOX_NICK_OFFSET = 0x372;

// Checksum: u16-LE at 0x2D69 over additive sum of bytes 0x2009..0x2B82.
// Per PLAN_EVAL A1, this is verified ONLY when present and matching;
// detection runs structural-first because emulator save-state exports
// (like the demo file) often have stale checksums.
export const C_CHECKSUM_OFFSET = 0x2d69;
export const C_CHECKSUM_RANGE_START = 0x2009;
export const C_CHECKSUM_RANGE_END_INCLUSIVE = 0x2b82;

// Per-mon record offsets (32-byte box record layout). The 48-byte party
// record adds 16 bytes of status/cached stats at 0x20..0x2F, but every
// field used by the parser is at the same offset in both records.
export const C_MON_SPECIES = 0x00;
export const C_MON_HELD_ITEM = 0x01;
export const C_MON_MOVES = 0x02; // 4 bytes
export const C_MON_OT_TID = 0x06; // u16-BE
export const C_MON_EXP = 0x08; // u24-BE
export const C_MON_STATEXP_HP = 0x0b;
export const C_MON_STATEXP_ATK = 0x0d;
export const C_MON_STATEXP_DEF = 0x0f;
export const C_MON_STATEXP_SPE = 0x11;
export const C_MON_STATEXP_SPC = 0x13;
export const C_MON_DV_WORD = 0x15; // u16-BE
export const C_MON_PP = 0x17; // 4 bytes
export const C_MON_FRIENDSHIP = 0x1b;
export const C_MON_POKERUS = 0x1c;
export const C_MON_CAUGHT_DATA = 0x1d; // u16-BE (location/time/level/gender bits)
export const C_MON_LEVEL = 0x1f;
