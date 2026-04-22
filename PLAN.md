# PLAN.md — Sprint 5: Visual makeover (Pokemon-faithful UI)

> Planner subagent output. Sprint methodology: see `/home/coder/project/CLAUDE.md` §Sprint methodology. Predecessors: S1 (convert), S2 (pack), S3a (save reader + minimal Vite UI). S3b (Web Serial GBxCart) deferred — user has no target cart hardware yet. S4 (PKHeX legality harness) dropped — user is doing manual PKHeX validation, which is strictly better than an automated stub.

## 1. Sprint contract

### Goal
Replace the minimal Vite UI shipped in S3a with a fully Pokemon-faithful chrome: a Gen 2 Crystal-style PC box browser using **Crystal Clear's per-species 16×16 overworld sprites** (Crystal Clear gave every one of the 251 mons its own walking sprite, where vanilla Crystal only used three generic Bird/Fish/Plant icons), a side-by-side **Gen 1/2 status screen ↔ Gen 3 status screen** comparison view that shows the converted intermediate next to the source mon, Gen 2 dialog borders + Pokemon GB pixel font, and a Gen 3 "PC storage" prompt for the convert-and-download action. The conversion plumbing (`parseSave`, `convert`, `packBoxed`, `zipFiles`) is **untouched**.

### In scope
1. **Self-hosted sprite asset pack** under `web/public/sprites/{gen1,gen2,gen3,overworld}/<ndex>.png` for ndex 1..251, plus a `scripts/fetch-sprites.ts` regenerator that pulls from PokeAPI's sprite repo and the Crystal Clear ROM hack repo.
2. **Pokemon GB pixel font** self-hosted at `web/public/fonts/pokemon-gb.woff2` (Generator picks one of the CC0 candidates listed in §10).
3. **Gen 2 dialog chrome** (`.gen2-dialog`), GBC palette CSS custom properties, blinking `▶` cursor, `image-rendering: pixelated` everywhere a sprite is drawn.
4. **PC box browser** — 4×5 grid of overworld sprites in a Gen 2 PC frame, keyboard cursor (arrow keys, Enter, Esc) + click selection, "BOX 1" header with prev/next arrows.
5. **Side-by-side status comparison** — clicking a mon opens an overlay with two stacked status screens: left = Gen 1/2 mode with Crystal-era PokeAPI front sprite + 5-stat layout (HP/Atk/Def/Spe/Spc), right = Gen 3 mode with Emerald PokeAPI front sprite + 6-stat layout (HP/Atk/Def/SpA/SpD/Spe). Stat deltas highlighted (green > 0, red < 0).
6. **"Convert and store" PC prompt** dressed as a Gen 3 "STORE in box" dialog; clicking confirm triggers the existing `blobDownload` of the `.pk3`.
7. **Refusal display** — Gen 1-style red "It cannot be moved." dialog instead of the current `.refusal` badge.
8. **State machine extensions** for box index, selected mon, and comparison overlay open-state. Backwards-compatible with the S3a shape: existing `'idle' | 'parsing' | 'parse_error' | 'loaded'` discriminator unchanged; `loaded` gains optional fields only.
9. **Tests**: per-ndex sprite-presence test, comparison-delta math test (FATMAN regression anchor), jsdom box-browser render test, updated upload-flow integration test, bundle-size gate (≤200 KB gz).

### Out of scope (deferred / future)
- **Web Serial / GBxCart RW adapter** — S3b. Will plug into the same controller's input port when hardware arrives.
- **Animation / transitions** (slide-in dialogs, sprite walk cycle, screen-fade) — future polish.
- **Mobile responsive** — desktop ≥ 1280×720 only; the GBC chrome is pixel-precise and rescaling on mobile is a separate design problem.
- **Audio cues** (cursor blip, confirm jingle) — future. Recommend NOT to add: silent UI is honest, audio assets are additional bundle weight, and Gen 2 SFX licensing is murky CC.
- **Party screen** (separate from box screen) — future. Box browser already shows party as a synthetic "PARTY" pseudo-box prepended to the box list (decision: keep one rendering primitive).
- **Battle stat sub-screen** (page 2 of the Gen 1/2 status screen showing moves, types, IDNo) — future. Comparison view shows page 1 only (the "stats page").
- **Multi-language UI strings** — English only.
- **Trainer card screen** (Gen 3 trainer card style) — current trainer info stays in a single dressed-up dialog box at the top.

### Done when
- `bun install && bun run --filter web build` exits 0.
- `bun run --filter web test` is green (existing suite + new sprite-paths, comparison-deltas, box-browser-render tests).
- All 4 sprite directories under `web/public/sprites/` contain a PNG for every ndex 1..251 (1004 files total).
- `web/public/fonts/pokemon-gb.woff2` exists and is referenced by `@font-face`.
- Built bundle's gzipped JS is < 200 KB (`web/src/__tests__/bundle-size.test.ts` passes).
- Loading `tests/fixtures/saves/demo-crystal.sav` in `bun run --filter web preview` shows the Crystal trainer in the Gen 2 dialog frame, the box browser populated with overworld sprites for every mon present, clicking any mon opens the side-by-side comparison view, the FATMAN comparison shows **+40 SpA in green** (Gen 3 base stat buff), and clicking "STORE" downloads a byte-identical `.pk3` to what the S3a UI produced.
- All existing S1/S2/S3a tests still pass (`bun test`).

