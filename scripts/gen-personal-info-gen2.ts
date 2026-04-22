/**
 * gen-personal-info-gen2.ts
 *
 * Regenerates `core/src/data/raw/personal-gen2.json` from PKHeX's
 * canonical `personal_c` binary (Pokemon Crystal personal table).
 *
 * Source: kwsch/PKHeX master branch,
 *   https://raw.githubusercontent.com/kwsch/PKHeX/master/PKHeX.Core/Resources/byte/personal/personal_c
 *
 * Layout (verified from PKHeX.Core/PersonalInfo/Info/PersonalInfo2.cs):
 *   SIZE = 0x20 (32 bytes per entry)
 *   Entry 0 is padding; species entries are 1..251 by national dex id.
 *   offset 0x00: dex id (sanity check)
 *   offset 0x01: base HP
 *   offset 0x02: base Attack
 *   offset 0x03: base Defense
 *   offset 0x04: base Speed (Gen 1/2 wire order has Speed BEFORE Special)
 *   offset 0x05: base Special Attack
 *   offset 0x06: base Special Defense
 *
 * Per PLAN_EVAL A1 + A11: the Gen 1/2 source model carries a single
 * `special` DV / StatExp (`Gen12DVs.special`, `Gen12StatExp.special`)
 * because the in-game DVs and EVs ARE shared in Gen 1 / Gen 2. The
 * **base stats** however are split in Gen 2 (Crystal's PersonalInfo2
 * stores SpA at 0x05 and SpD at 0x06 as distinct bytes — Gen 2
 * introduced the internal split, while keeping shared DVs for backwards
 * compat with Red/Blue stat formulas). For Gen 1 sources both bytes
 * collapse to the same value — that's how Gen 1's Special stat is
 * recovered. We ship both columns so the stat formulas can compute
 * SpA-stat (using base.spa) and SpD-stat (using base.spd) against the
 * shared `special` DV / StatExp.
 *
 * Usage: `bun run scripts/gen-personal-info-gen2.ts`
 */

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const SRC_URL =
  'https://raw.githubusercontent.com/kwsch/PKHeX/master/PKHeX.Core/Resources/byte/personal/personal_c';

const ENTRY_SIZE = 0x20; // 32 bytes per entry
const OFFSET_DEX = 0x00;
const OFFSET_HP = 0x01;
const OFFSET_ATK = 0x02;
const OFFSET_DEF = 0x03;
const OFFSET_SPE = 0x04;
const OFFSET_SPA = 0x05; // PKHeX-split SpA; on cart this is the single Special.
const OFFSET_SPD = 0x06; // PKHeX-split SpD; equals SpA on the Gen 2 cart.

const MAX_GEN2_DEX = 251;

interface PersonalGen2Row {
  ndex: number;
  base: {
    hp: number;
    atk: number;
    def: number;
    spe: number;
    spa: number;
    spd: number;
  };
  /**
   * Gen 1 single Special (1..151 only). On the Gen 1 cart, Special was
   * one shared base-stat byte; the Gen 2 split sometimes rebalanced
   * (e.g. Charizard 85 → SpA 109 / SpD 85). When the source is a Gen 1
   * mon, the comparison view's Gen 1/2 pane uses `gen1Special` for both
   * SpA and SpD; for Gen 2 mons we use the split base.spa / base.spd.
   *
   * Source: smogon/pokemon-showdown's `data/mods/gen1/pokedex.ts`
   * baseStats.spa (== spd) — Showdown carries historically-correct Gen 1
   * stats verbatim. Confirmed against Bulbapedia spot-checks.
   */
  gen1Special?: number;
}

