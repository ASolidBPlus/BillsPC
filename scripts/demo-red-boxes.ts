/**
 * Demo: parse all 12 stored boxes from a Pokemon Red US save, identify
 * highly-trained mons, run convert(), and compare Gen 2 vs Gen 3 stats.
 *
 * Run from project root:  bun run scripts/demo-red-boxes.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { convert, isRefusal } from '../core/src/index.js';
import type { Gen12Pokemon } from '../core/src/types/source.js';
import { gen2Stats } from '../tests/harness/gen2Stats.js';
import { gen3Stats } from '../tests/harness/gen3Stats.js';

// ---------- Imported tables (inlined from demo-red-stat-check.ts) ----------
// We avoid importing from that script (it has top-level side-effects), so
// re-declare the tables here. Tables are duplicated by design — the prompt
// says "import" but the source file does not export them; copying preserves
// the contract without modifying that file.

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
  0x42: 133,
  0x43: 134,
  0x44: 135,
  0x45: 136,
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

// Gen 2 base-stats reference table (used as Source for Gen 2 stat formula).
const BASE_STATS_G2: Record<
  number,
  { hp: number; atk: number; def: number; spa: number; spd: number; spe: number }
> = {
  35: { hp: 70, atk: 45, def: 48, spa: 60, spd: 65, spe: 35 },
  22: { hp: 65, atk: 90, def: 65, spa: 61, spd: 61, spe: 100 },
  43: { hp: 45, atk: 50, def: 55, spa: 75, spd: 65, spe: 30 },
  74: { hp: 40, atk: 80, def: 100, spa: 30, spd: 30, spe: 20 },
  116: { hp: 30, atk: 40, def: 70, spa: 70, spd: 25, spe: 60 },
  6: { hp: 78, atk: 84, def: 78, spa: 85, spd: 85, spe: 100 },
  9: { hp: 79, atk: 83, def: 100, spa: 85, spd: 85, spe: 78 },
  3: { hp: 80, atk: 82, def: 83, spa: 100, spd: 100, spe: 80 },
  25: { hp: 35, atk: 55, def: 30, spa: 50, spd: 50, spe: 90 },
  143: { hp: 160, atk: 110, def: 65, spa: 65, spd: 65, spe: 30 },
};

// Gen 3 base-stat OVERRIDES — only species where Gen 3 differs from Gen 1/2.
// For Gen 1 species, the only real Gen-3-era rebalance was Charizard's SpA
// going from 85 → 109. Everything else carried forward unchanged through Gen 3.
// (Other Gen 1 species got buffs in Gen 6+, not Gen 3.)
const BASE_STATS_G3: Record<
  number,
  { hp: number; atk: number; def: number; spa: number; spd: number; spe: number }
> = {
  6: { hp: 78, atk: 84, def: 78, spa: 109, spd: 85, spe: 100 }, // Charizard — SpA buffed in Gen 3
};

// Local extension tables for any species we encounter beyond the originals.
// Gen 2 base stats and Gen 3 base stats are identical for Gen 1 species
// (Special split has same numeric SpA/SpD as Gen 2 SpA/SpD since Gen 2
// already split it). Source: Bulbapedia.
const BASE_STATS_EXT: Record<
  number,
  { hp: number; atk: number; def: number; spa: number; spd: number; spe: number }
> = {
  1: { hp: 45, atk: 49, def: 49, spa: 65, spd: 65, spe: 45 }, // Bulbasaur
  2: { hp: 60, atk: 62, def: 63, spa: 80, spd: 80, spe: 60 }, // Ivysaur
  4: { hp: 39, atk: 52, def: 43, spa: 60, spd: 50, spe: 65 }, // Charmander
  5: { hp: 58, atk: 64, def: 58, spa: 80, spd: 65, spe: 80 }, // Charmeleon
  7: { hp: 44, atk: 48, def: 65, spa: 50, spd: 64, spe: 43 }, // Squirtle
  8: { hp: 59, atk: 63, def: 80, spa: 65, spd: 80, spe: 58 }, // Wartortle
  10: { hp: 45, atk: 30, def: 35, spa: 20, spd: 20, spe: 45 }, // Caterpie
  11: { hp: 50, atk: 20, def: 55, spa: 25, spd: 25, spe: 30 }, // Metapod
  12: { hp: 60, atk: 45, def: 50, spa: 80, spd: 80, spe: 70 }, // Butterfree
  13: { hp: 40, atk: 35, def: 30, spa: 20, spd: 20, spe: 50 }, // Weedle
  14: { hp: 45, atk: 25, def: 50, spa: 25, spd: 25, spe: 35 }, // Kakuna
  15: { hp: 65, atk: 80, def: 40, spa: 45, spd: 80, spe: 75 }, // Beedrill
  16: { hp: 40, atk: 45, def: 40, spa: 35, spd: 35, spe: 56 }, // Pidgey
  17: { hp: 63, atk: 60, def: 55, spa: 50, spd: 50, spe: 71 }, // Pidgeotto
  18: { hp: 83, atk: 80, def: 75, spa: 70, spd: 70, spe: 91 }, // Pidgeot
  19: { hp: 30, atk: 56, def: 35, spa: 25, spd: 35, spe: 72 }, // Rattata
  20: { hp: 55, atk: 81, def: 60, spa: 50, spd: 70, spe: 97 }, // Raticate
  21: { hp: 40, atk: 60, def: 30, spa: 31, spd: 31, spe: 70 }, // Spearow
  23: { hp: 35, atk: 60, def: 44, spa: 40, spd: 54, spe: 55 }, // Ekans
  24: { hp: 60, atk: 85, def: 69, spa: 65, spd: 79, spe: 80 }, // Arbok
  26: { hp: 60, atk: 90, def: 55, spa: 90, spd: 80, spe: 110 }, // Raichu
  27: { hp: 50, atk: 75, def: 85, spa: 20, spd: 30, spe: 40 }, // Sandshrew
  28: { hp: 75, atk: 100, def: 110, spa: 45, spd: 55, spe: 65 }, // Sandslash
  29: { hp: 55, atk: 47, def: 52, spa: 40, spd: 40, spe: 41 }, // Nidoran-F
  30: { hp: 70, atk: 62, def: 67, spa: 55, spd: 55, spe: 56 }, // Nidorina
  31: { hp: 90, atk: 92, def: 87, spa: 75, spd: 85, spe: 76 }, // Nidoqueen
  32: { hp: 46, atk: 57, def: 40, spa: 40, spd: 40, spe: 50 }, // Nidoran-M
  33: { hp: 61, atk: 72, def: 57, spa: 55, spd: 55, spe: 65 }, // Nidorino
  34: { hp: 81, atk: 92, def: 77, spa: 85, spd: 75, spe: 85 }, // Nidoking
  36: { hp: 95, atk: 70, def: 73, spa: 85, spd: 90, spe: 60 }, // Clefable
  37: { hp: 38, atk: 41, def: 40, spa: 50, spd: 65, spe: 65 }, // Vulpix
  38: { hp: 73, atk: 76, def: 75, spa: 81, spd: 100, spe: 100 }, // Ninetales
  39: { hp: 115, atk: 45, def: 20, spa: 45, spd: 25, spe: 20 }, // Jigglypuff
  40: { hp: 140, atk: 70, def: 45, spa: 75, spd: 50, spe: 45 }, // Wigglytuff
  41: { hp: 40, atk: 45, def: 35, spa: 30, spd: 40, spe: 55 }, // Zubat
  42: { hp: 75, atk: 80, def: 70, spa: 65, spd: 75, spe: 90 }, // Golbat
  44: { hp: 60, atk: 65, def: 70, spa: 85, spd: 75, spe: 40 }, // Gloom
  45: { hp: 75, atk: 80, def: 85, spa: 100, spd: 90, spe: 50 }, // Vileplume
  46: { hp: 35, atk: 70, def: 55, spa: 45, spd: 55, spe: 25 }, // Paras
  47: { hp: 60, atk: 95, def: 80, spa: 60, spd: 80, spe: 30 }, // Parasect
  48: { hp: 60, atk: 55, def: 50, spa: 40, spd: 55, spe: 45 }, // Venonat
  49: { hp: 70, atk: 65, def: 60, spa: 90, spd: 75, spe: 90 }, // Venomoth
  50: { hp: 10, atk: 55, def: 25, spa: 35, spd: 45, spe: 95 }, // Diglett
  51: { hp: 35, atk: 80, def: 50, spa: 50, spd: 70, spe: 120 }, // Dugtrio
  52: { hp: 40, atk: 45, def: 35, spa: 40, spd: 40, spe: 90 }, // Meowth
  53: { hp: 65, atk: 70, def: 60, spa: 65, spd: 65, spe: 115 }, // Persian
  54: { hp: 50, atk: 52, def: 48, spa: 65, spd: 50, spe: 55 }, // Psyduck
  55: { hp: 80, atk: 82, def: 78, spa: 95, spd: 80, spe: 85 }, // Golduck
  56: { hp: 40, atk: 80, def: 35, spa: 35, spd: 45, spe: 70 }, // Mankey
  57: { hp: 65, atk: 105, def: 60, spa: 60, spd: 70, spe: 95 }, // Primeape
  58: { hp: 55, atk: 70, def: 45, spa: 70, spd: 50, spe: 60 }, // Growlithe
  59: { hp: 90, atk: 110, def: 80, spa: 100, spd: 80, spe: 95 }, // Arcanine
  60: { hp: 40, atk: 50, def: 40, spa: 40, spd: 40, spe: 90 }, // Poliwag
  61: { hp: 65, atk: 65, def: 65, spa: 50, spd: 50, spe: 90 }, // Poliwhirl
  62: { hp: 90, atk: 95, def: 95, spa: 70, spd: 90, spe: 70 }, // Poliwrath
  63: { hp: 25, atk: 20, def: 15, spa: 105, spd: 55, spe: 90 }, // Abra
  64: { hp: 40, atk: 35, def: 30, spa: 120, spd: 70, spe: 105 }, // Kadabra
  65: { hp: 55, atk: 50, def: 45, spa: 135, spd: 85, spe: 120 }, // Alakazam
  66: { hp: 70, atk: 80, def: 50, spa: 35, spd: 35, spe: 35 }, // Machop
  67: { hp: 80, atk: 100, def: 70, spa: 50, spd: 60, spe: 45 }, // Machoke
  68: { hp: 90, atk: 130, def: 80, spa: 65, spd: 85, spe: 55 }, // Machamp
  69: { hp: 50, atk: 75, def: 35, spa: 70, spd: 30, spe: 40 }, // Bellsprout
  70: { hp: 65, atk: 90, def: 50, spa: 85, spd: 45, spe: 55 }, // Weepinbell
  71: { hp: 80, atk: 105, def: 65, spa: 100, spd: 60, spe: 70 }, // Victreebel
  72: { hp: 40, atk: 40, def: 35, spa: 50, spd: 100, spe: 70 }, // Tentacool
  73: { hp: 80, atk: 70, def: 65, spa: 80, spd: 120, spe: 100 }, // Tentacruel
  75: { hp: 55, atk: 95, def: 115, spa: 45, spd: 45, spe: 35 }, // Graveler
  76: { hp: 80, atk: 110, def: 130, spa: 55, spd: 65, spe: 45 }, // Golem
  77: { hp: 50, atk: 85, def: 55, spa: 65, spd: 65, spe: 90 }, // Ponyta
  78: { hp: 65, atk: 100, def: 70, spa: 80, spd: 80, spe: 105 }, // Rapidash
  79: { hp: 90, atk: 65, def: 65, spa: 40, spd: 40, spe: 15 }, // Slowpoke
  80: { hp: 95, atk: 75, def: 110, spa: 100, spd: 80, spe: 30 }, // Slowbro
  81: { hp: 25, atk: 35, def: 70, spa: 95, spd: 55, spe: 45 }, // Magnemite
  82: { hp: 50, atk: 60, def: 95, spa: 120, spd: 70, spe: 70 }, // Magneton
  83: { hp: 52, atk: 65, def: 55, spa: 58, spd: 62, spe: 60 }, // Farfetch'd
  84: { hp: 35, atk: 85, def: 45, spa: 35, spd: 35, spe: 75 }, // Doduo
  85: { hp: 60, atk: 110, def: 70, spa: 60, spd: 60, spe: 100 }, // Dodrio
  86: { hp: 65, atk: 45, def: 55, spa: 45, spd: 70, spe: 45 }, // Seel
  87: { hp: 90, atk: 70, def: 80, spa: 70, spd: 95, spe: 70 }, // Dewgong
  88: { hp: 80, atk: 80, def: 50, spa: 40, spd: 50, spe: 25 }, // Grimer
  89: { hp: 105, atk: 105, def: 75, spa: 65, spd: 100, spe: 50 }, // Muk
  90: { hp: 30, atk: 65, def: 100, spa: 45, spd: 25, spe: 40 }, // Shellder
  91: { hp: 50, atk: 95, def: 180, spa: 85, spd: 45, spe: 70 }, // Cloyster
  92: { hp: 30, atk: 35, def: 30, spa: 100, spd: 35, spe: 80 }, // Gastly
  93: { hp: 45, atk: 50, def: 45, spa: 115, spd: 55, spe: 95 }, // Haunter
  94: { hp: 60, atk: 65, def: 60, spa: 130, spd: 75, spe: 110 }, // Gengar
  95: { hp: 35, atk: 45, def: 160, spa: 30, spd: 45, spe: 70 }, // Onix
  96: { hp: 60, atk: 48, def: 45, spa: 43, spd: 90, spe: 42 }, // Drowzee
  97: { hp: 85, atk: 73, def: 70, spa: 73, spd: 115, spe: 67 }, // Hypno
  98: { hp: 30, atk: 105, def: 90, spa: 25, spd: 25, spe: 50 }, // Krabby
  99: { hp: 55, atk: 130, def: 115, spa: 50, spd: 50, spe: 75 }, // Kingler
  100: { hp: 40, atk: 30, def: 50, spa: 55, spd: 55, spe: 100 }, // Voltorb
  101: { hp: 60, atk: 50, def: 70, spa: 80, spd: 80, spe: 140 }, // Electrode
  102: { hp: 60, atk: 40, def: 80, spa: 60, spd: 45, spe: 40 }, // Exeggcute
  103: { hp: 95, atk: 95, def: 85, spa: 125, spd: 65, spe: 55 }, // Exeggutor
  104: { hp: 50, atk: 50, def: 95, spa: 40, spd: 50, spe: 35 }, // Cubone
  105: { hp: 60, atk: 80, def: 110, spa: 50, spd: 80, spe: 45 }, // Marowak
  106: { hp: 50, atk: 120, def: 53, spa: 35, spd: 110, spe: 87 }, // Hitmonlee
  107: { hp: 50, atk: 105, def: 79, spa: 35, spd: 110, spe: 76 }, // Hitmonchan
  108: { hp: 90, atk: 55, def: 75, spa: 60, spd: 75, spe: 30 }, // Lickitung
  109: { hp: 40, atk: 65, def: 95, spa: 60, spd: 45, spe: 35 }, // Koffing
  110: { hp: 65, atk: 90, def: 120, spa: 85, spd: 70, spe: 60 }, // Weezing
  111: { hp: 80, atk: 85, def: 95, spa: 30, spd: 30, spe: 25 }, // Rhyhorn
  112: { hp: 105, atk: 130, def: 120, spa: 45, spd: 45, spe: 40 }, // Rhydon
  113: { hp: 250, atk: 5, def: 5, spa: 35, spd: 105, spe: 50 }, // Chansey
  114: { hp: 65, atk: 55, def: 115, spa: 100, spd: 40, spe: 60 }, // Tangela
  115: { hp: 105, atk: 95, def: 80, spa: 40, spd: 80, spe: 90 }, // Kangaskhan
  117: { hp: 55, atk: 65, def: 95, spa: 95, spd: 45, spe: 85 }, // Seadra
  118: { hp: 45, atk: 67, def: 60, spa: 35, spd: 50, spe: 63 }, // Goldeen
  119: { hp: 80, atk: 92, def: 65, spa: 65, spd: 80, spe: 68 }, // Seaking
  120: { hp: 30, atk: 45, def: 55, spa: 70, spd: 55, spe: 85 }, // Staryu
  121: { hp: 60, atk: 75, def: 85, spa: 100, spd: 85, spe: 115 }, // Starmie
  122: { hp: 40, atk: 45, def: 65, spa: 100, spd: 120, spe: 90 }, // Mr. Mime
  123: { hp: 70, atk: 110, def: 80, spa: 55, spd: 80, spe: 105 }, // Scyther
  124: { hp: 65, atk: 50, def: 35, spa: 115, spd: 95, spe: 95 }, // Jynx
  125: { hp: 65, atk: 83, def: 57, spa: 95, spd: 85, spe: 105 }, // Electabuzz
  126: { hp: 65, atk: 95, def: 57, spa: 100, spd: 85, spe: 93 }, // Magmar
  127: { hp: 65, atk: 125, def: 100, spa: 55, spd: 70, spe: 85 }, // Pinsir
  128: { hp: 75, atk: 100, def: 95, spa: 40, spd: 70, spe: 110 }, // Tauros
  129: { hp: 20, atk: 10, def: 55, spa: 15, spd: 20, spe: 80 }, // Magikarp
  130: { hp: 95, atk: 125, def: 79, spa: 60, spd: 100, spe: 81 }, // Gyarados
  131: { hp: 130, atk: 85, def: 80, spa: 85, spd: 95, spe: 60 }, // Lapras
  132: { hp: 48, atk: 48, def: 48, spa: 48, spd: 48, spe: 48 }, // Ditto
  133: { hp: 55, atk: 55, def: 50, spa: 45, spd: 65, spe: 55 }, // Eevee
  134: { hp: 130, atk: 65, def: 60, spa: 110, spd: 95, spe: 65 }, // Vaporeon
  135: { hp: 65, atk: 65, def: 60, spa: 110, spd: 95, spe: 130 }, // Jolteon
  136: { hp: 65, atk: 130, def: 60, spa: 95, spd: 110, spe: 65 }, // Flareon
  137: { hp: 65, atk: 60, def: 70, spa: 85, spd: 75, spe: 40 }, // Porygon
  138: { hp: 35, atk: 40, def: 100, spa: 90, spd: 55, spe: 35 }, // Omanyte
  139: { hp: 70, atk: 60, def: 125, spa: 115, spd: 70, spe: 55 }, // Omastar
  140: { hp: 30, atk: 80, def: 90, spa: 55, spd: 45, spe: 55 }, // Kabuto
  141: { hp: 60, atk: 115, def: 105, spa: 65, spd: 70, spe: 80 }, // Kabutops
  142: { hp: 80, atk: 105, def: 65, spa: 60, spd: 75, spe: 130 }, // Aerodactyl
  144: { hp: 90, atk: 85, def: 100, spa: 95, spd: 125, spe: 85 }, // Articuno
  145: { hp: 90, atk: 90, def: 85, spa: 125, spd: 90, spe: 100 }, // Zapdos
  146: { hp: 90, atk: 100, def: 90, spa: 125, spd: 85, spe: 90 }, // Moltres
  147: { hp: 41, atk: 64, def: 45, spa: 50, spd: 50, spe: 50 }, // Dratini
  148: { hp: 61, atk: 84, def: 65, spa: 70, spd: 70, spe: 70 }, // Dragonair
  149: { hp: 91, atk: 134, def: 95, spa: 100, spd: 100, spe: 80 }, // Dragonite
  150: { hp: 106, atk: 110, def: 90, spa: 154, spd: 90, spe: 130 }, // Mewtwo
  151: { hp: 100, atk: 100, def: 100, spa: 100, spd: 100, spe: 100 }, // Mew
};

const SPECIES_NAMES: Record<number, string> = {
  1: 'Bulbasaur',
  2: 'Ivysaur',
  3: 'Venusaur',
  4: 'Charmander',
  5: 'Charmeleon',
  6: 'Charizard',
  7: 'Squirtle',
  8: 'Wartortle',
  9: 'Blastoise',
  10: 'Caterpie',
  11: 'Metapod',
  12: 'Butterfree',
  13: 'Weedle',
  14: 'Kakuna',
  15: 'Beedrill',
  16: 'Pidgey',
  17: 'Pidgeotto',
  18: 'Pidgeot',
  19: 'Rattata',
  20: 'Raticate',
  21: 'Spearow',
  22: 'Fearow',
  23: 'Ekans',
  24: 'Arbok',
  25: 'Pikachu',
  26: 'Raichu',
  27: 'Sandshrew',
  28: 'Sandslash',
  29: 'Nidoran-F',
  30: 'Nidorina',
  31: 'Nidoqueen',
  32: 'Nidoran-M',
  33: 'Nidorino',
  34: 'Nidoking',
  35: 'Clefairy',
  36: 'Clefable',
  37: 'Vulpix',
  38: 'Ninetales',
  39: 'Jigglypuff',
  40: 'Wigglytuff',
  41: 'Zubat',
  42: 'Golbat',
  43: 'Oddish',
  44: 'Gloom',
  45: 'Vileplume',
  46: 'Paras',
  47: 'Parasect',
  48: 'Venonat',
  49: 'Venomoth',
  50: 'Diglett',
  51: 'Dugtrio',
  52: 'Meowth',
  53: 'Persian',
  54: 'Psyduck',
  55: 'Golduck',
  56: 'Mankey',
  57: 'Primeape',
  58: 'Growlithe',
  59: 'Arcanine',
  60: 'Poliwag',
  61: 'Poliwhirl',
  62: 'Poliwrath',
  63: 'Abra',
  64: 'Kadabra',
  65: 'Alakazam',
  66: 'Machop',
  67: 'Machoke',
  68: 'Machamp',
  69: 'Bellsprout',
  70: 'Weepinbell',
  71: 'Victreebel',
  72: 'Tentacool',
  73: 'Tentacruel',
  74: 'Geodude',
  75: 'Graveler',
  76: 'Golem',
  77: 'Ponyta',
  78: 'Rapidash',
  79: 'Slowpoke',
  80: 'Slowbro',
  81: 'Magnemite',
  82: 'Magneton',
  83: "Farfetch'd",
  84: 'Doduo',
  85: 'Dodrio',
  86: 'Seel',
  87: 'Dewgong',
  88: 'Grimer',
  89: 'Muk',
  90: 'Shellder',
  91: 'Cloyster',
  92: 'Gastly',
  93: 'Haunter',
  94: 'Gengar',
  95: 'Onix',
  96: 'Drowzee',
  97: 'Hypno',
  98: 'Krabby',
  99: 'Kingler',
  100: 'Voltorb',
  101: 'Electrode',
  102: 'Exeggcute',
  103: 'Exeggutor',
  104: 'Cubone',
  105: 'Marowak',
  106: 'Hitmonlee',
  107: 'Hitmonchan',
  108: 'Lickitung',
  109: 'Koffing',
  110: 'Weezing',
  111: 'Rhyhorn',
  112: 'Rhydon',
  113: 'Chansey',
  114: 'Tangela',
  115: 'Kangaskhan',
  116: 'Horsea',
  117: 'Seadra',
  118: 'Goldeen',
  119: 'Seaking',
  120: 'Staryu',
  121: 'Starmie',
  122: 'Mr. Mime',
  123: 'Scyther',
  124: 'Jynx',
  125: 'Electabuzz',
  126: 'Magmar',
  127: 'Pinsir',
  128: 'Tauros',
  129: 'Magikarp',
  130: 'Gyarados',
  131: 'Lapras',
  132: 'Ditto',
  133: 'Eevee',
  134: 'Vaporeon',
  135: 'Jolteon',
  136: 'Flareon',
  137: 'Porygon',
  138: 'Omanyte',
  139: 'Omastar',
  140: 'Kabuto',
  141: 'Kabutops',
  142: 'Aerodactyl',
  143: 'Snorlax',
  144: 'Articuno',
  145: 'Zapdos',
  146: 'Moltres',
  147: 'Dratini',
  148: 'Dragonair',
  149: 'Dragonite',
  150: 'Mewtwo',
  151: 'Mew',
};

const G1_CHARMAP: Record<number, string> = (() => {
  const m: Record<number, string> = {};
  m[0x50] = '';
  m[0x7f] = ' ';
  for (let i = 0; i < 26; i++) m[0x80 + i] = String.fromCharCode(0x41 + i);
  for (let i = 0; i < 26; i++) m[0xa0 + i] = String.fromCharCode(0x61 + i);
  for (let i = 0; i < 10; i++) m[0xf6 + i] = String.fromCharCode(0x30 + i);
  m[0xe6] = '?';
  m[0xe7] = '!';
  m[0xe8] = '.';
  m[0xf4] = ',';
  m[0xba] = 'é';
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

function be16(b: Uint8Array, off: number): number {
  return (b[off] << 8) | b[off + 1];
}
function be24(b: Uint8Array, off: number): number {
  return (b[off] << 16) | (b[off + 1] << 8) | b[off + 2];
}

function speciesName(ndex: number): string {
  return SPECIES_NAMES[ndex] ?? `#${ndex}`;
}

function getBase(
  ndex: number,
): { hp: number; atk: number; def: number; spa: number; spd: number; spe: number } | null {
  return BASE_STATS_G2[ndex] ?? BASE_STATS_EXT[ndex] ?? null;
}
function getBaseG3(ndex: number) {
  return BASE_STATS_G3[ndex] ?? BASE_STATS_EXT[ndex] ?? BASE_STATS_G2[ndex] ?? null;
}

// ---------- Load save ----------
const SAV_PATH = join(import.meta.dir, 'demo-red.sav');
const sav = readFileSync(SAV_PATH);
console.log(`Loaded save: ${SAV_PATH} (${sav.length} bytes)`);

const playerName = decodeG1(sav.subarray(0x2598, 0x2598 + 11));
const tid = (sav[0x2605] << 8) | sav[0x2606];
console.log(`\n=== Trainer ===`);
console.log(`Name: "${playerName}" TID: ${tid}`);

// ---------- Box layout ----------
// Stored boxes 1-6 at 0x4000, 7-12 at 0x6000. ALSO the live current PC box
// is at 0x30C0 — same 1122-byte layout. The stored slot for the current box
// can be stale; the truth lives at 0x30C0 until the player switches boxes.
const BOX_SIZE = 1122;
const BOX_BANK_OFFSETS = [0x4000, 0x6000];
const CURRENT_BOX_OFFSET = 0x30c0;

interface BoxMon {
  boxIdx: number; // 1-12
  slotIdx: number; // 0-19
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
  otNameBytes: Uint8Array;
  nicknameBytes: Uint8Array;
  otName: string;
  nickname: string;
}

const allMons: BoxMon[] = [];
const boxCounts: number[] = [];

function readBoxAt(boxOff: number, boxNum: number): void {
  const count = sav[boxOff];
  if (count > 20) {
    console.log(`Box ${boxNum} @0x${boxOff.toString(16)}: invalid count=${count}, skipping`);
    boxCounts.push(0);
    return;
  }
  boxCounts.push(count);
  const monRecBase = boxOff + 0x16;
  const otBase = boxOff + 0x2aa;
  const nickBase = boxOff + 0x386;
  for (let s = 0; s < count; s++) {
    const mOff = monRecBase + s * 33;
    const speciesByte = sav[mOff];
    const ndex = INTERNAL_TO_NDEX[speciesByte] ?? 0;
    const dvWord = be16(sav, mOff + 0x1b);
    const dvs = {
      atk: (dvWord >> 12) & 0xf,
      def: (dvWord >> 8) & 0xf,
      spe: (dvWord >> 4) & 0xf,
      special: dvWord & 0xf,
    };
    const ppRaw = [sav[mOff + 0x1d], sav[mOff + 0x1e], sav[mOff + 0x1f], sav[mOff + 0x20]];
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
    const otNameBytes = sav.subarray(otBase + s * 11, otBase + (s + 1) * 11);
    const nicknameBytes = sav.subarray(nickBase + s * 11, nickBase + (s + 1) * 11);
    allMons.push({
      boxIdx: boxNum,
      slotIdx: s,
      internalSpecies: speciesByte,
      ndex,
      level: sav[mOff + 0x03],
      exp: be24(sav, mOff + 0x0e),
      currentHp: be16(sav, mOff + 0x01),
      status: sav[mOff + 0x04],
      type1: sav[mOff + 0x05],
      type2: sav[mOff + 0x06],
      catchRate: sav[mOff + 0x07],
      moves: [sav[mOff + 0x08], sav[mOff + 0x09], sav[mOff + 0x0a], sav[mOff + 0x0b]],
      otTid: be16(sav, mOff + 0x0c),
      statExp: {
        hp: be16(sav, mOff + 0x11),
        atk: be16(sav, mOff + 0x13),
        def: be16(sav, mOff + 0x15),
        spe: be16(sav, mOff + 0x17),
        special: be16(sav, mOff + 0x19),
      },
      dvs,
      pp,
      ppUps,
      otNameBytes: new Uint8Array(otNameBytes),
      nicknameBytes: new Uint8Array(nicknameBytes),
      otName: decodeG1(otNameBytes),
      nickname: decodeG1(nicknameBytes),
    });
  }
}

// Read current PC box first (it can hold the freshest data for the box the
// player was in when saving) — call it box 0 to distinguish from stored 1..12.
readBoxAt(CURRENT_BOX_OFFSET, 0);

for (let bank = 0; bank < 2; bank++) {
  for (let bIdx = 0; bIdx < 6; bIdx++) {
    const boxOff = BOX_BANK_OFFSETS[bank] + bIdx * BOX_SIZE;
    const boxNum = bank * 6 + bIdx + 1;
    readBoxAt(boxOff, boxNum);
  }
}

// ---------- Print all boxes ----------
console.log(`\n=== Boxes ===`);
let runningIndex = 0;
// boxCounts[0] = current box (box 0), [1..12] = stored boxes.
for (let b = 0; b < boxCounts.length; b++) {
  const cnt = boxCounts[b];
  const label = b === 0 ? 'Current (0x30C0)' : `Stored ${b}`;
  console.log(`\n-- Box ${label} (count=${cnt}) --`);
  for (let s = 0; s < cnt; s++) {
    const m = allMons[runningIndex++];
    const dvSum = m.dvs.atk + m.dvs.def + m.dvs.spe + m.dvs.special;
    const seTot = m.statExp.hp + m.statExp.atk + m.statExp.def + m.statExp.spe + m.statExp.special;
    const sName = speciesName(m.ndex);
    console.log(
      `  [${s + 1}] "${m.nickname}" ${sName} (ndex=${m.ndex}) Lv ${m.level} DVsum=${dvSum} StatExpTot=${seTot}`,
    );
  }
}

// ---------- Identify trained mons ----------
// This save's most-trained mon is Pidgeot Lv71 with StatExp sum 19243 — well
// below the Gen 1 "max-trained" threshold (StatExp 65535 in every stat). So
// "highly trained" here = relative to this save: top mons by StatExp sum.
const HIGH_TOTAL = 1_000;
const HIGH_SINGLE = 1_000;

interface Trained extends BoxMon {
  totalSE: number;
}
const trained: Trained[] = [];
for (const m of allMons) {
  const tot = m.statExp.hp + m.statExp.atk + m.statExp.def + m.statExp.spe + m.statExp.special;
  const maxSingle = Math.max(
    m.statExp.hp,
    m.statExp.atk,
    m.statExp.def,
    m.statExp.spe,
    m.statExp.special,
  );
  if (tot > HIGH_TOTAL || maxSingle >= HIGH_SINGLE) {
    trained.push({ ...m, totalSE: tot });
  }
}

console.log(`\n=== Highly-trained mons (${trained.length}) ===`);
for (const m of trained) {
  console.log(
    `  Box ${m.boxIdx} slot ${m.slotIdx + 1}: ${m.nickname} (${speciesName(m.ndex)}, Lv ${m.level}) StatExpTot=${m.totalSE} max=${Math.max(m.statExp.hp, m.statExp.atk, m.statExp.def, m.statExp.spe, m.statExp.special)}`,
  );
}

// ---------- Convert and compare ----------
const refusals: { ref: string; reason: string; message: string }[] = [];
const totals: number[] = [];

for (const m of trained) {
  const tag = `Box ${m.boxIdx}/slot ${m.slotIdx + 1} ${m.nickname} (${speciesName(m.ndex)}, Lv ${m.level})`;
  console.log(`\n--- ${tag} ---`);
  console.log(
    `  internal=0x${m.internalSpecies.toString(16)} ndex=${m.ndex} OT="${m.otName}" OT_TID=${m.otTid} EXP=${m.exp}`,
  );
  console.log(`  DVs: Atk=${m.dvs.atk} Def=${m.dvs.def} Spe=${m.dvs.spe} Spc=${m.dvs.special}`);
  console.log(
    `  StatExp: HP=${m.statExp.hp} Atk=${m.statExp.atk} Def=${m.statExp.def} Spe=${m.statExp.spe} Spc=${m.statExp.special}`,
  );

  if (!m.ndex) {
    console.log(`  [SKIP] Unknown internal species 0x${m.internalSpecies.toString(16)}`);
    refusals.push({
      ref: tag,
      reason: 'unknown_species',
      message: `internal 0x${m.internalSpecies.toString(16)}`,
    });
    continue;
  }
  const baseG2 = getBase(m.ndex);
  if (!baseG2) {
    console.log(`  [SKIP] No base stats for ndex ${m.ndex}`);
    refusals.push({ ref: tag, reason: 'no_base_stats', message: `ndex ${m.ndex}` });
    continue;
  }

  const sourceStats = gen2Stats(baseG2, m.dvs, m.statExp, m.level);
  console.log(
    `  Computed Gen 2 stats: HP=${sourceStats.hp} Atk=${sourceStats.atk} Def=${sourceStats.def} SpA=${sourceStats.spa} SpD=${sourceStats.spd} Spe=${sourceStats.spe}`,
  );

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
    refusals.push({ ref: tag, reason: 'exception', message: (err as Error).message });
    continue;
  }

  if (isRefusal(result)) {
    console.log(`  [REFUSED] ${result.reason}: ${result.message}`);
    refusals.push({ ref: tag, reason: result.reason, message: result.message });
    continue;
  }

  const r = result;
  console.log(
    `  IVs: HP=${r.ivs.hp} Atk=${r.ivs.atk} Def=${r.ivs.def} SpA=${r.ivs.spa} SpD=${r.ivs.spd} Spe=${r.ivs.spe}`,
  );
  console.log(
    `  EVs: HP=${r.evs.hp} Atk=${r.evs.atk} Def=${r.evs.def} SpA=${r.evs.spa} SpD=${r.evs.spd} Spe=${r.evs.spe}`,
  );
  console.log(`  Nature=${r.nature} PID=0x${r.pid.toString(16).padStart(8, '0')} SID=${r.sid}`);

  const baseG3 = getBaseG3(m.ndex)!;
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
  console.log(`  Per-stat src/conv/Δ:`);
  console.log(`    HP : ${sourceStats.hp}/${targetStats.hp}/${dHp >= 0 ? '+' : ''}${dHp}`);
  console.log(`    Atk: ${sourceStats.atk}/${targetStats.atk}/${dAtk >= 0 ? '+' : ''}${dAtk}`);
  console.log(`    Def: ${sourceStats.def}/${targetStats.def}/${dDef >= 0 ? '+' : ''}${dDef}`);
  console.log(`    SpA: ${sourceStats.spa}/${targetStats.spa}/${dSpA >= 0 ? '+' : ''}${dSpA}`);
  console.log(`    SpD: ${sourceStats.spd}/${targetStats.spd}/${dSpD >= 0 ? '+' : ''}${dSpD}`);
  console.log(`    Spe: ${sourceStats.spe}/${targetStats.spe}/${dSpe >= 0 ? '+' : ''}${dSpe}`);
  console.log(`  Total |dev|: ${tot}`);
  totals.push(tot);
}

// ---------- Summary ----------
const totalBoxed = allMons.length;
console.log(`\n=== Summary ===`);
console.log(`Trainer: "${playerName}" TID=${tid}`);
console.log(`Total boxed mons: ${totalBoxed}`);
console.log(`Per-box counts: ${boxCounts.map((c, i) => `${i + 1}=${c}`).join(' ')}`);
console.log(`Highly-trained mons: ${trained.length}`);
console.log(`Refusals: ${refusals.length}`);
if (refusals.length > 0) {
  for (const r of refusals) console.log(`  - ${r.ref}: ${r.reason} — ${r.message}`);
}
if (totals.length > 0) {
  const sum = totals.reduce((a, b) => a + b, 0);
  const avg = sum / totals.length;
  console.log(
    `Converted ${totals.length} trained mon(s). Total |dev| sum=${sum}, avg=${avg.toFixed(2)}`,
  );
} else {
  console.log(`No trained mons converted.`);
}