---

## 2. Directory layout

Add under `web/`:

```
web/
  index.html                       # CHANGED: pull in pokemon-gb font preload link
  vite.config.ts                   # UNCHANGED
  public/
    favicon.svg                    # UNCHANGED
    fonts/
      pokemon-gb.woff2             # NEW (~10 KB, CC0)
      LICENSE-fonts.txt            # NEW (font origin + license text)
    sprites/
      LICENSE-sprites.txt          # NEW (PokeAPI + Crystal Clear attribution)
      gen1/
        1.png … 251.png            # 251 files (Yellow front sprites, 56×56 typical)
      gen2/
        1.png … 251.png            # 251 files (Crystal front sprites, 56×56)
      gen3/
        1.png … 251.png            # 251 files (Emerald front sprites, 64×64)
      overworld/
        1.png … 251.png            # 251 files, 16×16, Crystal Clear
  src/
    main.ts                        # UNCHANGED
    state.ts                       # CHANGED: extend 'loaded' state with browser/overlay fields
    download.ts                    # UNCHANGED
    filename.ts                    # UNCHANGED
    zip.ts                         # UNCHANGED
    style.css                      # MAJOR REWRITE: GBC palette, Gen 2 dialog, fonts, pixel-render
    ui.ts                          # SHRUNK to thin controller; rendering moves to ui/
    ui/
      boxBrowser.ts                # NEW: 4×5 grid + cursor + nav arrows
      statusScreen.ts              # NEW: single status screen, mode = 'gen12' | 'gen3'
      comparisonView.ts            # NEW: side-by-side wrapper + delta highlighter
      dialog.ts                    # NEW: generic Gen 2-style dialog box helper
      menu.ts                      # NEW: vertical menu with cursor (Convert / Cancel)
      refusal.ts                   # NEW: Gen 1 "It cannot be moved." red dialog
      sprites.ts                   # NEW: spritePath(ndex, set) helper + onerror fallback
      keyboard.ts                  # NEW: global key handler wired by controller
    __tests__/
      bundle-size.test.ts          # UNCHANGED (still asserts ≤200 KB gz)
      filename.test.ts             # UNCHANGED
      state.test.ts                # UPDATED: cover new actions (cursor_moved, mon_opened, etc.)
      zip.test.ts                  # UNCHANGED
      upload-flow.test.ts          # UPDATED: post-parse, asserts box browser renders + click opens overlay
      sprite-paths.test.ts         # NEW: 4×251 file-presence under web/public/sprites
      comparison-deltas.test.ts    # NEW: FATMAN regression anchor + general delta math
      box-browser-render.test.ts   # NEW (jsdom): given a parsed save, renders correct sprites

scripts/
  fetch-sprites.ts                 # NEW: one-off downloader, run by Generator, output committed
```

**Rationale.** The `ui/` subdirectory is added to keep `ui.ts` from ballooning. Each new module has one rendering responsibility. Sprites + fonts live in `public/` so Vite serves them at stable paths (`/sprites/...`) without bundling — the build never touches them, the browser caches per-asset. Total static-site disk weight: ~700 KB for sprites + ~10 KB font + ~30 KB JS gz. Acceptable for a static deploy.

---

## 3. Visual design spec

### 3.1 GBC palette (CSS custom properties on `:root`)

The Gen 2 GBC dialog frame uses a four-color palette per the in-game `MENU_BLACK / MENU_DARK_GRAY / MENU_LIGHT_GRAY / MENU_WHITE` constants. Hex values match the GBC's perceptually-corrected palette as it ships in pret/pokecrystal's `gfx/sgb/sgb.pal` for the menu pal:

```css
:root {
  --gbc-bg:           #f8f8f8;  /* lightest  — dialog interior */
  --gbc-light-gray:   #c0c0c0;  /* cursor inactive, divider */
  --gbc-dark-gray:    #888888;  /* secondary text, deltas off */
  --gbc-border-outer: #303030;  /* outer 4-px border */
  --gbc-border-inner: #f8f8f8;  /* inner 2-px shadow (white-on-dark) */
  --gbc-text:         #303030;  /* default text */
  --gbc-accent-red:   #d83018;  /* refusal / negative delta */
  --gbc-accent-green: #58a058;  /* positive delta */
  --pc-blue:          #5878a8;  /* Gen 3 PC dialog header (RSE PC palette) */
}
```

### 3.2 Dialog frame (`.gen2-dialog`)

