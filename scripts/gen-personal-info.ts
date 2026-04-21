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

const MAX_GEN12_DEX = 251;

interface PersonalInfoRow {
  gen3DexId: number;
  genderRatio: number;
  baseFriendship: number;
  ability0: number;
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
  if (entryCount <= MAX_GEN12_DEX) {
    throw new Error(
      `personal_rs has only ${entryCount} entries, need at least ${MAX_GEN12_DEX + 1}`,
    );
  }

  const rows: PersonalInfoRow[] = [];
  for (let dex = 1; dex <= MAX_GEN12_DEX; dex++) {
    const base = dex * ENTRY_SIZE;
    rows.push({
      gen3DexId: dex,
      genderRatio: buf[base + OFFSET_GENDER]!,
      baseFriendship: buf[base + OFFSET_FRIENDSHIP]!,
      ability0: buf[base + OFFSET_ABILITY1]!,
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
