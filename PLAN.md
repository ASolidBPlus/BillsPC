# PLAN.md — Sprint 3a: Gen 1/2 save reader + Vite web demo (upload path)

## 1. Sprint contract

**Goal.** Stand up the `web/` workspace and a new `core/src/sav/` module so a
user can drop a real Gen 1 (RBY) or Gen 2 (GS/Crystal) `.sav` into a browser
tab, see their trainer + party + boxes, pick a non-refused mon, and download
a byte-exact `.pk3` produced by `convert()` + `packBoxed()`. The tool runs
fully client-side, zero network calls after the initial bundle load.

**Slicing decision: SPLIT into S3a (this sprint) + S3b (next sprint).**

Justification:
1. **Independence.** The save-reader + UI is a self-contained vertical: it
   consumes `core` (already shipped by S1/S2) and produces user-visible
   output. The Web Serial GBxCart adapter is a strictly orthogonal input
   path — file upload OR cart read — that plugs into the same UI surface
   later via a `Promise<Uint8Array>`.
2. **Risk profile differs.** S3a risk is in PKHeX-faithful save parsing
   (well-trodden offsets, two existing demo scripts to port) and in keeping
   a no-framework Vite bundle small. S3b risk is hardware: GBxCart RW
   firmware versions, Web Serial Chromium quirks, real-cart corruption
   modes, USB permissions UX. Mixing them inflates the FAIL surface and
   obscures the failure mode when one half breaks.
3. **DoD already satisfied by S3a alone.** The orchestrator-stated DoD is
   "real Gen 2 save in, real `.pk3` files out, in a browser." File upload
   meets that literally. Cart-read is a strict UX upgrade, not a DoD
   requirement.
4. **Browser fanout.** Web Serial is Chromium-only. Shipping S3a first
   means Firefox/Safari users never block on a feature they can't use; S3b
   then degrades gracefully to the upload path on those browsers.
5. **Sprint size budget.** S1 and S2 each took one Planner+Eval+Generator+
   Eval round. Combined S3 would risk a second fix-loop on hardware while
   the save-reader sits half-built. Smaller surface = tighter feedback.

**In scope (S3a).**
- `core/src/sav/` parsers for Pokemon Red/Blue (English RBY), Pokemon
  Yellow (English), Pokemon Gold/Silver (English), Pokemon Crystal
  (English). All US/EN; international saves are S3b+.
- Format autodetect by checksum + structural probes (no filename trust).
- Public `parseSave(bytes) → SaveContents | SaveError` returning trainer,
  party, all stored boxes, and the Gen 2 "current box" buffer where
  applicable. Mons are returned as the existing `Gen12Pokemon` type from
  `core/src/types/source.ts` so they feed straight into `convert()`.
- Internal-index → ndex translation table for Gen 1 (Gen 2 already uses
  dex order). Both directions exposed for tests.
- New `web/` workspace: Vite + vanilla TS + zero-framework UI. Drop zone,
  trainer card, party + box grid with sprite-less rows (text only this
  sprint — sprite assets are S3b+), per-mon convert button, "Convert all"
  zip, refusal badges, conversion warnings.