```css
.gen2-dialog {
  background: var(--gbc-bg);
  /* 4-px outer frame, 2-px inner inset shadow (Gen 2 chrome) */
  border: 4px solid var(--gbc-border-outer);
  box-shadow:
    inset 0 0 0 2px var(--gbc-bg),         /* inner reset */
    inset 0 0 0 4px var(--gbc-border-outer),
    inset 0 0 0 6px var(--gbc-bg);
  padding: 12px 16px;
  font-family: 'PokemonGB', monospace;
  font-size: 16px;
  line-height: 1.25;
  color: var(--gbc-text);
  image-rendering: pixelated;
}
```

The `box-shadow` triple-inset reproduces the iconic "double border" without nested elements. Verified against pret/pokecrystal's `gfx/frames/border.png`: 4 px outer black, 2 px inner white, 2 px inner black, content. We collapse the second inner-black to the parent's border to save a layer.

### 3.3 Cursor (`▶`)

```css
.cursor-arrow {
  display: inline-block;
  width: 8px;
  color: var(--gbc-text);
  animation: cursor-blink 0.6s steps(2, start) infinite;
}
@keyframes cursor-blink { to { visibility: hidden; } }
```

8-px column reserved on the left of every selectable row. Selected row sets `.cursor-arrow::before { content: '▶'; }`, others stay blank. Gen 2 cursor blinks at ~30 Hz / 18 frames; we approximate with 0.6 s steps(2).

### 3.4 Pixel rendering rule

```css
img.sprite, .pixel { image-rendering: pixelated; image-rendering: crisp-edges; }
```

Applied to all `<img>` under `.sprite` class. The overworld sprites are 16×16 source — render at 32×32 (2×) in the box grid; status-screen front sprites render at native 56×56 (gen1/gen2) or 64×64 (gen3) without scaling.

### 3.5 Font

```css
@font-face {
  font-family: 'PokemonGB';
  src: url('/fonts/pokemon-gb.woff2') format('woff2');
  font-display: swap;
  font-weight: 400;
}
body { font-family: 'PokemonGB', 'Courier New', monospace; }
```

`font-display: swap` so the page renders text immediately in the system fallback while the woff2 loads, then reflows. The Gen 2 in-game font is 8×8 px per glyph; the woff2 candidates are designed at that pixel grid and look right at sizes that are integer multiples of 8 px (we use 16 px = 2× scale). Sub-pixel sizes blur — strictly use 16 / 24 / 32 px.

### 3.6 Layout dimensions

- Box browser: 4 columns × 5 rows of 32×32 sprite tiles + 8 px gaps = `4*32 + 3*8 + 16` = 168 px wide × 192 px tall content area, inside an `.gen2-dialog` (~190×220 with padding).
- Status screen (single, Gen 1/2 mode): 240 × 200 px content. Header line ("CLEFAIRY  Lv 14"), sprite top-left 56×56, stat block right side: 5 lines × 16 px.
- Status screen (Gen 3 mode): 256 × 200 px content. Sprite top-left 64×64, 6 stat lines.
- Comparison view: two status screens side-by-side with 16 px gap = ~520 px wide. Centered overlay over a `rgba(0,0,0,0.4)` scrim.

