/**
 * Demo: convert the live party from a Pokemon Red US save and compare
 * Gen 1 source stats vs Gen 3 converted stats, per mon and overall.
 *
 * Run from project root:  bun run scripts/demo-red-stat-check.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { convert, isRefusal } from '../core/src/index.js';
import type { Gen12Pokemon } from '../core/src/types/source.js';
import { gen2Stats } from '../tests/harness/gen2Stats.js';
import { gen3Stats } from '../tests/harness/gen3Stats.js';

// ----- Gen 1 internal index -> National Dex -----
const INTERNAL_TO_NDEX: Record<number, number> = {
  0x99: 150,
  0x15: 151,
  0x9a: 1,
  0x9b: 2,
  0x9c: 3,
  0xb0: 4,
  0xb2: 5,
  0xb4: 6,
  0xb1: 7,
  0xb3: 8,
  0xb5: 9,
  0x70: 10,
  0x71: 11,
  0x72: 12,
  0x7c: 13,
  0x7d: 14,
  0x7e: 15,
  0x24: 16,
  0x96: 17,
  0x97: 18,
  0xa5: 19,
  0xa6: 20,
  0x05: 21,
  0x23: 22,
  0x6c: 23,
  0x2d: 24,
  0x54: 25,
  0x55: 26,
  0x60: 27,
  0x61: 28,
  0x0f: 29,
  0xa8: 30,
  0x10: 31,
  0x03: 32,
  0xa7: 33,
  0x07: 34,
  0x04: 35,
  0x8e: 36,
  0x52: 37,
  0x53: 38,
  0x64: 39,
  0x65: 40,
  0x6b: 41,
  0x82: 42,
  0xb9: 43,
  0xba: 44,
  0xbb: 45,
  0x6d: 46,
  0x2e: 47,
  0x41: 48,
  0x77: 49,
  0x3b: 50,
  0x76: 51,
  0x4d: 52,
  0x90: 53,
  0x2f: 54,
  0x80: 55,
  0x39: 56,
  0x75: 57,
  0x21: 58,
  0x14: 59,
  0x47: 60,
  0x6e: 61,
  0x6f: 62,
  0x94: 63,
  0x26: 64,
  0x95: 65,
  0x6a: 66,
  0x29: 67,
  0xbc: 69,
  0xbd: 70,
  0xbe: 71,
  0x18: 72,
  0xa9: 74,
  0x27: 75,
  0x31: 76,
  0xa3: 77,
  0xa4: 78,
  0x25: 79,
  0x08: 80,
  0xad: 81,
  0x36: 82,
  0x40: 83,
  0x46: 84,
  0x74: 85,
  0x3a: 86,
  0x78: 87,
  0x0d: 88,
  0x88: 89,
  0x17: 90,
  0x8b: 91,
  0x19: 92,
  0x93: 93,
  0x0e: 94,
  0x22: 95,
  0x30: 96,
  0x81: 97,
  0x4e: 98,
  0x8a: 99,
  0x06: 100,
  0x8d: 101,
  0x0c: 102,
  0x0a: 103,
  0x11: 104,
  0x91: 105,
  0x2b: 106,
  0x2c: 107,
  0x0b: 108,
  0x37: 109,
  0x8f: 110,
  0x12: 111,
  0x01: 112,
  0x28: 113,
  0x1e: 114,
  0x02: 115,
  0x5c: 116,
  0x5d: 117,
  0x9d: 118,
  0x9e: 119,
  0x1b: 120,
  0x98: 121,
  0x2a: 122,
  0x1a: 123,
  0x48: 124,
  0x35: 125,
  0x33: 126,
  0x1d: 127,
  0x3c: 128,
  0x85: 129,
  0x16: 130,
  0x58: 131,
  0x59: 132,
  // Eeveelutions live at 0x66-0x69 (per pokered), NOT 0x42-0x45 (those are MissingNo).
  0x66: 133, // Eevee
  0x67: 136, // Flareon
  0x68: 135, // Jolteon
  0x69: 134, // Vaporeon
  0x4b: 137,
  0x4a: 138,
  0x4c: 139,
  0x49: 140,
  0x5a: 141,
  0x86: 142,
  0x1c: 143,
  0x83: 144,
  0x9f: 145,
  0xa0: 146,
  0xa1: 147,
  0x84: 149,
};

// ----- Hardcoded Gen 1/2 base stats for the species we expect to see -----
// Pokemon Red common early-game roster + the actual party (Horsea, Clefairy,
// Fearow, Oddish, Geodude). Gen 2 Special is used as both spa & spd for the
// Gen 2 stat formula reference (they share a single Special DV/StatExp).
const BASE_STATS_G2: Record<
  number,
  { hp: number; atk: number; def: number; spa: number; spd: number; spe: number }
> = {
  // ndex: gen-2 base stats
  35: { hp: 70, atk: 45, def: 48, spa: 60, spd: 65, spe: 35 }, // Clefairy (Gen2 Spc=60)
  22: { hp: 65, atk: 90, def: 65, spa: 61, spd: 61, spe: 100 }, // Fearow (Spc=61)
  43: { hp: 45, atk: 50, def: 55, spa: 75, spd: 65, spe: 30 }, // Oddish (Spc=75)
  74: { hp: 40, atk: 80, def: 100, spa: 30, spd: 30, spe: 20 }, // Geodude (Spc=30)
  116: { hp: 30, atk: 40, def: 70, spa: 70, spd: 25, spe: 60 }, // Horsea (Spc=70)
  // Add a few more in case
  6: { hp: 78, atk: 84, def: 78, spa: 85, spd: 85, spe: 100 },
  9: { hp: 79, atk: 83, def: 100, spa: 85, spd: 85, spe: 78 },
  3: { hp: 80, atk: 82, def: 83, spa: 100, spd: 100, spe: 80 },
  25: { hp: 35, atk: 55, def: 30, spa: 50, spd: 50, spe: 90 },
  143: { hp: 160, atk: 110, def: 65, spa: 65, spd: 65, spe: 30 },
};

// Gen 3 base stats (split Special). For the species we encounter, supply Gen 3 values.
const BASE_STATS_G3: Record<
  number,
  { hp: number; atk: number; def: number; spa: number; spd: number; spe: number }
> = {
  35: { hp: 70, atk: 45, def: 48, spa: 60, spd: 65, spe: 35 }, // Clefairy
  22: { hp: 65, atk: 90, def: 65, spa: 61, spd: 61, spe: 100 }, // Fearow
  43: { hp: 45, atk: 50, def: 55, spa: 75, spd: 65, spe: 30 }, // Oddish
  74: { hp: 40, atk: 80, def: 100, spa: 30, spd: 30, spe: 20 }, // Geodude
  116: { hp: 30, atk: 40, def: 70, spa: 70, spd: 25, spe: 60 }, // Horsea
};

// Gen 1 character map (subset sufficient for ASCII letters/digits)
const G1_CHARMAP: Record<number, string> = (() => {
  const m: Record<number, string> = {};
  m[0x50] = ''; // terminator
  m[0x7f] = ' ';
  // Uppercase A-Z: 0x80-0x99
  for (let i = 0; i < 26; i++) m[0x80 + i] = String.fromCharCode(0x41 + i);
  // Lowercase a-z: 0xA0-0xB9
  for (let i = 0; i < 26; i++) m[0xa0 + i] = String.fromCharCode(0x61 + i);
  // Digits 0-9: 0xF6-0xFF
  for (let i = 0; i < 10; i++) m[0xf6 + i] = String.fromCharCode(0x30 + i);
  m[0xe6] = '?';
  m[0xe7] = '!';
  m[0xe8] = '.';
  m[0xf4] = ',';
  m[0xba] = 'é'; // é
  return m;
})();

function decodeG1(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) {
    if (b === 0x50 || b === 0xff || b === 0x00) break;
    out += G1_CHARMAP[b] ?? `[${b.toString(16)}]`;
  }
  return out;
}

const SAV_PATH = join(import.meta.dir, 'demo-red.sav');
const sav = readFileSync(SAV_PATH);
console.log(`Loaded save: ${SAV_PATH} (${sav.length} bytes)`);

// Player name + TID
const playerName = decodeG1(sav.subarray(0x2598, 0x2598 + 11));
const tid = (sav[0x2605] << 8) | sav[0x2606]; // big-endian
console.log(`\n=== Trainer ===`);
console.log(`Name: "${playerName}"`);
console.log(`TID:  ${tid}`);

// Party
const partyCount = sav[0x2f2c];
console.log(`Party count: ${partyCount}`);

const partySpecies: number[] = [];
for (let i = 0; i < 6; i++) partySpecies.push(sav[0x2f2d + i]);

const PARTY_BASE = 0x2f34;
const OT_NAMES_BASE = 0x303f;
const NICKNAMES_BASE = 0x30a5;

function speciesName(ndex: number): string {
  return SPECIES_NAMES[ndex] ?? `#${ndex}`;
}

const SPECIES_NAMES: Record<number, string> = {
  35: 'Clefairy',
  22: 'Fearow',
  43: 'Oddish',
  74: 'Geodude',
  116: 'Horsea',
  117: 'Seadra',
  1: 'Bulbasaur',
  4: 'Charmander',
  6: 'Charizard',
  7: 'Squirtle',
  9: 'Blastoise',
  25: 'Pikachu',
  143: 'Snorlax',
  150: 'Mewtwo',
  151: 'Mew',
};

function be16(b: Uint8Array, off: number): number {
  return (b[off] << 8) | b[off + 1];
}
function be24(b: Uint8Array, off: number): number {
  return (b[off] << 16) | (b[off + 1] << 8) | b[off + 2];
}

interface Mon {
  index: number;
  internalSpecies: number;
  ndex: number;
  level: number;
  exp: number;
  currentHp: number;
  status: number;
  type1: number;
  type2: number;
  catchRate: number;
  moves: [number, number, number, number];
  otTid: number;
  statExp: { hp: number; atk: number; def: number; spe: number; special: number };
  dvs: { atk: number; def: number; spe: number; special: number };
  pp: [number, number, number, number];
  ppUps: [number, number, number, number];
  cachedStats: { hp: number; atk: number; def: number; spe: number; special: number };
  otNameBytes: Uint8Array;
  nicknameBytes: Uint8Array;
  otName: string;
  nickname: string;
}

const mons: Mon[] = [];

for (let i = 0; i < partyCount; i++) {
  const off = PARTY_BASE + i * 44;
  const speciesByte = sav[off];
  const ndex = INTERNAL_TO_NDEX[speciesByte] ?? 0;
  const dvWord = be16(sav, off + 0x1b);
  const dvs = {
    atk: (dvWord >> 12) & 0xf,
    def: (dvWord >> 8) & 0xf,
    spe: (dvWord >> 4) & 0xf,
    special: dvWord & 0xf,
  };
  const ppRaw = [sav[off + 0x1d], sav[off + 0x1e], sav[off + 0x1f], sav[off + 0x20]];
  const pp: [number, number, number, number] = [
    ppRaw[0] & 0x3f,
    ppRaw[1] & 0x3f,
    ppRaw[2] & 0x3f,
    ppRaw[3] & 0x3f,
  ];
  const ppUps: [number, number, number, number] = [
    (ppRaw[0] >> 6) & 0x3,
    (ppRaw[1] >> 6) & 0x3,
    (ppRaw[2] >> 6) & 0x3,
    (ppRaw[3] >> 6) & 0x3,
  ];

  const otNameBytes = sav.subarray(OT_NAMES_BASE + i * 11, OT_NAMES_BASE + (i + 1) * 11);
  const nicknameBytes = sav.subarray(NICKNAMES_BASE + i * 11, NICKNAMES_BASE + (i + 1) * 11);

  mons.push({
    index: i,
    internalSpecies: speciesByte,
    ndex,
    level: sav[off + 0x21],
    exp: be24(sav, off + 0x0e),
    currentHp: be16(sav, off + 0x01),
    status: sav[off + 0x04],
    type1: sav[off + 0x05],
    type2: sav[off + 0x06],
    catchRate: sav[off + 0x07],
    moves: [sav[off + 0x08], sav[off + 0x09], sav[off + 0x0a], sav[off + 0x0b]],
    otTid: be16(sav, off + 0x0c),
    statExp: {
      hp: be16(sav, off + 0x11),
      atk: be16(sav, off + 0x13),
      def: be16(sav, off + 0x15),
      spe: be16(sav, off + 0x17),
      special: be16(sav, off + 0x19),
    },
    dvs,
    pp,
    ppUps,
    cachedStats: {
      hp: be16(sav, off + 0x22),
      atk: be16(sav, off + 0x24),
      def: be16(sav, off + 0x26),
      spe: be16(sav, off + 0x28),
      special: be16(sav, off + 0x2a),
    },
    otNameBytes: new Uint8Array(otNameBytes),
    nicknameBytes: new Uint8Array(nicknameBytes),
    otName: decodeG1(otNameBytes),
    nickname: decodeG1(nicknameBytes),
  });
}

// ---- Per-mon convert + compare ----
const totals: number[] = [];
const refusals: { idx: number; nick: string; reason: string; message: string }[] = [];

console.log(`\n=== Party (${partyCount}) ===`);

for (const m of mons) {
  const sName = speciesName(m.ndex);
  console.log(`\n--- Slot ${m.index + 1}: ${m.nickname} (${sName}, Lv ${m.level}) ---`);
  console.log(
    `  internal=0x${m.internalSpecies.toString(16)} ndex=${m.ndex} OT="${m.otName}" OT_TID=${m.otTid} EXP=${m.exp}`,
  );
  console.log(
    `  Source DVs:    Atk=${m.dvs.atk} Def=${m.dvs.def} Spe=${m.dvs.spe} Spc=${m.dvs.special}`,
  );
  console.log(
    `  Source StatExp: HP=${m.statExp.hp} Atk=${m.statExp.atk} Def=${m.statExp.def} Spe=${m.statExp.spe} Spc=${m.statExp.special}`,
  );
  console.log(
    `  Cached G1 stats: HP=${m.cachedStats.hp} Atk=${m.cachedStats.atk} Def=${m.cachedStats.def} Spe=${m.cachedStats.spe} Spc=${m.cachedStats.special}`,
  );

  if (!m.ndex) {
    console.log(`  [SKIP] Unknown internal species 0x${m.internalSpecies.toString(16)}`);
    continue;
  }

  const baseG2 = BASE_STATS_G2[m.ndex];
  if (!baseG2) {
    console.log(`  [SKIP] No Gen 2 base stats hardcoded for ndex ${m.ndex}`);
    continue;
  }

  // Compute Gen 2 stats from source — split Special into spa/spd using Gen 2 single Special.
  const sourceStats = gen2Stats(
    {
      hp: baseG2.hp,
      atk: baseG2.atk,
      def: baseG2.def,
      spa: baseG2.spa,
      spd: baseG2.spd,
      spe: baseG2.spe,
    },
    m.dvs,
    m.statExp,
    m.level,
  );
  console.log(
    `  Computed Gen 2 stats: HP=${sourceStats.hp} Atk=${sourceStats.atk} Def=${sourceStats.def} SpA=${sourceStats.spa} SpD=${sourceStats.spd} Spe=${sourceStats.spe}`,
  );

  // Build Gen12Pokemon source struct.
  const src: Gen12Pokemon = {
    sourceGen: 1,
    speciesGen2Id: m.ndex,
    level: m.level,
    exp: m.exp,
    dvs: m.dvs,
    statExp: m.statExp,
    moves: m.moves,
    pp: m.pp,
    ppUps: [0, 0, 0, 0],
    heldItemGen2Id: null,
    friendship: null,
    pokerusByte: 0,
    otNameBytes: m.otNameBytes,
    tid,
    nicknameBytes: m.nicknameBytes,
    language: 2,
  };

  let result;
  try {
    result = convert(src);
  } catch (err) {
    console.log(`  [ERROR] convert() threw: ${(err as Error).message}`);
    continue;
  }

  if (isRefusal(result)) {
    console.log(`  [REFUSED] ${result.reason}: ${result.message}`);
    refusals.push({
      idx: m.index,
      nick: m.nickname,
      reason: result.reason,
      message: result.message,
    });
    continue;
  }

  const r = result;
  console.log(
    `  Converted IVs: HP=${r.ivs.hp} Atk=${r.ivs.atk} Def=${r.ivs.def} SpA=${r.ivs.spa} SpD=${r.ivs.spd} Spe=${r.ivs.spe}`,
  );
  console.log(
    `  Converted EVs: HP=${r.evs.hp} Atk=${r.evs.atk} Def=${r.evs.def} SpA=${r.evs.spa} SpD=${r.evs.spd} Spe=${r.evs.spe}`,
  );
  console.log(
    `  Nature=${r.nature} PID=0x${r.pid.toString(16).padStart(8, '0')} SID=${r.sid} (PID iters=${r._meta.pidSearchIterations})`,
  );

  const baseG3 = BASE_STATS_G3[m.ndex] ?? baseG2;
  const targetStats = gen3Stats(baseG3, r.ivs, r.evs, m.level, r.nature);
  console.log(
    `  Computed Gen 3 stats: HP=${targetStats.hp} Atk=${targetStats.atk} Def=${targetStats.def} SpA=${targetStats.spa} SpD=${targetStats.spd} Spe=${targetStats.spe}`,
  );

  const dHp = targetStats.hp - sourceStats.hp;
  const dAtk = targetStats.atk - sourceStats.atk;
  const dDef = targetStats.def - sourceStats.def;
  const dSpA = targetStats.spa - sourceStats.spa;
  const dSpD = targetStats.spd - sourceStats.spd;
  const dSpe = targetStats.spe - sourceStats.spe;
  const tot =
    Math.abs(dHp) +
    Math.abs(dAtk) +
    Math.abs(dDef) +
    Math.abs(dSpA) +
    Math.abs(dSpD) +
    Math.abs(dSpe);
  console.log(
    `  Delta:         HP=${dHp} Atk=${dAtk} Def=${dDef} SpA=${dSpA} SpD=${dSpD} Spe=${dSpe}`,
  );
  console.log(`  Total |dev|:   ${tot}`);
  totals.push(tot);
}

console.log(`\n=== Summary ===`);
console.log(`Trainer: "${playerName}" TID=${tid}`);
console.log(`Party size: ${partyCount}`);
if (totals.length > 0) {
  const sum = totals.reduce((a, b) => a + b, 0);
  const avg = sum / totals.length;
  console.log(`Converted ${totals.length} mon(s). Total |dev| sum=${sum}, avg=${avg.toFixed(2)}`);
} else {
  console.log(`No mons converted.`);
}
if (refusals.length > 0) {
  console.log(`Refusals (${refusals.length}):`);
  for (const r of refusals)
    console.log(`  - slot ${r.idx + 1} ${r.nick}: ${r.reason} — ${r.message}`);
} else {
  console.log(`Refusals: none`);
}
