/**
 * Gen 1 (Pokemon Red/Blue, English) save layout constants.
 * Verified against `scripts/demo-red.sav`.
 *
 * Per PLAN_EVAL A5, all layout constants are exported as named const so
 * the parser is greppable and the constants don't repeat as inline literals.
 */

// Trainer block
export const RB_TRAINER_NAME_OFFSET = 0x2598;
export const RB_TRAINER_NAME_BYTES = 11 as const;
export const RB_TRAINER_TID_OFFSET = 0x2605; // u16-BE
export const RB_TRAINER_MONEY_OFFSET = 0x25f3; // 3 bytes BCD

// Party
export const RB_PARTY_COUNT_OFFSET = 0x2f2c;
export const RB_PARTY_SPECIES_OFFSET = 0x2f2d; // 6 bytes + 0xff terminator
export const RB_PARTY_RECORDS_OFFSET = 0x2f34;
export const RB_PARTY_OT_NAMES_OFFSET = 0x303f;
export const RB_PARTY_NICKNAMES_OFFSET = 0x30a5;

// Box layout — current PC box at 0x30C0 (live working box).
// Stored boxes 1–6 at bank 2 (0x4000), 7–12 at bank 3 (0x6000).
export const RB_CURRENT_BOX_OFFSET = 0x30c0;
export const RB_BOX_BANK_OFFSETS = [0x4000, 0x6000] as const;
export const RB_BOXES_PER_BANK = 6 as const;
export const RB_TOTAL_BOXES = 12 as const;
export const RB_CURRENT_BOX_INDEX_OFFSET = 0x284c; // bottom 6 bits = index, bit 7 = changed

// Per-box content layout (1122 bytes, stride 1122):
//   0x000     count        u8
//   0x001     species[20]  + 0xff terminator (21 bytes)
//   0x016     mons[20]     33 bytes each = 660 bytes -> 0x2A6 end
//   0x2AA     ot_names[20] 11 bytes each = 220 bytes
//   0x386     nicks[20]    11 bytes each = 220 bytes -> 0x462 end
//   stride 1122, pad to next box.
export const GEN1_BOX_MON_BYTES = 33 as const;
export const GEN1_PARTY_MON_BYTES = 44 as const;
export const GEN1_BOX_STRIDE = 1122 as const;
export const GEN1_BOX_MAX_MONS = 20 as const;
export const GEN1_NAME_BYTES = 11 as const;
export const RB_BOX_MONS_OFFSET = 0x16; // within a box
export const RB_BOX_OT_OFFSET = 0x2aa;
export const RB_BOX_NICK_OFFSET = 0x386;

// Checksum: 0xFF - (sum of bytes 0x2598..0x3522) & 0xFF, stored at 0x3523.
export const RB_CHECKSUM_RANGE_START = 0x2598;
export const RB_CHECKSUM_RANGE_END_INCLUSIVE = 0x3522;
export const RB_CHECKSUM_OFFSET = 0x3523;

// Yellow disambiguator: Pikachu friendship at 0x271C (varies on played save).
// Detection only — Yellow parsing is deferred to a later sprint per the
// open-question rulings.
export const YELLOW_PIKACHU_FRIENDSHIP_OFFSET = 0x271c;

// Per-mon record offsets (party variant — 44 bytes; box drops 0x21..0x2B).
export const RB_MON_SPECIES = 0x00;
export const RB_MON_CURRENT_HP = 0x01; // u16-BE
export const RB_MON_BOX_LEVEL = 0x03; // u8 (box only)
export const RB_MON_STATUS = 0x04;
export const RB_MON_TYPE1 = 0x05;
export const RB_MON_TYPE2 = 0x06;
export const RB_MON_CATCH_RATE = 0x07;
export const RB_MON_MOVES = 0x08; // 4 bytes
export const RB_MON_OT_TID = 0x0c; // u16-BE
export const RB_MON_EXP = 0x0e; // u24-BE
export const RB_MON_STATEXP_HP = 0x11; // u16-BE
export const RB_MON_STATEXP_ATK = 0x13;
export const RB_MON_STATEXP_DEF = 0x15;
export const RB_MON_STATEXP_SPE = 0x17;
export const RB_MON_STATEXP_SPC = 0x19;
export const RB_MON_DV_WORD = 0x1b; // u16-BE
export const RB_MON_PP = 0x1d; // 4 bytes (low 6 = PP, high 2 = PP Ups)
export const RB_MON_PARTY_LEVEL = 0x21; // party only