Overall page width target: 880 px (matches S3a's `#app` max-width). On screens narrower than 880 px we let the dialogs scroll horizontally rather than reflow — mobile is out of scope; this avoids breaking pixel alignment.

---

## 4. Component decomposition

Each module exports pure functions that take a state slice + dispatch and return an `HTMLElement`. No internal state; the controller in `ui.ts` owns all state.

### 4.1 `web/src/ui/dialog.ts`
```ts
/** Render an empty Gen 2 dialog frame; caller appends children. */
export function dialog(opts?: { class?: string }): HTMLElement;
/** Render a Gen 2 dialog with text content (auto-line-breaks at 18 chars). */
export function textDialog(lines: readonly string[], opts?: { class?: string }): HTMLElement;
```

### 4.2 `web/src/ui/menu.ts`
```ts
export interface MenuItem { readonly label: string; readonly onSelect: () => void; readonly disabled?: boolean; }
export interface MenuProps {
  readonly items: readonly MenuItem[];
  readonly selectedIndex: number;
  readonly onCursor: (delta: -1 | 1) => void;
  readonly onCancel?: () => void;
}
export function menu(props: MenuProps): HTMLElement;
```

### 4.3 `web/src/ui/sprites.ts`
```ts
export type SpriteSet = 'gen1' | 'gen2' | 'gen3' | 'overworld';
/** Returns `/sprites/<set>/<ndex>.png`. Caller wraps in <img>. */
export function spritePath(ndex: number, set: SpriteSet): string;
/** <img loading="lazy" class="sprite" onerror=fallback>. Fallback for ndex without sprite is a 16×16 question-mark drawn inline (data URL). */
export function spriteImg(ndex: number, set: SpriteSet, alt: string): HTMLImageElement;
```

### 4.4 `web/src/ui/boxBrowser.ts`
```ts
export interface BoxBrowserProps {
  readonly save: SaveContents;
  readonly boxIndex: number;            // 0 = synthetic "PARTY" pseudo-box; 1..N = stored boxes
  readonly cursor: { row: number; col: number };
  readonly entries: readonly BrowserEntry[];  // pre-collected by controller
  readonly onCursorMove: (drow: -1|0|1, dcol: -1|0|1) => void;
  readonly onBoxChange: (delta: -1 | 1) => void;
  readonly onMonOpen: (ref: MonRef) => void;
}
export function boxBrowser(props: BoxBrowserProps): HTMLElement;

export interface BrowserEntry {
  readonly ref: MonRef;
  readonly mon: Gen12Pokemon;
  readonly ndex: number;            // == mon.speciesGen2Id; 0 if unknown
  readonly slotInBox: number;       // 0..19
}
```

The browser draws the 4×5 grid; empty slots render as transparent 32×32 placeholders. Box header: `◀ BOX <i+1> ▶` (left/right arrows are buttons that call `onBoxChange`). The "PARTY" pseudo-box (boxIndex=0) shows up to 6 slots in the first row only.

### 4.5 `web/src/ui/statusScreen.ts`
```ts
export type StatusMode = 'gen12' | 'gen3';
export interface StatusScreenProps {
  readonly mode: StatusMode;
  readonly mon: Gen12Pokemon;
  readonly intermediate?: Gen3Intermediate;  // required when mode === 'gen3'
  readonly speciesName: string;
  readonly nickname: string;
  readonly stats: SixStats;                   // hp,atk,def,spa,spd,spe (gen3) or with spc collapsed (gen12)
  readonly deltas?: SixStatDeltas;            // present only in gen3 mode
}
export interface SixStats { hp: number; atk: number; def: number; spa: number; spd: number; spe: number; }
export interface SixStatDeltas { hp: number; atk: number; def: number; spa: number; spd: number; spe: number; }
export function statusScreen(props: StatusScreenProps): HTMLElement;
```

In `gen12` mode the rendered stat lines are: `HP <cur>/<max>`, `ATTACK`, `DEFENSE`, `SPEED`, `SPECIAL` (single combined Special — Gen 1 source = single Special; Gen 2 source = Special Attack shown as "SPECIAL" with the SpD value tucked under per Gen 2 status screen page 2 which is out of scope for this sprint, so we show SpA only and label it "SPCL").
In `gen3` mode: `HP`, `ATTACK`, `DEFENSE`, `SP. ATK`, `SP. DEF`, `SPEED`. Each line in `gen3` mode also gets a colored delta badge `+40` (green) or `-9` (red) when `deltas` is provided.

### 4.6 `web/src/ui/comparisonView.ts`
```ts
export interface ComparisonProps {
  readonly mon: Gen12Pokemon;
  readonly intermediate: Gen3Intermediate | null;  // null when refused
  readonly refusal?: { reason: string; message: string };
  readonly speciesName: string;
  readonly nickname: string;
  readonly onConfirm: () => void;       // Convert + download
  readonly onCancel: () => void;
}
export function comparisonView(props: ComparisonProps): HTMLElement;

/** Pure helper: compute Gen 1/2 source stats and Gen 3 final stats and the deltas. */
export function computeComparisonStats(mon: Gen12Pokemon, intermediate: Gen3Intermediate): {
  source: SixStats;
  converted: SixStats;
  deltas: SixStatDeltas;
};
```

The comparison view stacks: header dialog with `<species> "<nick>" Lv <n>`, two status screens side by side (left = `gen12`, right = `gen3`), bottom menu = `STORE / CANCEL` for non-refused mons; for refused mons the right-hand side is replaced with the Gen 1 refusal dialog and the menu is `CANCEL` only.

### 4.7 `web/src/ui/refusal.ts`
```ts
/** Gen 1-style red dialog: "<NICK> cannot be moved!" + reason subtext. */
export function refusalDialog(nickname: string, reason: string, message: string): HTMLElement;
```

### 4.8 `web/src/ui/keyboard.ts`
```ts
export interface KeyHandlers {
  onArrow?: (drow: -1|0|1, dcol: -1|0|1) => void;
  onConfirm?: () => void;       // Enter / Z
  onCancel?: () => void;        // Esc / X
  onPrevBox?: () => void;       // PageUp / [
  onNextBox?: () => void;       // PageDown / ]
}
/** Attaches a single keydown listener; returns a teardown fn. */
export function bindKeys(target: HTMLElement | Document, h: KeyHandlers): () => void;
```

Key map: arrows + WASD for cursor; Enter / Z = confirm; Esc / X = cancel; `[ / ]` = prev/next box. Z/X mirror the GBA buttons familiar to emu users.

### 4.9 `web/src/ui.ts` (controller, shrunk)

Continues to own `createController(root)`, `handleFileSelected`, `render(root, state, dispatch, deps)`. The `'loaded'` branch now calls `boxBrowser(...)` for the main view and conditionally overlays `comparisonView(...)`. `runConvert(mon)` is unchanged. `decodeNickFallback` is unchanged (carries forward AMEND-S3a-3 — fix when S3b touches).

---

## 5. State machine changes

S3a-shaped `AppState` discriminator and its `'idle' | 'parsing' | 'parse_error' | 'loaded'` branches are preserved. We extend the `'loaded'` variant with optional fields and add new actions. **No existing field is removed or renamed — pure superset.**

```ts
export interface MonRef { /* unchanged */ }

export type AppState =
  | { kind: 'idle' }
  | { kind: 'parsing'; fileName: string; size: number }
  | { kind: 'parse_error'; fileName: string; error: SaveError }
  | {
      kind: 'loaded';
      fileName: string;
      save: SaveContents;
      results: ReadonlyMap<string, ConvertResult>;
      // S5 additions:
      boxIndex: number;                          // 0 = PARTY pseudo-box; 1..N = stored boxes (1-based for display, 0-based internally is the array index into save.boxes)
      cursor: { row: number; col: number };      // 0..4, 0..3 — where the cursor sits in the current 4×5 grid
      openMon: MonRef | null;                    // null → no overlay; non-null → comparison view open for this mon
      // S3a fields kept for backwards-compat in case other consumers exist; no
      // longer surfaced in the new UI but reducer still honors actions:
      expandedBoxes: ReadonlySet<number>;
      currentBoxExpanded: boolean;
    };

export type Action =
  | { type: 'file_selected'; file: { name: string; size: number } }
  | { type: 'file_parsed'; save: SaveContents; fileName: string }
  | { type: 'file_failed'; error: SaveError; fileName: string }
  | { type: 'convert_done'; ref: MonRef; result: ConvertResult }
  | { type: 'box_toggled'; boxIndex: number }                 // S3a, kept
  | { type: 'current_box_toggled' }                            // S3a, kept
  | { type: 'reset' }
  // S5 additions:
  | { type: 'cursor_move'; drow: -1|0|1; dcol: -1|0|1 }
  | { type: 'box_change'; delta: -1 | 1 }
  | { type: 'mon_open'; ref: MonRef }
  | { type: 'mon_close' };
```

**Backwards-compat note.** The `'loaded'` superset means any S3a test that constructs a `loaded` state literal (e.g. in `state.test.ts`) will fail TS strict checks for missing `boxIndex / cursor / openMon`. We update the reducer's `file_parsed` case to populate all new fields with defaults (`boxIndex: 0, cursor: {row:0,col:0}, openMon: null`); we also update `state.test.ts` literals. No public `core/` surface changes.

`mon_open` requires `state.kind === 'loaded'`; sets `openMon = action.ref`.
`mon_close` clears `openMon`.
`cursor_move` clamps to [0,4]×[0,3] and is a no-op outside `loaded`.
`box_change` clamps to `[0, save.boxes.length]` (0 = PARTY pseudo-box; high bound = stored boxes count); also resets `cursor` to `{0,0}`.

---

## 6. Sprite acquisition script (`scripts/fetch-sprites.ts`)

Run **once** by the Generator during S5 implementation; the output is committed to the repo so end users don't fetch anything at build time. Re-runnable to refresh assets if PokeAPI publishes corrections.

### 6.1 Pseudocode

```ts
// scripts/fetch-sprites.ts — bun-runnable, no deps beyond node:fs / node:fetch.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(import.meta.dir, '../web/public/sprites');
const NDEX_RANGE = { from: 1, to: 251 };

interface Source {
  set: 'gen1' | 'gen2' | 'gen3' | 'overworld';
  url: (ndex: number) => string;
}

const SOURCES: readonly Source[] = [
  // PokeAPI sprites repo — raw GitHub.
  { set: 'gen1', url: n =>
      `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-i/yellow/${n}.png` },
  { set: 'gen2', url: n =>
      `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-ii/crystal/${n}.png` },
  { set: 'gen3', url: n =>
      `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-iii/emerald/${n}.png` },
  // Crystal Clear overworld sprites — see §7 for repo + path verification step.
  { set: 'overworld', url: n =>
      `https://raw.githubusercontent.com/ShockSlayer/crystal-clear/master/gfx/overworlds/${n.toString().padStart(3,'0')}.png` },
];

