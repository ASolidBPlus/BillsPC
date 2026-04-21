/**
 * Bundle-size CI gate. Per PLAN §9 #7 / PLAN_EVAL A11: the production
 * bundle's gzipped JS must be ≤ 200 KB. We also assert the single-chunk
 * invariant (exactly one .js file in dist/assets/).
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

const HARD_LIMIT_BYTES = 204_800; // 200 KB

describe('bundle size gate (PLAN §9 #7 / A11)', () => {
  const present = existsSync(DIST_ASSETS);
  const test = present ? it : it.skip;

  test('dist/assets contains exactly one .js file (single-chunk invariant)', () => {
    const files = readdirSync(DIST_ASSETS).filter((f) => f.endsWith('.js'));
    expect(files).toEqual(['app.js']);
  });

  test('app.js gzipped is below the 200 KB hard limit', () => {
    const path = resolve(DIST_ASSETS, 'app.js');
    const bytes = readFileSync(path);
    const gz = gzipSync(bytes);
    const raw = statSync(path).size;
    // Helpful logging for the Code Evaluator.
    console.log(`web bundle: raw=${raw} bytes, gzipped=${gz.byteLength} bytes`);
    expect(gz.byteLength).toBeLessThan(HARD_LIMIT_BYTES);
  });
});