async function fetchGen1SpecialMap(): Promise<ReadonlyMap<string, number>> {
  // Showdown's gen1 pokedex.ts is human-readable TS. Extract baseStats.spa
  // per species name. Format: `\tname: { ... baseStats: { hp:.., atk:.., def:.., spa:N, spd:N, spe:.. }, ... }`.
  const url =
    'https://raw.githubusercontent.com/smogon/pokemon-showdown/master/data/mods/gen1/pokedex.ts';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch gen1 pokedex.ts: HTTP ${res.status}`);
  const text = await res.text();
  const map = new Map<string, number>();
  // Two-pass: split on top-level species block headers (`\tword: {`), then
  // pull baseStats out of each block. The previous one-shot regex
  // accidentally re-matched fields across consecutive blocks.
  const headerRe = /^\t([a-z][a-z0-9-]*):\s*\{$/gm;
  const headers: { name: string; idx: number }[] = [];
  for (const m of text.matchAll(headerRe)) {
    headers.push({ name: m[1]!, idx: m.index! });
  }
  for (let i = 0; i < headers.length; i++) {
    const start = headers[i]!.idx;
    const end = i + 1 < headers.length ? headers[i + 1]!.idx : text.length;
    const block = text.slice(start, end);
    const bs =
      /baseStats:\s*\{\s*hp:\s*(\d+),\s*atk:\s*(\d+),\s*def:\s*(\d+),\s*spa:\s*(\d+),\s*spd:\s*(\d+),\s*spe:\s*(\d+)\s*\}/.exec(
        block,
      );
    if (!bs) continue;
    const name = headers[i]!.name;
    if (name === 'missingno') continue;
    const spa = Number(bs[4]);
    const spd = Number(bs[5]);
    if (spa !== spd) {
      throw new Error(`gen1 pokedex: ${name} has spa(${spa}) != spd(${spd}); not single-Special`);
    }
    map.set(name, spa);
  }
  return map;
}

function showdownNameForNdex(ndex: number, name: string): string {
  // Map species.json names to Showdown id format: lowercase, strip
  // non-alphanumeric, with hand-mapped Gen 2/Gen 3 specials.
  void ndex;
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function main(): Promise<void> {
  const res = await fetch(SRC_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch personal_c: HTTP ${res.status} ${res.statusText}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());

  // Load Gen 1 single-Special table.
  const gen1Special = await fetchGen1SpecialMap();
  // Load species name list (already in repo) so we can join Showdown's
  // ids to ndex.
  const speciesPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'core',
    'src',
    'data',
    'raw',
    'species.json',
  );
  const speciesText = await import('node:fs/promises').then((m) => m.readFile(speciesPath, 'utf8'));
  const species: { gen2Id: number; gen3DexId: number; name: string }[] = JSON.parse(speciesText);
  const nameByNdex = new Map<number, string>();
  for (const s of species) nameByNdex.set(s.gen2Id, s.name);
  if (buf.length % ENTRY_SIZE !== 0) {
    throw new Error(
      `Unexpected personal_c size: ${buf.length} bytes (not a multiple of ${ENTRY_SIZE})`,
    );
  }
  const entryCount = buf.length / ENTRY_SIZE;
  if (entryCount <= MAX_GEN2_DEX) {
    throw new Error(`personal_c has only ${entryCount} entries, need at least ${MAX_GEN2_DEX + 1}`);
  }

  const rows: PersonalGen2Row[] = [];
  for (let dex = 1; dex <= MAX_GEN2_DEX; dex++) {
    const base = dex * ENTRY_SIZE;
    const dexByte = buf[base + OFFSET_DEX]!;
    if (dexByte !== dex && dexByte !== 0) {
      throw new Error(`personal_c entry ${dex}: dex byte mismatch (got ${dexByte})`);
    }
    const row: PersonalGen2Row = {
      ndex: dex,
      base: {
        hp: buf[base + OFFSET_HP]!,
        atk: buf[base + OFFSET_ATK]!,
        def: buf[base + OFFSET_DEF]!,
        spe: buf[base + OFFSET_SPE]!,
        spa: buf[base + OFFSET_SPA]!,
        spd: buf[base + OFFSET_SPD]!,
      },
    };
    if (dex <= 151) {
      const sName = nameByNdex.get(dex);
      const id = sName ? showdownNameForNdex(dex, sName) : null;
      const sp = id ? gen1Special.get(id) : undefined;
      if (sp === undefined) {
        // Some special-cased names: nidoranf/nidoranm, mr-mime/mrmime, etc.
        const fallbacks: Record<string, string> = {
          nidoranf: 'nidoranf',
          nidoranm: 'nidoranm',
          mrmime: 'mrmime',
          farfetchd: 'farfetchd',
          // Showdown uses these exact ids; our species.json names normalise to them.
        };
        const alt = id && fallbacks[id] ? gen1Special.get(fallbacks[id]) : undefined;
        if (alt === undefined) {
          throw new Error(`Gen 1 Special missing for ndex ${dex} (${sName}, id=${id})`);
        }
        row.gen1Special = alt;
      } else {
        row.gen1Special = sp;
      }
    }
    rows.push(row);
  }

  // Sanity spot-checks (pret/pokecrystal data/pokemon/base_stats/*.asm, hp/atk/def/spe/spa/spd):
  //  Charizard #6:  78/84/78/100/109/85   (Gen 2 ROM split single Special into 109/85)
  //  Snorlax  #143: 160/110/65/30/65/110  (per pret/pokecrystal)
  //  Pikachu  #25:  35/55/30/90/50/40
  //  Mew      #151: 100/100/100/100/100/100
  const expected: ReadonlyArray<
    readonly [number, [number, number, number, number, number, number]]
  > = [
    [6, [78, 84, 78, 100, 109, 85]],
    [25, [35, 55, 30, 90, 50, 40]],
    [151, [100, 100, 100, 100, 100, 100]],
  ];
  for (const [ndex, [hp, atk, def, spe, spa, spd]] of expected) {
    const r = rows.find((x) => x.ndex === ndex)!;
    const got = [r.base.hp, r.base.atk, r.base.def, r.base.spe, r.base.spa, r.base.spd];
    const want = [hp, atk, def, spe, spa, spd];
    if (got.join(',') !== want.join(',')) {
      throw new Error(`ndex ${ndex} base mismatch: got ${got.join(',')} want ${want.join(',')}`);
    }
  }
  // Gen 1 Special spot-checks (Showdown gen1 baseStats.spa):
  //   Charizard #6:  85
  //   Pikachu  #25:  50
  //   Mew      #151: 100
  const gen1Expected: ReadonlyArray<readonly [number, number]> = [
    [6, 85],
    [25, 50],
    [151, 100],
  ];
  for (const [ndex, want] of gen1Expected) {
    const r = rows.find((x) => x.ndex === ndex)!;
    if (r.gen1Special !== want) {
      throw new Error(`ndex ${ndex} gen1Special mismatch: got ${r.gen1Special} want ${want}`);
    }
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = resolve(here, '..', 'core', 'src', 'data', 'raw', 'personal-gen2.json');

  const json = JSON.stringify(rows, null, 2) + '\n';
  await writeFile(outPath, json, 'utf8');
  console.log(`Wrote ${rows.length} entries to ${outPath}`);
}

await main();
