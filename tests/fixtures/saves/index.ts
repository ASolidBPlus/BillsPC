/**
 * Per PLAN_EVAL A8 — fixtures live under `tests/fixtures/saves/` as
 * symlinks to the canonical demo binaries. Tests resolve paths through
 * this single export so any future relocation is one-line.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const demoRedPath = join(HERE, 'demo-red.sav');
export const demoCrystalPath = join(HERE, 'demo-crystal.sav');
