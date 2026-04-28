/**
 * Bundle-size CI gate. Per PLAN §9 #7 / PLAN_EVAL A11: the production
 * bundle's gzipped JS must be under the cap. We also assert the single-
 * chunk invariant (exactly one .js file in dist/assets/).
 *
 * S7b cap = 120 KB gz (per AMEND-S7b-22 / DECISION-9; was 95 KB pre-S7b
 * and 200 KB before that).
 *
 * Skips silently if `dist/` does not exist — only meaningful after
 * `bun run build`. CI runs `build` first then this test.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST_ASSETS = resolve(HERE, '../../dist/assets');

/**
 * Per AMEND-S7b-22 / DECISION-9: S7b raises the cap from 95 KB → 120 KB
 * gzipped. The cap is still well under the 200 KB hard limit; it gives
 * S7b room for stagingPane, confirmFlashDialog, flashProgressOverlay,
 * recoveryDialog, cartPaneShell, IndexedDB wrapper, recovery.ts,
 * cartFlasher.ts, dry-run UI, second box-pane, transfer matrix UI
 * surfacing — estimated +30-40 KB gz at the planner's hand-waved
 * estimate. 95 KB - 51.7 KB = 43 KB headroom = exactly at the planner
 * estimate's ceiling; 120 gives the inevitable "oh we also need a small
 * CSS rules block" some breathing room.
 */
const HARD_LIMIT_BYTES = 122_880; // 120 KB

describe('bundle size gate (PLAN §9 #7 / A11 / S7b DECISION-9)', () => {
  const present = existsSync(DIST_ASSETS);
  const test = present ? it : it.skip;

  test('dist/assets contains exactly one .js file (single-chunk invariant)', () => {
    const files = readdirSync(DIST_ASSETS).filter((f) => f.endsWith('.js'));
    expect(files).toEqual(['app.js']);
  });

  test('app.js gzipped is below the 120 KB cap (DECISION-9)', () => {
    const path = resolve(DIST_ASSETS, 'app.js');
    const bytes = readFileSync(path);
    const gz = gzipSync(bytes);
    const raw = statSync(path).size;
    // Helpful logging for the Code Evaluator.
    console.log(`web bundle: raw=${raw} bytes, gzipped=${gz.byteLength} bytes`);
    expect(gz.byteLength).toBeLessThan(HARD_LIMIT_BYTES);
  });
});