async function fetchOne(s: Source, ndex: number): Promise<{ ok: boolean; reason?: string }> {
  const dest = `${OUT}/${s.set}/${ndex}.png`;
  if (existsSync(dest)) return { ok: true };
  const res = await fetch(s.url(ndex));
  if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
  const buf = new Uint8Array(await res.arrayBuffer());
  // Sanity: PNG magic.
  if (!(buf[0] === 0x89 && buf[1] === 0x50)) return { ok: false, reason: 'not_png' };
  writeFileSync(dest, buf);
  return { ok: true };
}

for (const s of SOURCES) mkdirSync(`${OUT}/${s.set}`, { recursive: true });

const failures: { set: string; ndex: number; reason: string }[] = [];
for (const s of SOURCES) {
  for (let n = NDEX_RANGE.from; n <= NDEX_RANGE.to; n++) {
    const r = await fetchOne(s, n);
    if (!r.ok) failures.push({ set: s.set, ndex: n, reason: r.reason ?? 'unknown' });
    await new Promise(r => setTimeout(r, 25)); // rate-limit politely
  }
}

if (failures.length) {
  console.error(`fetch-sprites: ${failures.length} failures:`);
  for (const f of failures) console.error(`  ${f.set} #${f.ndex}: ${f.reason}`);
  process.exit(1);
}
console.log('fetch-sprites: OK');
```

### 6.2 Failure handling

- **PokeAPI 404 for a specific ndex+variant.** Some Gen 1/2 sprite variants are missing for a few mons (e.g. some Gen 2 Crystal sprites alias to Gold/Silver). Fallback chain per set:
  - `gen1`: yellow → red-blue → red-green
  - `gen2`: crystal → gold → silver
  - `gen3`: emerald → ruby-sapphire → firered-leafgreen
  - `overworld`: Crystal Clear path (verified in §7) → fall back to a generic 16×16 "?" placeholder shipped in repo at `web/public/sprites/overworld/_placeholder.png`
- The script tries each fallback in order; logs which fallback was used.
- Generator commits the resulting set even if a few mons fall back — the visual goal (every mon has *a* sprite in *every* slot) is met.

### 6.3 How to regenerate

`bun run scripts/fetch-sprites.ts` (no other args). Pre-existing files are skipped; delete `web/public/sprites/<set>/<ndex>.png` to force a re-fetch. README note added next to `LICENSE-sprites.txt`.

---

## 7. Crystal Clear overworld sprite source

**Repo.** `https://github.com/ShockSlayer/crystal-clear` — the canonical Crystal Clear ROM hack source. Crystal Clear is the de-facto reference for "every mon has a unique Gen 2-style overworld sprite" because vanilla Crystal only included three generic icons (Bird, Fish, Plant) shared across all 251.

