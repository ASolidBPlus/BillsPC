/**
 * gen-personal-info.ts
 *
 * Regenerates `core/src/data/raw/personal-gen3.json` from PKHeX's canonical
 * binary table `personal_rs`. The hand-transcribed JSON that lived here before
 * had a 4.8% error rate (36 mismatches across 753 values — see EVAL.md AMEND-5),
 * which is why this script exists. Keep it committed so the table is
 * reproducible from a PKHeX upstream pin.
 *
 * Source: kwsch/PKHeX master branch,
 *   https://raw.githubusercontent.com/kwsch/PKHeX/master/PKHeX.Core/Resources/byte/personal/personal_rs
 * Layout (verified from PKHeX.Core/PersonalInfo/Info/PersonalInfo3.cs):
 *   SIZE = 0x1C (28 bytes per entry)
 *   Entry 0 is padding; species entries are 1..386 by Gen-3 national dex id.
 *   offset 0x10 (16): Gender (ratio byte; 0 = male-only, 254 = female-only,
 *                     255 = genderless, else female threshold)
 *   offset 0x12 (18): BaseFriendship
 *   offset 0x16 (22): Ability1 (the primary/slot-0 ability; HANDOFF §4.14 pins
 *                     slot 0 because Gen 3 had no Hidden Abilities.)
 *
 * NOTE: the fix-loop brief tentatively cited `ability0 at offset +0x14`, but
 * PKHeX's layout has EggGroup1 at 0x14 and Ability1 at 0x16. Following PKHeX.
 *
 * Usage: `bun run scripts/gen-personal-info.ts`
 */

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const SRC_URL =
  'https://raw.githubusercontent.com/kwsch/PKHeX/master/PKHeX.Core/Resources/byte/personal/personal_rs';

const ENTRY_SIZE = 0x1c; // 28 bytes, matches PersonalInfo3.SIZE
const OFFSET_GENDER = 0x10;
const OFFSET_FRIENDSHIP = 0x12;
const OFFSET_ABILITY1 = 0x16;

// Base-stat offsets (PersonalInfo3 / personal_rs — canonical Gen 3 order):
//   0x00 HP, 0x01 Atk, 0x02 Def, 0x03 Spe (speed BEFORE specials), 0x04 SpA, 0x05 SpD.
const OFFSET_BASE_HP = 0x00;
const OFFSET_BASE_ATK = 0x01;
const OFFSET_BASE_DEF = 0x02;
const OFFSET_BASE_SPE = 0x03;
const OFFSET_BASE_SPA = 0x04;
const OFFSET_BASE_SPD = 0x05;

// S2 needs base stats for all species the packer can encounter. S1 only produced
// Gen 1/2 species (dex 1..251), but S2's unpackBoxed may decode a Gen-3-only
// species from a real cart — extend to the full Gen 3 national dex (1..386).
const MAX_GEN3_DEX = 386;

interface PersonalInfoRow {
  gen3DexId: number;
  genderRatio: number;
  baseFriendship: number;
  ability0: number;
  base: {
    hp: number;
    atk: number;
    def: number;
    spa: number;
    spd: number;
    spe: number;
  };
}

async function main(): Promise<void> {
  const res = await fetch(SRC_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch personal_rs: HTTP ${res.status} ${res.statusText}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length % ENTRY_SIZE !== 0) {
    throw new Error(
      `Unexpected personal_rs size: ${buf.length} bytes (not a multiple of ${ENTRY_SIZE})`,
    );
  }
  const entryCount = buf.length / ENTRY_SIZE;
  if (entryCount <= MAX_GEN3_DEX) {
    throw new Error(
      `personal_rs has only ${entryCount} entries, need at least ${MAX_GEN3_DEX + 1}`,
    );
  }

  const rows: PersonalInfoRow[] = [];
  for (let dex = 1; dex <= MAX_GEN3_DEX; dex++) {
    const base = dex * ENTRY_SIZE;
    rows.push({
      gen3DexId: dex,
      genderRatio: buf[base + OFFSET_GENDER]!,
      baseFriendship: buf[base + OFFSET_FRIENDSHIP]!,
      ability0: buf[base + OFFSET_ABILITY1]!,
      base: {
        hp: buf[base + OFFSET_BASE_HP]!,
        atk: buf[base + OFFSET_BASE_ATK]!,
        def: buf[base + OFFSET_BASE_DEF]!,
        spa: buf[base + OFFSET_BASE_SPA]!,
        spd: buf[base + OFFSET_BASE_SPD]!,
        spe: buf[base + OFFSET_BASE_SPE]!,
      },
    });
  }

  // Sanity checks: every distinct gender ratio we expect must appear at least once.
  const genderBytes = new Set(rows.map((r) => r.genderRatio));
  const expected = [0, 31, 127, 254, 255];
  for (const g of expected) {
    if (!genderBytes.has(g)) {
      throw new Error(`Parse looks wrong: no species has gender byte ${g}`);
    }
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = resolve(here, '..', 'core', 'src', 'data', 'raw', 'personal-gen3.json');

  // Match the existing hand-formatted style (2-space indent, trailing newline).
  const json = JSON.stringify(rows, null, 2) + '\n';
  await writeFile(outPath, json, 'utf8');

  const ratios: Record<string, number> = {};
  for (const r of rows) {
    const k = String(r.genderRatio);
    ratios[k] = (ratios[k] ?? 0) + 1;
  }
  console.log(`Wrote ${rows.length} entries to ${outPath}`);
  console.log(`Distinct gender ratios: ${[...genderBytes].sort((a, b) => a - b).join(', ')}`);
  console.log('Gender ratio counts:', ratios);
}

await main();