- Per-mon download: `<species>-<nickname>-<TID>.pk3` (sanitised filename).
- "Convert all" download: single `.zip` of every non-refused mon.
- Vitest tests for save parsing (golden offsets against the two demo
  scripts and the orchestrator's Crystal Feraligatr inline result).
- Bun-based build target: `web/dist/` static bundle, gzipped < 200 KB.

**Out of scope (deferred to S3b or later).**
- Web Serial GBxCart RW adapter (S3b).
- Sprite assets (S3b cosmetic).
- International (JP/FR/DE/IT/ES) save support.
- Save *writing* / Gen 3 save injection (S4).
- Multi-language UI strings.
- PKHeX legality validation harness in browser (S5+).

**Done when.** `bun install && bun test` is green across `core/`, `tests/`,
`web/`. `bun run --filter web build` produces a `web/dist/index.html` whose
total transferred size (HTML + JS + CSS, gzipped) is under 200 KB.
`parseSave()` reproduces the orchestrator's existing `demo-red.sav` party
and box readout byte-for-byte; `parseSave()` on `demo-crystal.sav`
reproduces the inline Feraligatr stats and produces `convert()` output with
total |dev| 117 (matching the orchestrator's prior inline run). Loading
either `.sav` in the browser, picking any non-refused mon, and clicking
"Convert" downloads a `.pk3` whose decrypted substructures match what
`packBoxed(convert(parseSave(bytes).party[i]))` produces in Node.

---

## 2. Directory layout

Do NOT touch existing S1/S2 code. Add the following.

```
core/src/
  sav/
    index.ts                # parseSave(); re-exports SaveContents, SaveError
    detect.ts               # detectFormat(bytes) → SaveFormat | null
    checksum.ts             # gen1Checksum(), gen2Checksum() — both algos
    gen1/
      parser.ts             # parseGen1(bytes, format) → SaveContents
      offsets.ts            # all RBY offset constants (party, boxes, OT, TID, name)
      yellowOffsets.ts      # Yellow-specific deltas from RB
      internalDex.ts        # INTERNAL_TO_NDEX + NDEX_TO_INTERNAL (port of demo)
      charmap.ts            # Gen 1/2 char decode (English) — re-uses tables in
                            # core/src/data/charmap12.ts where possible
    gen2/
      parser.ts             # parseGen2(bytes, format) → SaveContents
      offsetsGS.ts          # Gold/Silver offsets
      offsetsCrystal.ts     # Crystal offsets (TID 0x2009 BE, party 0x2865, etc.)
      sharedTimeBlock.ts    # Gen 2 time-played + RTC block helpers (used by
                            # checksum + detection)
  types/
    sav.ts                  # SaveContents, SaveError, SaveFormat enums

web/
  package.json              # name "@pokeportal/web", type: module, scripts:
                            #   "dev": "vite", "build": "vite build",
                            #   "preview": "vite preview", "test": "vitest run"
  tsconfig.json             # extends ../tsconfig.base.json, references ../core
  vite.config.ts            # base "./", build.target "es2022",
                            # build.modulePreload: false, brotliSize report
  index.html                # single page, <div id="app">
  public/
    favicon.svg             # 1 KB inline-svg ball icon
  src/
    main.ts                 # entry: mount controller(), wire DOM
    state.ts                # AppState type + reducer (see §6 state machine)
    controller.ts           # State machine driver; calls parseSave/convert/pack
    dom/
      dropZone.ts           # File / drag-drop input → Uint8Array
      trainerCard.ts        # render trainer name, TID, format badge
      monGrid.ts            # render party + boxes; per-mon row + buttons
      refusalBadge.ts       # render refusal reason inline
      warningPanel.ts       # render ConvertMetadata.warnings
    download.ts             # blobDownload(name, bytes); zipAll(items)
    filename.ts             # sanitiseFilename(species, nickname, tid)
    zip.ts                  # thin wrapper over fflate.zipSync
    style.css               # ~3 KB; system fonts; CSS grid; no resets framework

tests/
  unit/
    sav-detect.test.ts            # all four formats + corruption + truncation
    sav-checksum.test.ts          # gen1/gen2 checksum bit-exact
    sav-gen1-red.test.ts          # uses scripts/demo-red.sav as fixture
    sav-gen2-crystal.test.ts      # uses scripts/demo-crystal.sav as fixture
    sav-gen1-internal-dex.test.ts # bidirectional table consistency
  integration/
    sav-convert-roundtrip.test.ts # parseSave→convert→packBoxed for every
                                  # party + box mon in both fixtures; assert
                                  # Crystal Feraligatr |dev| sum == 117
  fixtures/
    demo-red.sav.note.txt         # points at scripts/demo-red.sav (do NOT
                                  # duplicate — symlink or path constant)
    demo-crystal.sav.note.txt     # ditto

web/src/__tests__/                # vitest, jsdom env
  state.test.ts                   # reducer transitions
  filename.test.ts                # sanitisation; collisions; max length
  zip.test.ts                     # zipAll deterministic ordering
```

Rationale: `core/src/sav/` is a peer of `pack/`, `convert/`, `fields/`. It
imports from `data/` (existing) and `types/` (existing) but is never
imported *by* the conversion path — it is strictly an input adapter, so
the shape is "parser → existing `Gen12Pokemon` → existing `convert()` →
existing `packBoxed()`." Subdirectories `gen1/` and `gen2/` keep the
offset tables auditable in isolation; the demo scripts already debugged
the RBY offsets, so the port is mechanical. `web/` is a separate
workspace so the `core` build remains zero-runtime-dep and the bundle
analyser scopes cleanly.

---

## 3. Public interfaces

All signatures are types-only. Bodies are the Generator's job.

### 3.1 Save reader (`core/src/types/sav.ts`)

```ts
export type SaveFormat =
  | 'GEN1_RB_EN'    // Pokemon Red / Blue (English)
  | 'GEN1_Y_EN'     // Pokemon Yellow (English)
  | 'GEN2_GS_EN'    // Pokemon Gold / Silver (English)
  | 'GEN2_C_EN';    // Pokemon Crystal (English)

export interface TrainerInfo {
  readonly name: string;          // decoded with format-appropriate charmap
  readonly nameBytes: Uint8Array; // raw bytes preserved for downstream OT
  readonly tid: number;           // 0..65535
  readonly playTime?: { hours: number; minutes: number; seconds: number };
  readonly money?: number;        // Gen 1 BCD or Gen 2 24-bit BE
  readonly gender?: 0 | 1;        // Crystal only; undefined elsewhere
}

export interface SaveContents {
  readonly format: SaveFormat;
  readonly trainer: TrainerInfo;
  readonly party: readonly Gen12Pokemon[];
  readonly boxes: readonly (readonly Gen12Pokemon[])[]; // length 12 (Gen1) or 14 (Gen2)
  readonly currentBox?: readonly Gen12Pokemon[];        // Gen 1 0x30C0 / Gen 2 live box
  readonly currentBoxIndex?: number;                    // 0-based index into boxes[]
  readonly warnings: readonly string[];                 // non-fatal: e.g. checksum mismatch
}

export type SaveErrorReason =
  | 'unknown_format'
  | 'truncated'
  | 'checksum_mismatch_fatal'
  | 'invalid_party_count'
  | 'invalid_box_count'
  | 'corrupt_pokemon_record';

export interface SaveError {
  readonly _tag: 'SaveError';
  readonly reason: SaveErrorReason;
  readonly message: string;
  readonly detected?: SaveFormat;   // if detection succeeded but parse failed
  readonly offset?: number;         // byte offset of the failure when known
}

export const isSaveError: (x: unknown) => x is SaveError;
```

### 3.2 Save reader entry (`core/src/sav/index.ts`)

```ts
export function parseSave(bytes: Uint8Array): SaveContents | SaveError;
export function detectFormat(bytes: Uint8Array): SaveFormat | null;
export type { SaveContents, SaveError, SaveFormat, TrainerInfo } from '../types/sav.js';
```

### 3.3 Top-level `core/src/index.ts` additions

```ts
// Sprint 3a save reader.
export { parseSave, detectFormat, isSaveError } from './sav/index.js';
export type { SaveContents, SaveError, SaveFormat, TrainerInfo } from './types/sav.js';
```

No existing exports change. No existing types are modified.

### 3.4 Web app entry (`web/src/main.ts`)

```ts
// No exported API — this is an application entry, not a library.
// Single side-effecting bootstrap:
//   1. Acquire #app element.
//   2. Construct Controller(rootEl, deps) with default deps:
//      { parseSave, convert, packBoxed, isRefusal, isSaveError }.
//   3. Controller wires drop zone, dispatches to reducer.
```

### 3.5 Web reducer (`web/src/state.ts`)

```ts
export type AppState =
  | { kind: 'idle' }
  | { kind: 'parsing'; fileName: string; size: number }
  | { kind: 'parse_error'; fileName: string; error: SaveError }
  | { kind: 'loaded'; fileName: string; save: SaveContents;
      selection: ReadonlySet<MonRef>;
      results: ReadonlyMap<string, ConvertResult>; }; // keyed by monRefKey
export type ConvertResult =
  | { ok: true; bytes: Uint8Array; meta: ConvertMetadata; suggestedName: string }
  | { ok: false; refusal: Refusal };

export type Action =
  | { type: 'file_selected'; file: File }
  | { type: 'file_parsed'; save: SaveContents; fileName: string }
  | { type: 'file_failed'; error: SaveError; fileName: string }
  | { type: 'mon_toggled'; ref: MonRef }
  | { type: 'convert_one'; ref: MonRef }
  | { type: 'convert_all' }
  | { type: 'convert_done'; ref: MonRef; result: ConvertResult }
  | { type: 'reset' };

export interface MonRef {
  readonly bucket: 'party' | 'box' | 'currentBox';
  readonly boxIndex?: number;     // for 'box'
  readonly slot: number;          // 0-based within bucket
}
export const monRefKey: (r: MonRef) => string;
export const reducer: (state: AppState, action: Action) => AppState;
```

---

## 4. Algorithm decomposition

### 4.1 Format detection (`core/src/sav/detect.ts`)

Order of checks (return first match):

1. **Length triage.** Reject if `bytes.length < 0x8000` (smallest plausible
   Gen 1 save). Accept 0x8000 (32 KB Gen 1) and 0x8000–0x20000 (Gen 2 saves
   are 32 KB; some emulators pad to 128 KB — accept and ignore tail).
2. **Gen 2 Crystal probe.** Read u16-LE checksum at `0x2D69`; recompute
   over `0x2009..0x2B82` (additive sum of bytes, mod 0x10000, per
   pokecrystal `Checksum`). Match → `GEN2_C_EN`.
3. **Gen 2 GS probe.** Same algorithm but checksum at `0x2D69` over
   `0x2009..0x2D68` for GS. Pret/pokegold disasm: primary checksum at
   `0x2D69`, backup at `0x7E6D`. Match → `GEN2_GS_EN`.
4. **Gen 1 RB probe.** Compute Gen 1 checksum (`0xFF - (sum of bytes
   0x2598..0x3522) & 0xFF`); compare to byte at `0x3523`. Match plus
   Yellow-specific Pikachu friendship byte at `0x271C` is in `[0..255]`
   AND Yellow magic at `0x6F0` differs → `GEN1_RB_EN`.
5. **Gen 1 Yellow probe.** Same checksum location and algorithm; Yellow
   is detected by Pikachu's friendship byte at `0x2A4D` being non-zero
   structurally (or, more reliably, the absence of a stored TM count at
   the RB-specific offset). The most reliable single-bit discriminator
   per pret/pokeyellow is the presence of the Pikachu structure at
   `0x2A4C`. Match → `GEN1_Y_EN`.
6. **No match.** Return `null`; caller produces `SaveError(unknown_format)`.

If checksum mismatches but structural probes succeed, return the format
anyway and surface a warning — corrupt saves still need to be parsed
where possible (the Crystal demo we already loaded had a correct
checksum, but emulator save-state exports are routinely off by one).

### 4.2 Gen 1 parser (`core/src/sav/gen1/parser.ts`)

Direct port of `scripts/demo-red-stat-check.ts` + `scripts/demo-red-boxes.ts`.
The demo offsets are already debugged; we replicate them and add Yellow
deltas. Key offsets (RB, English):

| Field | Offset | Size | Notes |
|---|---|---|---|
| Player name | `0x2598` | 11 | charmap12 decode |
| TID (BE) | `0x2605` | 2 | big-endian |
| Money (BCD) | `0x25F3` | 3 | BCD, 3 bytes = 6 digits |
| Party count | `0x2F2C` | 1 | 0..6 |
| Party species list | `0x2F2D` | 6 | terminator `0xFF` |
| Party records | `0x2F34` | 44 × 6 | per-mon, 44 bytes |
| Party OT names | `0x303F` | 11 × 6 | charmap12 |
| Party nicknames | `0x30A5` | 11 × 6 | charmap12 |
| Current PC box | `0x30C0` | 1122 | live working box |
| Stored boxes 1–6 | `0x4000` | 1122 × 6 | bank 2 |
| Stored boxes 7–12 | `0x6000` | 1122 × 6 | bank 3 |
| Checksum | `0x3523` | 1 | `0xFF - (sum 0x2598..0x3522) & 0xFF` |

Per-party-mon record layout (44 bytes, per demo offsets):

```
0x00 species_internal     u8     → INTERNAL_TO_NDEX
0x01 currentHP            u16-BE
0x03 (level shadow)       u8     (party only; box uses 0x03=level)
0x04 status               u8
0x05 type1                u8
0x06 type2                u8
0x07 catchRate            u8
0x08 moves[4]             u8 × 4
0x0C otTid                u16-BE
0x0E exp                  u24-BE
0x11 statExp.hp           u16-BE
0x13 statExp.atk          u16-BE
0x15 statExp.def          u16-BE
0x17 statExp.spe          u16-BE
0x19 statExp.special      u16-BE
0x1B dvWord               u16-BE  → atk(15..12) def(11..8) spe(7..4) spc(3..0)
0x1D pp[4]                u8 × 4  (low 6 = current PP, high 2 = PP Ups)
0x21 level (party copy)   u8
0x22 cachedStats[5]       u16-BE × 5  (hp, atk, def, spe, spc)
```

Box-mon record layout (33 bytes): identical fields up through 0x1F, then
no cached stats. Level lives at `0x03` for box records (not `0x21`).

Yellow deltas (`yellowOffsets.ts`): nothing material for this sprint
beyond detection. Yellow's Pikachu friendship is at `0x2A4D` but is not
exposed to convert — it would be Pikachu-specific and Yellow-Pikachu
isn't an OT-bound mon. Skip it.

Gen 1 → Gen2 representation: build a `Gen12Pokemon` with `sourceGen: 1`,
`speciesGen2Id: ndex`, `heldItemGen2Id: null`, `friendship: null`,
`pokerusByte: 0`, `language: 2` (English). Derive PP / PP Ups from the
masked/shifted byte. `ppUps[]` for Gen 1 is always `[0,0,0,0]`.

Edge cases:
- Empty party slots: skip species id 0 / 0xFF.
- Box overflow: if count byte > 20, surface `invalid_box_count` for *that
  box* but continue parsing siblings. Do not abort the entire save.
- Unknown internal species: include the mon with `speciesGen2Id: 0` and
  add a warning; the UI shows it as "unknown species" and disables the
  convert button.

### 4.3 Gen 2 parser (`core/src/sav/gen2/parser.ts`)

Crystal layout (per the orchestrator's inline demo and pret/pokecrystal):

| Field | Offset | Size | Notes |
|---|---|---|---|
| Player name | `0x200B` | 11 | charmap12 |
| TID (BE) | `0x2009` | 2 | big-endian |
| Money | `0x23DB` | 3 | 24-bit BE |
| Gender | `0x3E3D` | 1 | Crystal only |
| Party count | `0x2865` | 1 | 0..6 |
| Party species | `0x2866` | 7 | terminator `0xFF` |
| Party records | `0x286D` | 48 × 6 | per-mon 48 bytes |
| Party OT names | `0x298D` | 11 × 6 | |
| Party nicknames | `0x29CF` | 11 × 6 | |
| Current box index | `0x2724` | 1 | 0..13 |
| Current box data | `0x2D6C` | 1104 | live working box (20 × 32 + 64) |
| Stored boxes 1–7 | `0x4000` | 1104 × 7 | bank 2 |
| Stored boxes 8–14 | `0x6000` | 1104 × 7 | bank 3 |
| Checksum | `0x2D69` | 2 | additive u16 over `0x2009..0x2B82` |

GS deltas (`offsetsGS.ts`): TID at `0x2009` (same), party count at
`0x288A`, party records at `0x2892`, OT names at `0x29B2`, nicknames at
`0x29F4`, current box at `0x2D10`, stored boxes at the same bank
addresses. Checksum at `0x2D69` covering `0x2009..0x2D68`. Source:
pokegold disasm.

Gen 2 box-mon record (32 bytes — mons in storage; party adds 16 bytes
for status/cached stats):

```
0x00 species              u8     (Gen 2 uses dex order natively; no map)
0x01 heldItem             u8
0x02 moves[4]             u8 × 4
0x06 otTid                u16-BE
0x08 exp                  u24-BE
0x0B statExp.hp           u16-BE
0x0D statExp.atk          u16-BE
0x0F statExp.def          u16-BE
0x11 statExp.spe          u16-BE
0x13 statExp.special      u16-BE
0x15 dvWord               u16-BE → atk/def/spe/spc nibbles
0x17 pp[4]                u8 × 4 (low 6 PP, high 2 PP Ups)
0x1B friendship           u8
0x1C pokerus              u8
0x1D caughtData           u16-BE (location 7 bits, time 2, level 6, gender/OT 1)
0x1F level                u8
```

Party record adds 16 bytes (status, unused, currentHP, maxHP+stats) at
0x20..0x2F.

Edge cases:
- Egg species (0xFD): include but flag as `egg_unsupported` warning;
  conversion eligibility is "not breedable" per HANDOFF §4.0 — the
  refusal will fire downstream regardless.
- Time Capsule mons: Gen 2 mons originally caught in Gen 1 are
  indistinguishable in storage layout from native Gen 2 mons. Treat them
  identically.

### 4.4 Internal-index translation (`core/src/sav/gen1/internalDex.ts`)

Lift the table verbatim from `scripts/demo-red-stat-check.ts` (lines
16–165) into a typed const. Add an inverse table generated at module
init by iterating the forward map (one-time work, ~150 entries). Export
both. Test: every key in forward maps back to itself via inverse.

### 4.5 String decoding

Reuse `core/src/data/charmap12.ts` (S1-shipped) for the byte → string
decode. Add a `decodeUntilTerminator(bytes, terminators = [0x50, 0xFF, 0x00])`
helper in `core/src/sav/gen1/charmap.ts` and a Gen 2 sibling (Gen 1 and
Gen 2 share charmap12 for English). The OT name and nickname `Uint8Array`s
must be passed unmodified into `Gen12Pokemon` so the existing
`fields/strings.ts` (S1) round-trips them on the convert side.

### 4.6 Error handling

Two-level taxonomy:

- **Fatal** → return `SaveError`. Examples: file < 0x8000, no format
  detected, party count > 6, every box count > 20.
- **Non-fatal** → push to `warnings: string[]` and continue. Examples:
  one box has invalid count (skip that box), one mon's species is
  unknown (include as opaque, downstream rejects), checksum mismatch but
  structure parses cleanly.

The reducer surfaces `warnings` in a yellow panel under the trainer
card; the user can still convert valid mons.

---

## 5. Save-format detection details

| Format | Length probe | Primary checksum | Secondary signal |
|---|---|---|---|
| GEN1_RB_EN | == 0x8000 | `[0x3523] == 0xFF - sum(0x2598..0x3522)` | absence of Yellow Pikachu block |
| GEN1_Y_EN | == 0x8000 | same | presence of Pikachu block @ 0x2A4C |
| GEN2_GS_EN | 0x8000+ | u16-LE @ 0x2D69 == sum(0x2009..0x2D68) & 0xFFFF | game-version byte |
| GEN2_C_EN | 0x8000+ | u16-LE @ 0x2D69 == sum(0x2009..0x2B82) & 0xFFFF | game-version byte |

**Crystal vs GS disambiguation.** Crystal's checksum range is shorter
and the secondary checksum at `0x1F0D` (Crystal) vs `0x7E6D` (GS) covers
the alternate save bank. We probe Crystal first because it has the
narrower checksum range — if Crystal's checksum validates, we are
unambiguously Crystal; otherwise fall through to GS.

**RB vs Yellow disambiguation.** Both have identical checksum layout.
Yellow's distinguishing structure is the Pikachu friendship/data block
at `0x2A4C`-ish; RB stores game-corner coins there. The cleanest
discriminator per pret is the byte at `0x271C` (Yellow Pikachu happiness
non-zero on any played save). Combine with absence of RB-specific TM
inventory checksum byte. If both probes are ambiguous (e.g., a brand
new Yellow save with zero Pikachu friendship), default to RB and surface
a warning — conversion semantics are identical for the two games.

**Corruption handling.** If length triage passes but no checksum
matches, run all four structural probes (party count in valid range,
trainer name decodes to printable chars). If exactly one structural
probe passes, return that format with `warnings: ['checksum_mismatch']`.
If multiple or none pass, return `unknown_format`.

---

## 6. Web UI design

### 6.1 Stack and dependencies

- **Vite** 5.x. `build.modulePreload: false` to keep one JS file.
- **No framework.** Vanilla TS DOM manipulation; one tiny render-on-state
  pattern per component. Total source ~600 lines.
- **fflate** for zip generation. Chosen over JSZip: ~30 KB minified vs
  ~95 KB; synchronous API; tree-shakeable; we only use `zipSync`.
- **No CSS framework.** Hand-rolled CSS (~3 KB). System font stack.
- **Bundle target.** ES2022, single chunk, no preload, no legacy. The
  dev plan tracks bundle size in CI: `bun run --filter web build &&
  ls -l web/dist/assets/*.js | awk` style check, fails if gzipped > 200 KB.

`web/package.json` deps:
- `vite` (devDep)
- `vitest` + `@vitest/ui` + `jsdom` (devDep)
- `fflate` (dep, runtime)
- `@pokeportal/core` (workspace dep)

### 6.2 State machine

```
                    ┌──────┐
                    │ idle │
                    └──┬───┘
                       │ file_selected
                       ▼
                  ┌─────────┐
                  │ parsing │
                  └──┬──────┘
              ┌─────┴─────┐
   file_parsed│           │file_failed
              ▼           ▼
        ┌────────┐   ┌─────────────┐
        │ loaded │   │ parse_error │
        └───┬────┘   └─────┬───────┘
            │              │ reset
       (mon_toggled,       ▼
        convert_one,    (idle)
        convert_all,
        convert_done — all stay in 'loaded')
            │ reset
            ▼
          (idle)
```

`loaded` carries an immutable `selection: Set<MonRef>` and an immutable
`results: Map<string, ConvertResult>`. Every action returns a new state
object; the renderer diffs on identity.

### 6.3 Render shape

Single full-page render after each transition, no virtual DOM. Three
top-level regions:

```
┌────────────────────────────────────────────────────────────┐
│  pokeportal — drop a Gen 1/2 save here                    │
├────────────────────────────────────────────────────────────┤
│  Trainer:  RED                  TID: 12345    [GEN1_RB_EN]│
│  Warnings: 0                                               │
├────────────────────────────────────────────────────────────┤
│  PARTY (5)                                                 │
│  ▢ CLEFAIRY  Lv 14  ♂   [Convert] [.pk3]                  │
│  ▢ FEAROW    Lv 31  ♀   [Convert]                          │
│  ▢ MEW       Lv 10      [REFUSED: undiscovered_egg_group] │
│                                                            │
│  BOX 1 (12)         [expand]                               │
│  ...                                                       │
├────────────────────────────────────────────────────────────┤
│  [Convert all] [Reset]    Total: 47 mons, 2 refused        │
└────────────────────────────────────────────────────────────┘
```

No images this sprint. Boxes are collapsed by default; expand toggles
per-box. Refused mons render in muted text with the refusal reason
visible inline; "Convert all" silently skips them.

### 6.4 Conversion flow

1. User clicks "Convert" on a mon → dispatch `convert_one`.
2. Controller runs `convert(mon)` synchronously. If `isRefusal(result)`,
   store a `{ ok: false, refusal }` result.
3. Else run `packBoxed(intermediate)` → `Uint8Array(80)`.
4. Build `suggestedName = sanitiseFilename(species, nickname, tid)`.
5. Store `{ ok: true, bytes, meta: result._meta, suggestedName }`.
6. Re-render; the row now shows `[Download]`. Click triggers
   `download.ts blobDownload(name, bytes)` (Object URL + anchor click +
   revoke).

`Convert all` iterates every non-refused mon (party, boxes, currentBox,
deduplicated by `monRefKey`), bundles into `fflate.zipSync({...})`,
downloads as `<trainer>-<TID>-pk3-bundle.zip`.

### 6.5 Filename sanitisation (`web/src/filename.ts`)

```
sanitiseFilename(speciesName: string, nickname: string, tid: number)
  → `${species}-${nickname || 'no-nickname'}-${tid}.pk3`
```

Replace any char outside `[A-Za-z0-9-_.]` with `-`. Collapse runs of `-`.
Truncate the species+nickname portion to 64 chars total. If the cleaned
nickname is empty (Gen 1 default nicknames are uppercase species names —
keep those), substitute `'no-nickname'`. Test: collisions across two mons
with same species/nickname/TID produce identical filenames; the zip path
prepends a slot index `${i.toString().padStart(3,'0')}-` to keep zip
entries unique.

### 6.6 Bundle target enforcement

CI step in `.github/workflows/ci.yml` (extended):

```yaml
- name: Build web
  run: bun run --filter web build
- name: Check bundle size
  run: |
    SIZE=$(gzip -c web/dist/assets/*.js | wc -c)
    echo "JS gzipped: $SIZE bytes"
    test "$SIZE" -lt 204800
```

Soft target 200 KB; hard fail at 200 KB. If we bust it, the budget
sequence is: drop fflate → switch to a custom 100-line zip writer (zips
of `.pk3` files are stored, no compression needed since `.pk3` is already
encrypted random-ish bytes); then strip `playTime` rendering; then
collapse box rendering to a single flat list.

---

## 7. Web Serial adapter

**Deferred to Sprint 3b.** PLAN.md for S3b will cover GBxCart RW
protocol port (insideGadgets command set), Web Serial permission flow,
ROM-vs-SRAM probe, save read with progress callback, and graceful
fallback to upload UI. The S3a UI exposes a `<input type="file">` only;
the S3b UI will add a `[Read from cart]` button next to it that swaps in
an alternative `Promise<Uint8Array>` source feeding the same reducer.

---

## 8. Test matrix

### 8.1 Unit tests (`tests/unit/`)

| File | Coverage |
|---|---|
| `sav-detect.test.ts` | All 4 formats detected from real fixtures; truncated buffer (< 0x8000) returns null; corrupted-but-structural returns format with warning; pure-zero buffer returns null |
| `sav-checksum.test.ts` | Gen 1 RB checksum matches `demo-red.sav[0x3523]`; Gen 2 Crystal checksum matches `demo-crystal.sav` u16-LE @ 0x2D69; checksum recomputation idempotent (parse → recompute → equal) |
| `sav-gen1-red.test.ts` | Trainer name `"BLUE"` (or whatever the demo prints — verify against `bun run scripts/demo-red-stat-check.ts` output), TID matches; party count matches; first party mon's species/level/DVs/StatExp match the demo output exactly |
| `sav-gen2-crystal.test.ts` | Trainer + TID match; party Feraligatr's species 160, Lv from inline demo, DVs/StatExp byte-identical to the orchestrator's prior inline run |
| `sav-gen1-internal-dex.test.ts` | Forward table has 151 entries; every (internal, ndex) pair survives forward+inverse round-trip; ndex 152 etc. are absent |

### 8.2 Integration tests (`tests/integration/`)

| File | Coverage |
|---|---|
| `sav-convert-roundtrip.test.ts` | For every non-refused mon in `demo-red.sav` party + all 12 boxes: `parseSave → convert → packBoxed → unpackBoxed` round-trips to an intermediate that matches `convert(parseSave(...))` directly; for `demo-crystal.sav` Feraligatr specifically, assert total \|dev\| sum across the six stats == 117 against the orchestrator's recorded baseline |

### 8.3 Web tests (`web/src/__tests__/`, vitest jsdom)

| File | Coverage |
|---|---|
| `state.test.ts` | All reducer transitions are pure; identity-stable for no-op actions; selection toggle is order-independent; convert_done with same ref overwrites previous |
| `filename.test.ts` | Special chars stripped; empty nickname → `no-nickname`; truncation at 64 chars; deterministic across calls |
| `zip.test.ts` | Empty input → valid empty zip; ordering of entries deterministic by `monRefKey`; output parses back via fflate.unzipSync |

### 8.4 Manual verification (documented in EVAL)

- Open `web/dist/index.html` in Chrome 120+, drop `demo-crystal.sav`,
  click Convert on Feraligatr, verify the downloaded `.pk3` is exactly
  80 bytes and decrypts (via Node `unpackBoxed`) to the intermediate
  whose stats reproduce `|dev| sum == 117`.
- Same flow in Firefox 124+.
- Drop `demo-red.sav`, expand Box 1, convert all party + box mons via
  "Convert all", verify the downloaded zip contains one `.pk3` per
  non-refused mon.

### 8.5 Fixture handling

`tests/fixtures/sav-fixtures.ts` exports:
```ts
export const demoRedPath  = path.resolve(__dirname, '../../scripts/demo-red.sav');
export const demoCrystalPath = path.resolve(__dirname, '../../scripts/demo-crystal.sav');
```
Tests `readFileSync` from these paths. Do NOT copy the binaries; the
demo savs are the canonical fixtures.

---

## 9. Success criteria (objective pass/fail)

The Code Evaluator MUST mark each criterion as PASS, FAIL, or PARTIAL
with a verification command. Failure of any criterion => sprint FAIL.

1. **CORE-PARSE-RED:** `bun test tests/unit/sav-gen1-red.test.ts` exits 0;
   parsed party count, species, levels, DVs, StatExp, OT name, TID, and
   nicknames bit-equal what `bun run scripts/demo-red-stat-check.ts` prints.
2. **CORE-PARSE-CRYSTAL:** `bun test tests/unit/sav-gen2-crystal.test.ts`
   exits 0; parsed Feraligatr DVs, StatExp, level, OT name, TID match the
   orchestrator's prior inline Crystal demo output.
3. **CORE-CONVERT-CRYSTAL:** `bun test tests/integration/sav-convert-roundtrip.test.ts`
   asserts `convert(parseSave(crystal).party[<feraligatr-slot>])` produces
   IVs/EVs/nature whose Gen 3 stats yield total \|dev\| sum == 117 against
   the source Gen 2 Feraligatr stats.
4. **CORE-CONVERT-RED-PARTY:** Every non-refused mon in `demo-red.sav` party
   round-trips `parseSave → convert → packBoxed → unpackBoxed` without
   throw; each unpack matches the original convert intermediate (deep equal
   on all fields except the random IV bits, which the seeded RNG fixes).
5. **CORE-CONVERT-RED-BOXES:** Every non-refused mon across all 12 stored
   boxes + the current PC box round-trips identically; refusals are
   counted and reported.
6. **CORE-DETECT:** `parseSave` correctly identifies all four fixture
   formats by byte content alone (filename ignored); a mangled buffer
   returns `SaveError(unknown_format)`.
7. **WEB-BUILD:** `bun run --filter web build` exits 0; produces a single
   `web/dist/assets/*.js`; `gzip -c` of that file is < 200 KB.
8. **WEB-UNIT:** `bun run --filter web test` exits 0 (state machine,
   filename, zip).
9. **WEB-DOWNLOAD:** Manual verification — drop `demo-crystal.sav` in
   `bun run --filter web preview`, click Convert on Feraligatr, the
   downloaded `.pk3` is 80 bytes and `unpackBoxed` (Node) on those bytes
   round-trips to the same intermediate the in-browser convert produced.
10. **WEB-CONVERT-ALL:** "Convert all" on `demo-red.sav` produces a zip
    containing one `.pk3` per non-refused mon; entry count == party
    non-refused + sum(box non-refused) + currentBox non-refused, with no
    duplicates.
11. **TYPECHECK + LINT:** `bun run typecheck && bun run lint` is green
    across all workspaces.
12. **NO REGRESSION:** All S1 + S2 tests still pass.

---

## 10. Open questions for the Plan Evaluator

1. **GS support — ship in S3a or defer?** Recommendation: ship. The GS
   parser is a 30-line offset-table delta on Crystal; testing it costs
   one additional fixture (which we'd need to acquire — orchestrator has
   only Crystal). If no GS fixture is available, ship the parser
   untested behind a feature flag and surface "GEN2_GS_EN: untested
   format" warning. **Evaluator decision needed:** ship-tested,
   ship-untested-with-warning, or defer to S3b.
2. **Yellow support — same question.** Same recommendation; same
   fixture concern. The RB/Yellow split is even smaller than GS/Crystal.
3. **fflate vs JSZip vs hand-rolled.** PLAN picks fflate. Evaluator may
   force hand-rolled if bundle size budget is tight, but at ~30 KB
   fflate fits comfortably under 200 KB.
4. **Fixture location.** PLAN reuses `scripts/demo-*.sav` directly.
   Alternative is to move them into `tests/fixtures/saves/` and update
   the demo scripts. Reuse is simpler and leaves the demos working;
   if Evaluator objects on cleanliness grounds we move them and add a
   compat shim in the demo paths.
5. **Box ordering.** Gen 2 stores the *current* box separately from the
   numbered boxes. The current box also has a number (current_box_index).
   PLAN exposes both `boxes[]` (always 12 or 14 entries representing the
   numbered slots, possibly stale for the current-box slot) and
   `currentBox` (live data). UI prefers `currentBox` for display when
   `currentBoxIndex` matches a box. Evaluator should confirm this is the
   right API shape vs the alternative "merge currentBox over boxes\[idx\]
   automatically inside parseSave."
6. **Sprite handling.** PLAN ships text-only. Evaluator may want sprites
   in S3a — if so, vendor the 80×80 PNG sprite sheets from PokeAPI,
   sprite-sheet single image, +~40 KB to bundle. Recommend defer to S3b.
7. **Internationalisation.** All charmaps are English-only. Evaluator
   should confirm we're OK leaving JP/EU saves to a future sprint.
8. **Web Serial adapter shape.** Even though S3b ships the implementation,
   PLAN should freeze the *interface* now so S3a UI doesn't bake in
   assumptions. Proposed: `interface SaveSource { read(): Promise<Uint8Array>;
   readonly kind: 'file' | 'serial'; readonly label: string; }`. Evaluator
   should sign off so S3a can use this as the controller's input port.

---

## 11. Out of scope for S3a

Explicit non-goals (do not let scope creep here):

- **Web Serial / GBxCart RW.** S3b.
- **Save *writing*** (modifying the source `.sav`). S4+ if ever.
- **Gen 3 save injection** (placing converted mons into a `.sav3`). S4.
- **Cart hardware bring-up.** Out of project entirely.
- **Multi-language UI.** English only.
- **JP/FR/DE/IT/ES save format support.** Charmap and TID size
  differences require a separate planning pass.
- **Sprites and animations.** S3b cosmetic.
- **Drag-reorder, edit, save-back-to-sav.** Out of scope; this is a
  one-way export tool.
- **PWA / service-worker / offline-first manifest.** The bundle is small
  enough to load instantly; PWA is a polish pass.
- **Telemetry / analytics.** Never. Hard rule.
- **Server-side anything.** The whole tool is static-hosted.
- **Gen 2 Pokemon Stadium / Stadium 2 transfer pak save formats.** Out.
- **Battery-dead cart save recovery (zeros / 0xFF saves).** Out.
- **Hidden Power-aware IV preservation re-runs.** Already explicitly
  rejected in HANDOFF §4.5; do not revisit.