**Path within repo (to verify).** The Generator MUST verify the exact path during implementation by either:
1. `git clone --depth 1 https://github.com/ShockSlayer/crystal-clear /tmp/cc-probe && find /tmp/cc-probe/gfx -iname '*.png' | head` — confirm location of per-ndex PNGs.
2. Fall back probes (in order): `gfx/overworlds/`, `gfx/overworld/`, `gfx/pokemon/<name>/overworld.png`, `gfx/icons/`. The disasm structure typically uses a per-species directory, so a `name → ndex` lookup may be needed.

**License.** Crystal Clear is a ROM hack distributed under the same terms as pret/pokecrystal disassembly (BSD-style for the disasm scaffolding; sprite data is derivative of Game Freak's IP and used under the same fair-use posture as the rest of this project). We commit the sprites with an attribution `LICENSE-sprites.txt` that reads:

```
Pokemon front sprites in this directory are sourced from PokeAPI/sprites
(https://github.com/PokeAPI/sprites), which extracts them from official
ROM data. Per-species overworld sprites are sourced from the Crystal Clear
ROM hack by ShockSlayer (https://github.com/ShockSlayer/crystal-clear).
All Pokemon names, sprites, and related imagery are property of Nintendo,
Game Freak, and Creatures Inc. This project uses these assets for an
offline conversion utility under fair-use principles; no game ROM data,
save data, or executable code is distributed.
```

If the Crystal Clear repo path probe fails (repo renamed/moved), the Generator escalates to the orchestrator before substituting an alternative source — overworld sprite faithfulness is the single biggest visual lift in this sprint and a placeholder set defeats the goal.

---

## 8. Test matrix

### 8.1 New tests

| File | Type | Coverage |
|---|---|---|
| `web/src/__tests__/sprite-paths.test.ts` | unit (node fs) | For each ndex in 1..251 and each set in {gen1, gen2, gen3, overworld}, assert `web/public/sprites/<set>/<ndex>.png` exists and starts with the PNG magic bytes (`89 50 4E 47`). 1004 assertions. Skips with a clear `it.skip` if the directory is empty (so CI can fail loudly when the Generator forgot to commit, but devs cloning fresh aren't blocked from running other tests). |
| `web/src/__tests__/comparison-deltas.test.ts` | unit (pure) | `computeComparisonStats(mon, intermediate)` on a fixture FATMAN (Snorlax, Lv 50, neutral nature, perfect IVs, 0 EVs) returns deltas matching the Gen 2 → Gen 3 base-stat shift: HP 0, Atk 0, Def 0, SpA **+40**, SpD 0, Spe 0 *(Snorlax base SpA: Gen 2 = 65, Gen 3 = 65 — actually flat. Replace Snorlax with **the actual canonical FATMAN regression case from HANDOFF/MEMORY**; Generator MUST verify against the orchestrator's prior FATMAN inline output. The point is: at least one base-stat delta from the Gen 2 → Gen 3 rebalance MUST be exercised. Candidate species with confirmed Gen 3 base-stat changes that increase by ≥10: **Magneton SpD +20, Vileplume SpA +5/SpD +30, Victreebel SpA +5/SpD +10**. Generator picks one and locks the test fixture.)* Also tests: deltas computed at the same level/IV/EV produce 0 across the board for an unchanged species (e.g. Pikachu base stats are flat between Gen 2 and Gen 3); negative deltas render with the right sign. |
| `web/src/__tests__/box-browser-render.test.ts` | jsdom integration | Build a synthetic `SaveContents` with a known box layout; call the controller's render; assert the box browser DOM contains the expected `<img src="/sprites/overworld/<ndex>.png">` for each populated slot in the correct grid position. |

### 8.2 Updated tests

| File | Update |
|---|---|
| `web/src/__tests__/state.test.ts` | Add reducer cases for `cursor_move`, `box_change`, `mon_open`, `mon_close`. Update existing `loaded`-state literals to include `boxIndex / cursor / openMon` defaults. |
| `web/src/__tests__/upload-flow.test.ts` | After parse, assert the box browser is in the DOM (not the old mon-row list); simulate a click on the first populated overworld sprite; assert `comparisonView` overlay appears with two status screens and a STORE button; click STORE; assert `URL.createObjectURL` was called with an 80-byte blob (existing assertion). |

### 8.3 Unchanged tests

- `web/src/__tests__/bundle-size.test.ts` — still asserts ≤200 KB gz. With the new CSS (~5 KB gz), font (referenced not bundled), and ~5 KB of new JS for the UI modules, headroom is comfortable.
- `web/src/__tests__/filename.test.ts` — no change.
- `web/src/__tests__/zip.test.ts` — no change.
- All `tests/unit/` and `tests/integration/` save-parser + convert tests — no change.

### 8.4 Manual verification (Code Evaluator runs in `bun run --filter web preview`)

1. Drop `tests/fixtures/saves/demo-crystal.sav` → see the Gen 2 dialog frame, trainer name in pixel font, Box 1 populated with Crystal Clear overworld sprites.
2. Arrow-key navigate the cursor across the box; press Enter on a mon → comparison view opens; left side shows Gen 2 Crystal front sprite + 5 stats; right side shows Gen 3 Emerald front sprite + 6 stats with delta badges.
3. Find a Magneton (or whichever species was chosen in 8.1) → SpA delta badge is green and shows the expected positive number.
4. Click STORE → browser downloads `<species>-<nick>-<TID>.pk3` (80 bytes).
5. Open `tests/fixtures/saves/demo-red.sav` → verify Gen 1 mons render with Yellow front sprite on the left, Gen 3 sprite on the right, and Special is shown as a single combined `SPCL` value (not split into SpA/SpD).
6. Click on Mew (or any refused mon) → right side shows the Gen 1-style red "It cannot be moved." dialog.

---

## 9. Success criteria (objective pass/fail)

The Code Evaluator MUST mark each as PASS / FAIL / PARTIAL with a verification command. Any FAIL → sprint FAIL.

1. **SPRITES-PRESENT.** `bun run --filter web test sprite-paths` exits 0; 1004/1004 PNGs present and valid.
2. **FONT-PRESENT.** `web/public/fonts/pokemon-gb.woff2` exists, ≤ 30 KB, served at `/fonts/pokemon-gb.woff2` (verified by curl against `bun run --filter web preview`).
3. **CHROME.** Visual diff against a reference screenshot (Code Evaluator captures one with headless Chrome): the dialog frame has 4 px outer dark border + 2 px inner shadow; cursor is the `▶` glyph in the GBC palette; all text uses the Pokemon GB font (no system-font fallback flash after first cache).
4. **BOX-BROWSER.** Loading `demo-crystal.sav` renders the Box 1 4×5 grid; populated slots have `<img src="/sprites/overworld/<ndex>.png">`; arrow keys move the cursor; PageDown advances to Box 2.
5. **COMPARISON-OPEN.** Pressing Enter on a populated slot opens the comparison overlay with both status screens visible.
6. **COMPARISON-DELTAS.** `computeComparisonStats` regression test passes; chosen species shows the correct positive delta in green and at least one zero delta renders as un-highlighted.
7. **STORE-DOWNLOAD.** Clicking STORE downloads a `.pk3` byte-identical to `packBoxed(convert(mon))` (verified by intercepting `URL.createObjectURL` in jsdom test).
8. **REFUSAL.** A refused mon (e.g. Mew in `demo-red.sav`) opens to the red Gen 1 refusal dialog instead of the comparison view.
9. **BUNDLE-SIZE.** `bundle-size.test.ts` passes (gzipped JS < 200 KB).
10. **STATE-COMPAT.** `state.test.ts` passes; reducer is pure; new actions are no-ops outside `'loaded'`.
11. **NO-REGRESSION.** All S1/S2/S3a tests still green: `bun test` exits 0 root-wide; existing `core/` and `tests/` suites unchanged.
12. **TYPECHECK + LINT.** `bun run typecheck && bun run lint` green across all workspaces.

---

## 10. Open questions for the Plan Evaluator

1. **Gen 1 sprite variant — Yellow vs Red/Blue.** PLAN picks **Yellow** (cleaner GB Color art, kept the same dimensions as R/B but with palette correction; consistent with the Gen 2 Crystal pick on the front-sprite side). Evaluator may prefer R/B for "this is what Red trainers actually see." Confirm or override.
2. **Gen 3 sprite variant — Emerald vs Ruby/Sapphire vs FRLG.** PLAN picks **Emerald** (most polished; latest Gen 3 art). Evaluator may prefer **FireRed/LeafGreen** since FRLG is the canonical Gen 1 → Gen 3 in-game transfer destination via Time Capsule's spiritual successor (FRLG can receive from R/S/E only, not Gen 1 directly — but FRLG is "the Gen 3 Kanto game" thematically). Confirm.
3. **Font choice.** Two free CC0/OFL candidates: **(a)** "Pokemon GB" by Pokemon Perler (CC0, exact 8×8 glyph match to in-game font, woff2 ~9 KB), **(b)** "Early GameBoy" by Jimmy Campbell (free for commercial use, slightly different letterforms but covers more code points). PLAN recommends **(a) Pokemon GB** for visual fidelity. Confirm or override.
4. **Sprite hosting — committed to repo vs CDN fallback.** PLAN commits all 1004 PNGs to `web/public/sprites/` (~700 KB). Alternative: CDN fallback to PokeAPI's GitHub raw URLs (zero repo bloat, but breaks offline, breaks reproducible builds, adds CORS risk). PLAN sticks with self-hosted — confirm.
5. **Audio cues.** PLAN says NO. Confirm — adding them would mean ~50 KB of opus/ogg per cue × 5 cues, plus licensing ambiguity. The visual experience is the goal.
6. **Party-screen view.** PLAN renders party as a synthetic "PARTY" pseudo-box at `boxIndex = 0` (single primitive: `boxBrowser`). Alternative is a separate Gen 2-style party menu screen showing 6 vertically-stacked rows with mini sprite + HP bar. PLAN deferred this — confirm or expand scope.
7. **Crystal Clear repo availability.** The repo URL is the canonical reference but the Crystal Clear project has been moved/forked before. Generator's first task is to verify `git clone` works and locate the per-species overworld PNG path. If it has moved, PLAN's fallback is to escalate; Evaluator may want to pre-pin a specific commit SHA or vendor-cache the sprites in a Generator-owned mirror. Confirm escalation policy.
8. **`gen12` status screen Special handling.** Gen 1 has a single `Special` stat; Gen 2 has split `SpA`/`SpD` but the in-game status screen page 1 still shows `SPCL.ATK` and `SPCL.DEF` as two lines (page 1 vs page 2 split is different from Gen 1). PLAN currently shows single `SPCL` for both Gen 1 and Gen 2 sources to keep one rendering primitive. Evaluator may want Gen 2 source to show two lines (`SPCL.ATK`, `SPCL.DEF`) for accuracy. Confirm.
9. **Backwards-compat fields on `loaded` state.** PLAN keeps `expandedBoxes` + `currentBoxExpanded` as dead fields for compat. Evaluator may prefer to drop them outright (no external consumers — the only readers are `web/src/ui.ts` itself, which we're rewriting). Confirm: drop or keep.
10. **FATMAN regression species.** PLAN §8.1 flags that the canonical "FATMAN" case from HANDOFF needs to be re-verified — PLAN as written has me unsure whether FATMAN refers to a specific Snorlax fixture or is a stand-in name for the SpA-buff regression. Evaluator: confirm which species + level + IV/EV combo locks the regression anchor, OR confirm the Generator should pick from {Magneton +20 SpD, Vileplume +5 SpA / +30 SpD, Victreebel +5 SpA / +10 SpD} per PLAN §8.1.

---

## 11. Out of scope for S5 / deferral list

Reaffirm — do NOT let scope creep here. Items below remain deferred or future work:

- **Web Serial / GBxCart RW adapter** — S3b, blocked on user acquiring target cart hardware.
- **PKHeX legality harness** — dropped entirely; user does manual PKHeX validation, which is the correct call.
- **Animation / transitions** — sprite walk cycle, dialog slide-in, screen fade. Future polish; not required for "Pokemon-faithful" goal at the static-frame level.
- **Mobile responsive layout** — desktop ≥ 1280×720 only.
- **Audio** — see §10 Q5.
- **Party screen** — see §10 Q6.
- **Battle stat sub-screen / status screen page 2** (moves, types, IDNo) — future. Comparison shows page 1 only.
- **Trainer card screen (Gen 3 RSE style)** — future. Trainer info stays in a simple top dialog.
- **Save *writing* / Gen 3 save injection** — S6+ if ever.
- **Multi-language UI strings** — English only.
- **JP/EU save format support** — S3a deferred this; S5 doesn't change that.
- **Drag-reorder, edit, save-back-to-sav** — out of scope; one-way export tool.
- **PWA / service-worker** — bundle is small; PWA is a separate polish pass.
- **Telemetry / analytics** — never. Hard rule.
