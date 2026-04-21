/**
 * gen-pkhex-vector.ts
 *
 * Independent reference packer (PLAN_EVAL A4 / A8 "Oracle B"). Writes
 * `tests/fixtures/pkhex/oracle-vectors.json`, a list of {label, src,
 * boxedHex} objects produced by re-implementing the Gen 3 wire format
 * directly from PLAN/Bulbapedia spec — WITHOUT importing any
 * production code from `core/src/pack/`.
 *
 * The test `gen3-pkhex-vector.test.ts` asserts byte-equality between
 * the production `packBoxed` output and these committed hex strings.
 * If a divergence appears, EITHER the production packer or this script
 * has a bug — the test failure will indicate which fixture diverged
 * and at which byte offset.
 *
 * Usage: `bun run scripts/gen-pkhex-vector.ts`
 */

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { convert, isRefusal } from '../core/src/index.js';
import type { Gen3Intermediate } from '../core/src/types/target.js';
import { pikachuUntrainedLv25 } from '../tests/fixtures/pikachu-untrained-lv25.js';
import { feraligatrUntrainedLv55 } from '../tests/fixtures/feraligatr-untrained-lv55.js';
import { snorlaxMaxTrained } from '../tests/fixtures/snorlax-maxtrained.js';
import { alakazamCompetitive } from '../tests/fixtures/alakazam-competitive.js';
import { partialTrained } from '../tests/fixtures/partial-trained.js';

// ─── Independent LE helpers (NOT imported from production) ───
function w16(buf: Uint8Array, off: number, v: number): void {
  buf[off] = v & 0xff;
  buf[off + 1] = (v >>> 8) & 0xff;
}
function w32(buf: Uint8Array, off: number, v: number): void {
  const u = v >>> 0;
  buf[off] = u & 0xff;
  buf[off + 1] = (u >>> 8) & 0xff;
  buf[off + 2] = (u >>> 16) & 0xff;
  buf[off + 3] = (u >>> 24) & 0xff;
}
function r16(buf: Uint8Array, off: number): number {
  return buf[off]! | (buf[off + 1]! << 8);
}
function r32(buf: Uint8Array, off: number): number {
  return (buf[off]! | (buf[off + 1]! << 8) | (buf[off + 2]! << 16) | (buf[off + 3]! << 24)) >>> 0;
}

// ─── Substructure encoders (independent) ───
function encodeG(it: Gen3Intermediate): Uint8Array {
  const b = new Uint8Array(12);
  w16(b, 0, it.species);
  w16(b, 2, it.heldItem);
  w32(b, 4, it.exp);
  b[8] =
    ((it.ppUps[0] & 3) << 0) |
    ((it.ppUps[1] & 3) << 2) |
    ((it.ppUps[2] & 3) << 4) |
    ((it.ppUps[3] & 3) << 6);
  b[9] = it.friendship & 0xff;
  // off 10..11 padding zero
  return b;
}
function encodeA(it: Gen3Intermediate): Uint8Array {
  const b = new Uint8Array(12);
  w16(b, 0, it.moves[0]);
  w16(b, 2, it.moves[1]);
  w16(b, 4, it.moves[2]);
  w16(b, 6, it.moves[3]);
  b[8] = it.pp[0] & 0x3f;
  b[9] = it.pp[1] & 0x3f;
  b[10] = it.pp[2] & 0x3f;
  b[11] = it.pp[3] & 0x3f;
  return b;
}
function encodeE(it: Gen3Intermediate): Uint8Array {
  const b = new Uint8Array(12);
  // EV stored order: HP, Atk, Def, Spe, SpA, SpD
  b[0] = it.evs.hp & 0xff;
  b[1] = it.evs.atk & 0xff;
  b[2] = it.evs.def & 0xff;
  b[3] = it.evs.spe & 0xff;
  b[4] = it.evs.spa & 0xff;
  b[5] = it.evs.spd & 0xff;
  // contest 0..5 → cool/beauty/cute/clever/tough/sheen
  b[6] = it.contestStats.cool;
  b[7] = it.contestStats.beauty;
  b[8] = it.contestStats.cute;
  b[9] = it.contestStats.clever;
  b[10] = it.contestStats.tough;
  b[11] = it.contestStats.sheen;
  return b;
}
function encodeM(it: Gen3Intermediate): Uint8Array {
  const b = new Uint8Array(12);
  b[0] = it.pokerus & 0xff;
  b[1] = it.metLocation & 0xff;
  // originsInfo: metLevel[0..6] | originGame[7..10] | ball[11..14] | otGender[15]
  const origin = 4; // FRLG
  const ball = 4; // Pokeball
  const originsInfo =
    (it.metLevel & 0x7f) | ((origin & 0xf) << 7) | ((ball & 0xf) << 11) | ((it.otGender & 1) << 15);
  w16(b, 2, originsInfo);
  // ivsEggAbility: HP[0..4] Atk[5..9] Def[10..14] Spe[15..19] SpA[20..24] SpD[25..29] isEgg[30] abilityBit[31]
  const ivWord =
    ((it.ivs.hp & 0x1f) << 0) |
    ((it.ivs.atk & 0x1f) << 5) |
    ((it.ivs.def & 0x1f) << 10) |
    ((it.ivs.spe & 0x1f) << 15) |
    ((it.ivs.spa & 0x1f) << 20) |
    ((it.ivs.spd & 0x1f) << 25) |
    ((it.isEgg ? 1 : 0) << 30) |
    ((it.abilitySlot & 1) << 31);
  w32(b, 4, ivWord >>> 0);
  // ribbons/obedience word: all zero
  w32(b, 8, 0);
  return b;
}

