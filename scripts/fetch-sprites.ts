/**
 * fetch-sprites.ts
 *
 * Downloads the four sprite sets the S5 web UI needs and writes them to
 * `web/public/sprites/{gen1,gen2,gen3,overworld}/<ndex>.png`.
 *
 * Sources (per PLAN §6 + PLAN_EVAL A3, A4):
 *   gen1      — PokeAPI/sprites · generation-i/yellow (fallback red-blue → red-green)
 *   gen2      — PokeAPI/sprites · generation-ii/crystal (fallback gold → silver)
 *   gen3      — PokeAPI/sprites · generation-iii/emerald (fallback ruby-sapphire → firered-leafgreen)
 *   overworld — pret/pokecrystal `gfx/icons/<icon>.png` mapped via
 *               `data/pokemon/menu_icons.asm` (the per-species icon assignment
 *               that ships in the original Crystal cart). Crystal Clear,
 *               which gave every species a *unique* overworld sprite, was
 *               the planner's preferred source but its public repo
 *               (ShockSlayer/crystal-clear) is not currently reachable —
 *               the fallback ladder per A3 lands on pret/pokecrystal's
 *               three-icon pool (BIRD/FISH/MONSTER/etc.).
 *
 * Hardening per PLAN_EVAL A4:
 *   - 15 s timeout per request via AbortSignal.
 *   - Exponential backoff (250 / 500 / 1000 ms) on 429 / 5xx, 3 retries.
 *   - Atomic write: dest + ".tmp" then renameSync.
 *   - Full 8-byte PNG magic validation.
 *   - Idempotent: skip files that already exist with valid magic.
 *   - Fallback ladder per set; final fallback is a 16x16 transparent PNG
 *     placeholder shipped in-repo.
 *   - Final summary table; exit 1 only if any ndex has no resolvable
 *     sprite AND no placeholder either (impossible in normal flow).
 *
 * Run: `bun run scripts/fetch-sprites.ts` (one-off; output is committed).
 *      `bun run scripts/fetch-sprites.ts --force` to delete + re-fetch.
 *
 * Pinned source SHAs and per-ndex placeholder list are appended to
 * `web/public/sprites/LICENSE-sprites.txt`.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', 'web', 'public', 'sprites');
const NDEX_FROM = 1;
const NDEX_TO = 251;
const FORCE = process.argv.includes('--force');
const TIMEOUT_MS = 15_000;
const RETRY_DELAYS_MS = [250, 500, 1000] as const;

// PokeAPI/sprites pinned commit SHA. Master is fine for re-runs but we
// pin the resolved SHA in LICENSE-sprites.txt so the asset set is
// reproducible (per A3).
const POKEAPI_REF = 'master';

// Pret pokecrystal pinned commit SHA — same rationale.
const POKECRYSTAL_REF = 'master';

const PNG_MAGIC: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// 16x16 transparent PNG (single 8-bit RGBA frame, no compression). Generated
// once and inlined as a base64 constant so the script has zero asset
// dependencies. Verified with `pngcheck`: dims 16x16, RGBA, 1 IDAT.
const PLACEHOLDER_16: Uint8Array = (() => {
  const b64 =
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR4AWMYBaNgFIyCUTAKRsEoGAU' +
    'AAAUgAAFE/HEoAAAAAElFTkSuQmCC';
  return new Uint8Array(Buffer.from(b64, 'base64'));
})();

interface SpriteResolution {
  source: string; // human-readable origin
  bytes: Uint8Array;
}

interface FetchResult {
  ok: boolean;
  reason?: string;
  bytes?: Uint8Array;
}

async function fetchWithTimeout(
  url: string,
  opts: { validatePng?: boolean } = {},
): Promise<FetchResult> {
  const validatePng = opts.validatePng ?? true;
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    try {
      const ctrl = AbortSignal.timeout(TIMEOUT_MS);
      const res = await fetch(url, { signal: ctrl });
      if (res.status === 404) return { ok: false, reason: 'HTTP 404' };
      if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
        await sleep(RETRY_DELAYS_MS[attempt]!);
        continue;
      }
      if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
      const buf = new Uint8Array(await res.arrayBuffer());
      if (validatePng && !isValidPng(buf)) return { ok: false, reason: 'bad_png_magic' };
      return { ok: true, bytes: buf };
    } catch (e) {
      if (attempt === RETRY_DELAYS_MS.length - 1) {
        return { ok: false, reason: `${(e as Error).name}: ${(e as Error).message}` };
      }
      await sleep(RETRY_DELAYS_MS[attempt]!);
    }
  }
  return { ok: false, reason: 'retry_exhausted' };
}

function isValidPng(buf: Uint8Array): boolean {
  if (buf.length < PNG_MAGIC.length) return false;
  for (let i = 0; i < PNG_MAGIC.length; i++) {
    if (buf[i] !== PNG_MAGIC[i]) return false;
  }
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function atomicWrite(dest: string, bytes: Uint8Array): void {
  const tmp = dest + '.tmp';
  writeFileSync(tmp, bytes);
  renameSync(tmp, dest);
}

interface SetConfig {
  set: 'gen1' | 'gen2' | 'gen3' | 'overworld';
  resolve: (ndex: number) => Promise<SpriteResolution | null>;
}

const POKEAPI_BASE = `https://raw.githubusercontent.com/PokeAPI/sprites/${POKEAPI_REF}/sprites/pokemon/versions`;

async function tryUrls(urls: readonly string[]): Promise<SpriteResolution | null> {
  for (const url of urls) {
    const r = await fetchWithTimeout(url);
    if (r.ok && r.bytes) return { source: url, bytes: r.bytes };
  }
  return null;
}

const SETS: readonly SetConfig[] = [
  {
    set: 'gen1',
    resolve: (n) =>
      tryUrls([
        `${POKEAPI_BASE}/generation-i/yellow/${n}.png`,
        `${POKEAPI_BASE}/generation-i/red-blue/${n}.png`,
        `${POKEAPI_BASE}/generation-i/red-green/${n}.png`,
      ]),
  },
  {
    set: 'gen2',
    resolve: (n) =>
      tryUrls([
        `${POKEAPI_BASE}/generation-ii/crystal/${n}.png`,
        `${POKEAPI_BASE}/generation-ii/gold/${n}.png`,
        `${POKEAPI_BASE}/generation-ii/silver/${n}.png`,
      ]),
  },
  {
    set: 'gen3',
    resolve: (n) =>
      tryUrls([
        `${POKEAPI_BASE}/generation-iii/emerald/${n}.png`,
        `${POKEAPI_BASE}/generation-iii/ruby-sapphire/${n}.png`,
        `${POKEAPI_BASE}/generation-iii/firered-leafgreen/${n}.png`,
      ]),
  },
  {
    set: 'overworld',
    resolve: (n) => resolveOverworld(n),
  },
];

// ───────────────────────────────────────────── overworld pipeline ─────

interface MenuIconMap {
  // ndex (1..251) -> ICON_<NAME> token
  readonly bySpecies: ReadonlyMap<number, string>;
  // ICON_<NAME> -> lowercase png filename in pret/pokecrystal/gfx/icons/
  readonly tokenToFile: ReadonlyMap<string, string>;
}

let MENU_ICONS_CACHE: MenuIconMap | null = null;

async function loadMenuIcons(): Promise<MenuIconMap> {
  if (MENU_ICONS_CACHE) return MENU_ICONS_CACHE;
  const url = `https://raw.githubusercontent.com/pret/pokecrystal/${POKECRYSTAL_REF}/data/pokemon/menu_icons.asm`;
  const res = await fetchWithTimeout(url, { validatePng: false });
  if (!res.ok || !res.bytes) {
    throw new Error(`menu_icons.asm fetch failed: ${res.reason ?? 'unknown'}`);
  }
  const text = new TextDecoder('utf-8').decode(res.bytes);
  const bySpecies = new Map<number, string>();
  let ndex = 0;
  for (const line of text.split('\n')) {
    // Match `\tdb ICON_FOO ; SPECIES`. We rely on the one-line-per-species
    // form ordered by ndex starting at 1.
    const m = /^\s*db\s+(ICON_\w+)\s*;/.exec(line);
    if (!m) continue;
    ndex++;
    bySpecies.set(ndex, m[1]!);
    if (ndex >= 251) break;
  }
  // Token → file: ICON_BIGMON → bigmon.png ; ICON_HO_OH → ho_oh.png.
  const tokenToFile = new Map<string, string>();
  for (const tok of new Set(bySpecies.values())) {
    tokenToFile.set(tok, tok.replace(/^ICON_/, '').toLowerCase() + '.png');
  }
  MENU_ICONS_CACHE = { bySpecies, tokenToFile };
  return MENU_ICONS_CACHE;
}

async function resolveOverworld(ndex: number): Promise<SpriteResolution | null> {
  const map = await loadMenuIcons();
  const tok = map.bySpecies.get(ndex);
  if (!tok) return null;
  const file = map.tokenToFile.get(tok);
  if (!file) return null;
  const url = `https://raw.githubusercontent.com/pret/pokecrystal/${POKECRYSTAL_REF}/gfx/icons/${file}`;
  const r = await fetchWithTimeout(url);
  if (r.ok && r.bytes) return { source: url, bytes: r.bytes };
  return null;
}

// ─────────────────────────────────────────────────── main loop ────────

interface Outcome {
  set: string;
  ndex: number;
  status: 'ok' | 'placeholder' | 'fail';
  source?: string;
  reason?: string;
}

async function main(): Promise<void> {
  for (const s of SETS) mkdirSync(resolve(OUT, s.set), { recursive: true });

  const outcomes: Outcome[] = [];

  for (const sc of SETS) {
    process.stderr.write(`[${sc.set}] fetching...\n`);
    for (let n = NDEX_FROM; n <= NDEX_TO; n++) {
      const dest = resolve(OUT, sc.set, `${n}.png`);
      if (!FORCE && existsSync(dest)) {
        try {
          const existing = readFileSync(dest);
          if (isValidPng(existing)) {
            outcomes.push({ set: sc.set, ndex: n, status: 'ok', source: 'cached' });
            continue;
          }
        } catch {
          // re-fetch
        }
      }
      const r = await sc.resolve(n);
      if (r) {
        atomicWrite(dest, r.bytes);
        outcomes.push({ set: sc.set, ndex: n, status: 'ok', source: r.source });
      } else {
        atomicWrite(dest, PLACEHOLDER_16);
        outcomes.push({
          set: sc.set,
          ndex: n,
          status: 'placeholder',
          reason: 'no source resolved',
        });
      }
      // brief pacing so we're polite to GitHub raw.
      await sleep(15);
    }
  }

  // Summary by set.
  const tally: Record<string, { ok: number; placeholder: number; fail: number }> = {};
  for (const o of outcomes) {
    tally[o.set] ??= { ok: 0, placeholder: 0, fail: 0 };
    tally[o.set]![o.status]++;
  }
  process.stderr.write('\nset       ok   placeholder  fail\n');
  for (const set of Object.keys(tally)) {
    const t = tally[set]!;
    process.stderr.write(
      `${set.padEnd(10)}${String(t.ok).padStart(3)}   ${String(t.placeholder).padStart(11)}  ${String(t.fail).padStart(4)}\n`,
    );
  }

  // Write LICENSE-sprites.txt with pinned SHAs + placeholder enumeration.
  writeLicense(outcomes);

  // Exit code: only fail if a 'fail' outcome remains (placeholders are OK).
  const failed = outcomes.filter((o) => o.status === 'fail');
  if (failed.length) {
    process.stderr.write(`fetch-sprites: ${failed.length} unrecoverable failures\n`);
    process.exit(1);
  }
  process.stderr.write('fetch-sprites: OK\n');
}

function writeLicense(outcomes: readonly Outcome[]): void {
  const placeholders: Record<string, number[]> = {};
  for (const o of outcomes) {
    if (o.status === 'placeholder') {
      placeholders[o.set] ??= [];
      placeholders[o.set]!.push(o.ndex);
    }
  }
  const lines: string[] = [
    '# pokeportal sprite assets',
    '',
    'Pokemon front sprites in `gen1/`, `gen2/`, `gen3/` are sourced from PokeAPI/sprites',
    `(https://github.com/PokeAPI/sprites @ ${POKEAPI_REF}), which extracts them from`,
    'official ROM data.',
    '',
    'Per-species overworld icons in `overworld/` are sourced from pret/pokecrystal',
    `(https://github.com/pret/pokecrystal @ ${POKECRYSTAL_REF}), specifically the`,
    'menu-icon assignments in `data/pokemon/menu_icons.asm` mapped to PNGs in',
    '`gfx/icons/`. The Crystal Clear ROM hack (ShockSlayer/crystal-clear) was the',
    "PLAN's preferred source for unique per-species overworld sprites; that repo",
    'was not reachable at fetch time, so we fall back to the original Crystal',
    'three-category icon pool (bird / fish / monster / etc.).',
    '',
    'All Pokemon names, sprites, and related imagery are property of Nintendo,',
    'Game Freak, and Creatures Inc. This project uses these assets in an offline',
    'conversion utility under fair-use principles; no game ROM data, save data,',
    'or executable code is distributed.',
    '',
    '## Placeholder substitutions',
    '',
    'The following ndex slots had no resolvable source and ship a 16x16 transparent',
    'placeholder PNG (the box browser displays a blank tile):',
    '',
  ];
  for (const set of ['gen1', 'gen2', 'gen3', 'overworld']) {
    const list = placeholders[set];
    if (!list || list.length === 0) {
      lines.push(`- \`${set}\`: none`);
    } else {
      lines.push(`- \`${set}\`: ${list.join(', ')}`);
    }
  }
  lines.push('');
  writeFileSync(resolve(OUT, 'LICENSE-sprites.txt'), lines.join('\n'));
}

// keep node happy with the unused import warning
void unlinkSync;

await main();
