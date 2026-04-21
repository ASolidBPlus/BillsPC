import { sha256 } from '../primitives/sha256.js';
import type { IVs } from './ivs.js';
import { gen3Gender, gen3ShinyCheck } from './shinyGender.js';
import { isWildMethodSpread } from './pidMethods.js';
import { UNOWN_SPECIES_GEN2_ID, unownLetterFromPid } from './unown.js';

export interface PIDSearchInputs {
  readonly seed: Uint8Array; // domain-separated ('pid')
  readonly nature: number; // 0..24
  readonly targetGender: 0 | 1 | 2;
  readonly genderRatioByte: number;
  readonly isShiny: boolean;
  readonly tid: number;
  readonly sid: number;
  readonly ivs: IVs;
  readonly isUnown: boolean;
  readonly unownLetter: number | null;
  readonly warnThreshold: number;
  readonly hardCap: number;
}

export interface PIDSearchResult {
  readonly pid: number;
  readonly iterations: number;
  readonly warnings: readonly string[];
}

/**
 * §4.6 PID search. Iterates k = 0, 1, 2, ...; hashes (seed || u32le(k)) with
 * SHA-256, reads the first 4 bytes as a little-endian u32 PID, and tests:
 *
 *   1. pid % 25 === nature
 *   2. gender(pid, ratio) matches target (genderless species accept any)
 *   3. shinyCheck === isShiny
 *   4. NOT a Method 1/2/4/H1/H2/H4 wild spread (per IVs)
 *   5. Unown: unownLetter(pid) === source letter
 *
 * Returns on first match. `warnings` carries a message if we crossed the
 * warn threshold before finding one. Throws on hardCap overflow.
 */
export function searchPID(inputs: PIDSearchInputs): PIDSearchResult {
  const warnings: string[] = [];
  let warnedAtThreshold = false;

  for (let k = 0; k < inputs.hardCap; k++) {
    if (!warnedAtThreshold && k === inputs.warnThreshold) {
      warnings.push(
        `PID search exceeded ${inputs.warnThreshold} iterations; constraint stack may be over-tight.`,
      );
      warnedAtThreshold = true;
    }

    const pid = pidFromSeed(inputs.seed, k);

    // 1. Nature.
    if (pid % 25 !== inputs.nature) continue;

    // 2. Gender.
    if (inputs.targetGender !== 2) {
      const g = gen3Gender(pid, inputs.genderRatioByte);
      if (g !== inputs.targetGender) continue;
    }

    // 3. Shininess.
    const shiny = gen3ShinyCheck(inputs.tid, inputs.sid, pid);
    if (shiny !== inputs.isShiny) continue;

    // 4. Wild-spread avoidance.
    if (isWildMethodSpread(pid, inputs.ivs)) continue;

    // 5. Unown.
    if (inputs.isUnown && inputs.unownLetter !== null) {
      if (unownLetterFromPid(pid) !== inputs.unownLetter) continue;
    }

    return { pid, iterations: k + 1, warnings };
  }

  throw new Error(
    `PID search exceeded hard cap of ${inputs.hardCap} iterations without finding a valid candidate.`,
  );
}

function pidFromSeed(seed: Uint8Array, k: number): number {
  const buf = new Uint8Array(seed.length + 4);
  buf.set(seed, 0);
  buf[seed.length] = k & 0xff;
  buf[seed.length + 1] = (k >>> 8) & 0xff;
  buf[seed.length + 2] = (k >>> 16) & 0xff;
  buf[seed.length + 3] = (k >>> 24) & 0xff;
  const h = sha256(buf);
  // Little-endian read of first 4 bytes.
  return (h[0]! | (h[1]! << 8) | (h[2]! << 16) | (h[3]! << 24)) >>> 0;
}

export const _testing = { pidFromSeed };

/** Re-export for test access. */
export { UNOWN_SPECIES_GEN2_ID };
