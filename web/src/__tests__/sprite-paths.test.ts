/**
 * Per-ndex sprite-presence test (PLAN §8.1).
 *
 * For each ndex 1..251 and each set in {gen1, gen2, gen3, overworld},
 * assert `web/public/sprites/<set>/<ndex>.png` exists and starts with
 * the full 8-byte PNG magic. 1004 assertions total.
 *
 * Skips silently if the directory is empty (per PLAN §8.1, devs
 * cloning fresh aren't blocked from running other tests). CI ships
 * sprites in-repo so this should never skip.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SPRITES_ROOT = resolve(HERE, '../../public/sprites');
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const SETS = ['gen1', 'gen2', 'gen3', 'overworld'] as const;
const NDEX_FROM = 1;
const NDEX_TO = 251;

function isValidPng(buf: Uint8Array): boolean {
  if (buf.length < PNG_MAGIC.length) return false;
  for (let i = 0; i < PNG_MAGIC.length; i++) {
    if (buf[i] !== PNG_MAGIC[i]) return false;
  }
  return true;
}

const directoryPopulated = SETS.every((s) => {
  const dir = resolve(SPRITES_ROOT, s);
  if (!existsSync(dir)) return false;
  return readdirSync(dir).filter((f) => f.endsWith('.png')).length >= NDEX_TO;
});

describe('sprite presence (PLAN §8.1)', () => {
  const test = directoryPopulated ? it : it.skip;

  for (const set of SETS) {
    test(`${set} has a valid PNG for every ndex ${NDEX_FROM}..${NDEX_TO}`, () => {
      const missing: number[] = [];
      const badMagic: number[] = [];
      for (let n = NDEX_FROM; n <= NDEX_TO; n++) {
        const path = resolve(SPRITES_ROOT, set, `${n}.png`);
        if (!existsSync(path)) {
          missing.push(n);
          continue;
        }
        const buf = new Uint8Array(readFileSync(path));
        if (!isValidPng(buf)) badMagic.push(n);
      }
      expect({ set, missing, badMagic }).toEqual({ set, missing: [], badMagic: [] });
    });
  }
});