// ─── Independent shuffle table (re-derived in lex order; same as production) ───
const ORDER: ReadonlyArray<
  readonly [
    'G' | 'A' | 'E' | 'M',
    'G' | 'A' | 'E' | 'M',
    'G' | 'A' | 'E' | 'M',
    'G' | 'A' | 'E' | 'M',
  ]
> = [
  ['G', 'A', 'E', 'M'],
  ['G', 'A', 'M', 'E'],
  ['G', 'E', 'A', 'M'],
  ['G', 'E', 'M', 'A'],
  ['G', 'M', 'A', 'E'],
  ['G', 'M', 'E', 'A'],
  ['A', 'G', 'E', 'M'],
  ['A', 'G', 'M', 'E'],
  ['A', 'E', 'G', 'M'],
  ['A', 'E', 'M', 'G'],
  ['A', 'M', 'G', 'E'],
  ['A', 'M', 'E', 'G'],
  ['E', 'G', 'A', 'M'],
  ['E', 'G', 'M', 'A'],
  ['E', 'A', 'G', 'M'],
  ['E', 'A', 'M', 'G'],
  ['E', 'M', 'G', 'A'],
  ['E', 'M', 'A', 'G'],
  ['M', 'G', 'A', 'E'],
  ['M', 'G', 'E', 'A'],
  ['M', 'A', 'G', 'E'],
  ['M', 'A', 'E', 'G'],
  ['M', 'E', 'G', 'A'],
  ['M', 'E', 'A', 'G'],
];

function shuffle(
  g: Uint8Array,
  a: Uint8Array,
  e: Uint8Array,
  m: Uint8Array,
  pid: number,
): Uint8Array {
  const wire = new Uint8Array(48);
  const subs = { G: g, A: a, E: e, M: m };
  const ord = ORDER[(pid >>> 0) % 24]!;
  for (let s = 0; s < 4; s++) wire.set(subs[ord[s]!], s * 12);
  return wire;
}

function checksum48(plain: Uint8Array): number {
  let sum = 0;
  for (let off = 0; off < 48; off += 2) sum += r16(plain, off);
  return sum & 0xffff;
}

function xorEncrypt(block: Uint8Array, key: number): Uint8Array {
  const out = new Uint8Array(block);
  const k = key >>> 0;
  for (let off = 0; off < 48; off += 4) {
    const word = r32(out, off);
    w32(out, off, (word ^ k) >>> 0);
  }
  return out;
}

function padName(src: Uint8Array, fieldLen: number): Uint8Array {
  const out = new Uint8Array(fieldLen).fill(0xff);
  const copyLen = Math.min(src.length, fieldLen);
  out.set(src.subarray(0, copyLen), 0);
  return out;
}

function packBoxedOracle(it: Gen3Intermediate): Uint8Array {
  const g = encodeG(it);
  const a = encodeA(it);
  const e = encodeE(it);
  const m = encodeM(it);
  const wire = shuffle(g, a, e, m, it.pid);
  const cks = checksum48(wire);
  const otFull = (((it.sid & 0xffff) << 16) | (it.tid & 0xffff)) >>> 0;
  const key = (it.pid ^ otFull) >>> 0;
  const enc = xorEncrypt(wire, key);

  const out = new Uint8Array(80);
  w32(out, 0, it.pid);
  w16(out, 4, it.tid);
  w16(out, 6, it.sid);
  out.set(padName(it.nickname, 10), 8);
  out[18] = it.language & 0xff;
  out[19] = 0x02; // misc flags: has-species
  out.set(padName(it.otName, 7), 20);
  out[27] = 0; // markings
  w16(out, 28, cks);
  w16(out, 30, 0); // sanity
  out.set(enc, 32);
  return out;
}

function toHex(buf: Uint8Array): string {
  let s = '';
  for (const b of buf) s += b.toString(16).padStart(2, '0');
  return s;
}

const FIXTURES = [
  ['pikachu-untrained-lv25', pikachuUntrainedLv25],
  ['feraligatr-untrained-lv55', feraligatrUntrainedLv55],
  ['snorlax-maxtrained', snorlaxMaxTrained],
  ['alakazam-competitive', alakazamCompetitive],
  ['partial-trained', partialTrained],
] as const;

async function main(): Promise<void> {
  const out: {
    label: string;
    pid: string;
    tid: number;
    sid: number;
    species: number;
    boxedHex: string;
  }[] = [];
  for (const [label, src] of FIXTURES) {
    const it = convert(src);
    if (isRefusal(it)) {
      throw new Error(`${label}: unexpected refusal`);
    }
    const packed = packBoxedOracle(it);
    out.push({
      label,
      pid: '0x' + (it.pid >>> 0).toString(16).padStart(8, '0'),
      tid: it.tid,
      sid: it.sid,
      species: it.species,
      boxedHex: toHex(packed),
    });
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = resolve(here, '..', 'tests', 'fixtures', 'pkhex', 'oracle-vectors.json');
  await writeFile(outPath, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${out.length} oracle vectors to ${outPath}`);
}

await main();
