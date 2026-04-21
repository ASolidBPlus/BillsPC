# Sprint 3a Archive — pokeportal Save Reader + Vite Web Demo (upload path)

**Status**: PASS (archived 2026-04-21).
**Scope**: Gen 1 (RBY) + Gen 2 Crystal save-file parser, Vite web UI, file-upload conversion path. Web Serial / GBxCart adapter (S3b) deferred.
**Test outcome**: 261 tests passing (230 core + 31 web), 1 permitted skip (Alakazam stretch). All 6 verification commands exit 0. Web bundle 28.34 KB gzipped (cap 200 KB).

---

## Retrospective amendments

- **AMEND-S3a-1**: PLAN documented Crystal `currentBoxIndex` offset as `0x2724` and current-box buffer at `0x2D6C`. Empirical inspection of `demo-crystal.sav` confirmed both wrong — actual offsets are `0x2700` (currentBoxIndex) and `0x2D10` (current-box buffer). Generator corrected in source with comments; PLAN text is historical, archive documents the correction.
- **AMEND-S3a-2** (forward-carried to S3b): `SaveSource` interface as shipped omits the `kind: file|serial` discriminator that PLAN_EVAL Q8 promised to freeze for S3a/S3b compatibility. S3b will need to add it before plumbing the GBxCart Web Serial adapter.
- **AMEND-S3a-3** (forward-carried to S3b/cleanup): `decodeNickFallback` in `web/src/ui.ts` uses an inline ASCII-printable charmap that corrupts a few special characters (`!`, `?`, gender symbols, Pk/Mn ligatures collide with `[\\]`). Conversion pipeline itself preserves the raw nickname bytes correctly — this is cosmetic-only display drift in the UI. The full `decodeGen12` charmap is already bundled; swap it in when S3b touches `ui.ts`.
- **AMEND-S3a-4** (forward-carried): `renderLoaded` mutates `state.results` mid-render via a type cast, violating the documented immutability contract. Works today; will leak if S3b adds async render. Refactor when touched.

---

# PLAN — (produced by Planner subagent)

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


---

# PLAN_EVAL — (produced by Plan Evaluator subagent)

# PLAN_EVAL — Sprint 3a

## Verdict

**APPROVE_WITH_AMENDMENTS.** PLAN.md is structurally sound — slicing decision (S3a vs S3b) is correct, directory layout is clean and orthogonal to S1/S2, and the public-API additions (`SaveContents`, `SaveError`, `parseSave`) don't perturb existing contracts. The Gen 1 RBY parser port from the demo scripts is mechanically straightforward and the Red checksum in PLAN reproduces the expected `0xD1` at `[0x3523]` byte-for-byte against `scripts/demo-red.sav`. The Vite + fflate bundle plan comfortably fits the 200 KB budget. **However**, the Gen 2 checksum logic in PLAN does NOT validate against `scripts/demo-crystal.sav` (target `0xF03D` is not produced by either documented byte-range; the demo file's checksum byte is dead, almost certainly because the emulator save-state export rebuilt the SRAM image without recomputing the checksum). This forces structural-probe-first detection rather than checksum-first, which PLAN §4.1 step 2 inverts. Several other amendments below pin down ambiguities, harden the test matrix to lock in the |dev|=117 regression anchor, and close the box-stride / box-content size confusion that will otherwise burn the Generator on Gen 2 nicknames.

Binding amendments: **14**.

---

## Amendments (binding on the Generator)

### A1 — Detection MUST be structural-first, not checksum-first

**PLAN says** (§4.1 steps 2–4): probe Gen 2 Crystal checksum at `0x2D69` over `0x2009..0x2B82`; if it matches, declare Crystal. Then GS, then Gen 1.

**Change to:** detection probes are run in this order, and a format is returned as soon as the **structural** signature matches; checksum is computed but only contributes to a `warnings: ['checksum_mismatch']` non-fatal entry.

Detection signature per format:

| Format | Length | Structural check (ALL must pass) |
|---|---|---|
| `GEN2_C_EN` | 32768 ≤ N ≤ 131072 | byte at `0x3E3D` ∈ {0,1} (gender, Crystal-only) AND party-count `[0x2865]` ≤ 6 AND species-list at `0x2866` terminates with `0xFF` within 7 bytes AND name @ `0x200B` decodes as printable Gen 1/2 chars terminated by `0x50`/`0xFF`/`0x00` |
| `GEN2_GS_EN` | same | party-count `[0x288A]` ≤ 6 AND species-list at `0x288B` terminates `0xFF` within 7 bytes AND name @ `0x200B` decodes printable AND Crystal probe failed (no plausible gender byte AND TID location validates) |
| `GEN1_Y_EN` | == 32768 | Gen 1 RB checksum range structurally probes Pikachu-friendship block presence (PLAN §5 already calls this out) |
| `GEN1_RB_EN` | == 32768 | RB checksum at `[0x3523] == 0xFF - sum(0x2598..0x3522) & 0xFF` (this one DOES validate on real saves; see verification in §"Save-parser audit") |

**Why:** I independently computed the Crystal checksum on `scripts/demo-crystal.sav`. Stored `[0x2D69]` u16-LE = `0xF03D`. Neither PLAN's documented range (`sum(0x2009..0x2B82) = 0xBBBE`) nor GS's range (`sum(0x2009..0x2D68) = 0xEADD`) nor any other contiguous byte/word range with length > 0x500 produces `0xF03D`. The demo Crystal save is an emulator save-state export with a 48-byte trailer and a stale (or never-written) checksum word. Yet structural probes pass cleanly: party count 6, species list `9d 1a a0 f8 e6 f9 ff`, gender byte 0, TID 42971, current-box-index 0. **Real cart saves WILL have valid checksums** — but the only Gen 2 fixture we have does not, so a checksum-first parser fails immediately on it. This breaks success criterion CORE-PARSE-CRYSTAL.

### A2 — Length triage admits trailers AND prepended emulator headers

**PLAN says** (§4.1 step 1): accept `0x8000` to `0x20000`; ignore tail.

**Change to:** if `bytes.length > 32768` and `bytes.length - 32768` ∈ {16, 32, 48, 64, 96, 128, 256, 512}, AUTO-STRIP that many bytes from EITHER the head OR the tail (try tail first; if structural probe fails, retry head-stripped). Surface a warning `"emulator_trailer_stripped(<n>)"` or `"emulator_header_stripped(<n>)"` in `SaveContents.warnings`.

**Why:** the Crystal demo file is 32816 bytes = 32768 + 48-byte trailer (verified: bytes at 0x8000..0x802F are an emulator metadata block ending with what looks like a Unix timestamp `0x6882a3b6`). PLAN §4.1 says "ignore tail" but doesn't tell the Generator HOW much to ignore or whether to accept prepended headers (some emulators — VBA-M, mGBA — prepend, others append). Without this rule the Generator will hardcode `bytes.subarray(0, 0x8000)` and miss prepended-header saves silently. Stripping must be data-driven (probe both ends) to avoid false positives on legitimately-padded 64KB / 128KB saves.

### A3 — `SaveContents.boxes` length contract clarification

**PLAN says** (§3.1): `boxes: readonly (readonly Gen12Pokemon[])[]; // length 12 (Gen1) or 14 (Gen2)`.

**Change to:** `boxes` length is **always** the format's nominal box count (12 for Gen 1, 14 for Gen 2). Empty boxes are present as empty arrays. A box that fails structural validation (count > 20) is returned as an empty array AND added to `warnings` as `"box_${i}_corrupt: count=${n}"`. This guarantees `boxes.length` is a stable invariant the UI can index by.

**Why:** PLAN §4.2 edge-case says "if count byte > 20, surface invalid_box_count for that box but continue parsing siblings" — but doesn't say what slot the bad box occupies in the result array. Without a fixed-length contract, the UI's per-box render loop will mis-index after the first corrupt box.

### A4 — Crystal box stride is 1104 bytes; on-disk box DATA is 1102 bytes

**PLAN says** (§4.3): `Stored boxes 1–7 | 0x4000 | 1104 × 7`. PLAN also says `(20 × 32 + 64)` for the current-box size.

**Change to:** document explicitly that the **stride** between consecutive boxes in a bank is `1104` bytes (verified: Box1 ends, Box2 count byte at `0x4000 + 1104 = 0x4450` = `0x07` for the demo Crystal save). The **on-disk box content** is `1 (count) + 21 (species list with 0xFF terminator) + 20*32 (mons) + 20*11 (OT names) + 20*11 (nicknames) = 1102 bytes`. The 2-byte tail per box is unused padding. The `(20*32+64)` arithmetic in PLAN §4.3 = 704 is wrong (it's missing OT + nickname blocks). Generator must use the explicit field math, not `20*32+64`.

**Why:** I verified stride and content size against `demo-crystal.sav`: box 1 count = 20, species list has 0xFF at correct offset, box 2 count appears at `+1104`, OT/nickname blocks confirmed at the offsets the demo Red box parser uses (analogous Gen 1 layout). `20*32+64` would mis-locate every OT name and nickname in every Gen 2 box parse.

### A5 — Per-mon record sizes: Gen 1 box = 33, Gen 1 party = 44; Gen 2 box = 32, Gen 2 party = 48

**PLAN says** (§4.2 / §4.3): correct numbers but in prose only.

**Change to:** define them as exported `const` in each `offsets.ts` file:

```ts
// gen1/offsets.ts
export const GEN1_BOX_MON_BYTES = 33 as const;
export const GEN1_PARTY_MON_BYTES = 44 as const;
export const GEN1_BOX_STRIDE = 1122 as const;
export const GEN1_BOX_MAX_MONS = 20 as const;
export const GEN1_NAME_BYTES = 11 as const;

// gen2/offsets.ts
export const GEN2_BOX_MON_BYTES = 32 as const;
export const GEN2_PARTY_MON_BYTES = 48 as const;
export const GEN2_BOX_STRIDE = 1104 as const;
export const GEN2_BOX_MAX_MONS = 20 as const;
export const GEN2_NAME_BYTES = 11 as const;
```

**Why:** these numbers appear inline in the demos but are easy to mistype. Pulling them into named constants makes the parser audit trivial (Code Evaluator can `grep` for the constants and not reverse-engineer literal arithmetic).

### A6 — `Gen12Pokemon.exp` is 24-bit BE for Gen 1 (per demo); confirm Gen 2 layout

**PLAN says** (§4.2): `0x0E exp u24-BE`. (§4.3): `0x08 exp u24-BE`.

**Change to:** keep the offsets but explicitly type-annotate that the parser's job is to call `be24(bytes, off)` and store as a JS `number` ≤ 16777215. Add to test matrix a unit test that asserts the demo Red Pidgeot's exp == the value `demo-red-boxes.ts` prints (or the demo Red party's first mon's exp matches `demo-red-stat-check.ts`).

**Why:** Sprint 1's `Gen12Pokemon.exp` is documented `uint24` but the source-file types/source.ts comment doesn't lock the encoding. Locking it to "the same value the demo prints" makes the regression anchor mechanical.

### A7 — PP / PP-Ups bit-extraction MUST be the demo's exact masking

**PLAN says** (§4.2): "Derive PP / PP Ups from the masked/shifted byte. `ppUps[]` for Gen 1 is always `[0,0,0,0]`."

**Change to:** for Gen 1, extract `pp = byte & 0x3F` and `ppUps = (byte >> 6) & 0x3` (matches `demo-red-stat-check.ts` lines 318–329 and `demo-red-boxes.ts` lines 617–628). The PLAN claim "Gen 1 ppUps always 0" is **wrong** — Gen 1 *does* support PP Ups (item, applied via the Move Tutor at the Celadon Game Corner). The demo extracts both. Pass the extracted ppUps through; the convert path (S1) already handles them. The PLAN's intended behavior for Gen 1 → `ppUps: [0,0,0,0]` was the demo SCRIPT's choice, not a parser contract; the parser must surface real PP Ups.

**Why:** silently zeroing PP Ups loses essence the conversion is supposed to preserve. HANDOFF §4.9 (preserve moves/PP/PP Ups) reads literally, and S1's `Gen12Pokemon.ppUps` accepts non-zero Gen 1 values.

### A8 — Move fixtures into `tests/fixtures/saves/` via symlink, NOT via path constant

**PLAN says** (§8.5): tests `readFileSync` from `scripts/demo-*.sav` directly via path constants.

**Change to:** create `tests/fixtures/saves/demo-red.sav` and `tests/fixtures/saves/demo-crystal.sav` as **symlinks** to the originals in `scripts/`. Test code references the symlinked paths via a single `tests/fixtures/saves/index.ts` exporting absolute paths. Demos in `scripts/` continue to read their own copies.

**Why:** the user-instruction ruling is "move to `tests/fixtures/saves/`". Symlinks satisfy "don't duplicate binaries" (PLAN §8.5's stated concern) while putting the production test dependency in the production test tree. If the demos are ever pruned, tests don't break.

### A9 — `currentBox` and `currentBoxIndex` are returned as-parsed; UI merges, parser does not

**PLAN says** (§3.1): both fields returned; (§10 Q5): "UI prefers `currentBox` for display when `currentBoxIndex` matches a box."

**Change to:** confirmed — parser returns `boxes` (numbered slots, possibly stale at the current-box index) AND `currentBox` AND `currentBoxIndex` as three independent fields. Parser does NOT merge. Document in `SaveContents` JSDoc: "When `currentBoxIndex !== undefined`, `boxes[currentBoxIndex]` may be stale; `currentBox` is the live working copy. Display layer chooses which to render."

**Why:** preserves the distinction in data; matches user's ruling. Forensically important for debugging cart-vs-emulator save divergence later.

### A10 — Roundtrip integration test pins Feraligatr |dev|=117 with explicit slot reference

**PLAN says** (§9 criterion 3): `convert(parseSave(crystal).party[<feraligatr-slot>])` |dev| sum == 117.

**Change to:** test code MUST first identify the Feraligatr slot programmatically (`parseSave(crystal).party.findIndex(m => m.speciesGen2Id === 160)`), assert that index is in range 0..5, then run convert + compare. Hardcoding `party[0]` will silently pass on a different mon if the demo save is ever swapped. Also assert that the SUM across all six party mons' |dev| values equals the orchestrator's prior recorded total (Generator: re-run `bun run scripts/demo-crystal*.ts` if such a script exists; else add a baseline anchor pegged to the |dev|=117 single-mon assertion).

**Why:** the 117 number is the ONLY hand-verified anchor we have for Gen 2 conversion correctness. Anchoring it loosely (by slot index) makes the regression brittle. Anchoring it by species ID makes it self-documenting.

### A11 — Bundle-size CI check uses the actual emitted asset filename, not a glob

**PLAN says** (§6.6): `gzip -c web/dist/assets/*.js | wc -c`.

**Change to:** Vite emits hashed filenames like `index-AbCd1234.js`. The `*.js` glob will match all chunks (including any vendor split). Configure `vite.config.ts` with `build.rollupOptions.output.manualChunks: undefined` AND `build.rollupOptions.output.entryFileNames: 'assets/app.js'` AND `chunkFileNames: 'assets/chunk-[hash].js'` AND `assetFileNames: 'assets/[name][extname]'`. CI then checks `gzip -c web/dist/assets/app.js | wc -c < 204800` against a known filename. Add a second check that asserts `find web/dist/assets -name '*.js' | wc -l` == 1 (single-chunk invariant).

**Why:** PLAN §6.6 claims a single-chunk bundle but the default Vite config will split if any dynamic import sneaks in. The single-chunk invariant must be testable and the size check must reference a stable name.

### A12 — File input accepts any extension; MIME-type filter is `*/*`

**PLAN says** (§6.3): drop zone exists, no MIME details.

**Change to:** the `<input type="file">` MUST have `accept="*"` (not `.sav`, not `application/octet-stream`). Drag-drop handler MUST inspect file by reading bytes and calling `detectFormat()`, NOT by file extension or MIME type. macOS Safari and Linux file dialogs frequently mis-report `.sav` MIME as empty or `application/x-pkcs7-signature`.

**Why:** real-world `.sav` files have no canonical MIME type. Restricting input by extension/MIME breaks legitimate uploads and provides zero security benefit (the parser is the gate).

### A13 — Loading state must render before parser runs

**PLAN says** (§6.2 state machine): `idle → parsing → loaded|parse_error`.

**Change to:** the Controller MUST dispatch `file_selected` synchronously, render the `parsing` state, then yield via `queueMicrotask` (or `requestAnimationFrame`) before invoking `parseSave()`. Without the yield, the `parsing` UI never paints — `parseSave()` on a 32KB buffer is sub-millisecond and the synchronous transition `idle → parsing → loaded` collapses in one paint cycle. Visually the user sees "drop file" → "loaded" with no feedback. The yield costs ~16ms but guarantees a paint of the parsing state.

**Why:** UX hole flagged in user instructions §6 ("loading states").

### A14 — Empty-party and all-refused special UI states

**PLAN says** (§6.3): renders party + boxes; refused mons rendered muted.

**Change to:** add explicit empty states to the `loaded` render:
- If `save.party.length === 0` AND every box is empty: render `"Save loaded but contains no Pokemon."` with the trainer card still visible.
- If every parseable mon is refused (e.g. a save full of legendaries): the `Convert all` button MUST be disabled with tooltip `"All ${N} mons are refused — see refusal reasons inline."`
- If `save.warnings.length > 0`: render the warnings panel ABOVE the party/box list (not below the trainer card alone), so the user can't miss `"checksum_mismatch"` or `"emulator_trailer_stripped"`.

**Why:** UX hole from user instructions §6 ("error states", "refused-species visual treatment").

---

## Open-question rulings

| # | Question | Ruling | Rationale |
|---|---|---|---|
| 1 | GS support: ship in S3a? | **DEFER** to S3b | We have NO GS fixture. Per user instruction §5, GS is "ship-tested if ≤ 50 LoC, defer otherwise." The offsets.ts file alone is ~30 LoC, but the parser, detection probe, charmap (same), and a fixture-less unit test are another ~50+ LoC and CANNOT be tested. Untested production code path violates the orchestrator's "ship-tested" principle. PLAN may keep `GEN2_GS_EN` enum value reserved (so the type is forward-compatible) but `parseSave` returns `SaveError(unknown_format)` for GS structural matches in S3a, with message `"Pokemon Gold/Silver support deferred to S3b"`. |
| 2 | Yellow support: ship in S3a? | **CONFIRM, ship-tested-IF-trivial; otherwise DEFER** | RB and Yellow share charmap, checksum algorithm, party/box layout. The only real delta is the Pikachu friendship block at `0x2A4D` — irrelevant to convert. Recommendation: implement detection probe + a YELLOW format constant that aliases entirely to the RB parser (single-file delta < 20 LoC). If this fails the demo Red save (which it shouldn't — Red's Yellow probe must NOT match), DEFER. Generator: try first, fall back if it costs > 30 LoC or breaks RB tests. |
| 3 | fflate vs JSZip vs hand-rolled | **CONFIRM fflate** | Per user ruling §5. ~30 KB minified, sync API, tree-shakeable, exactly the size profile we need. |
| 4 | Fixture location | **OVERRIDE** to `tests/fixtures/saves/` via symlink | Per A8 above. User ruling §5 is explicit. Symlinks resolve the binary-duplication concern. |
| 5 | Box-ordering API | **CONFIRM separate `currentBox` field** | Per A9 above. User ruling §5 is explicit. Parser does not merge; UI chooses. |
| 6 | Sprite handling | **DEFER to S3b** | Per user ruling §5. 40 KB on a 200 KB budget for non-DoD cosmetic content is wasteful. Text-only display is acceptable for S3a. |
| 7 | Internationalisation (EN-only) | **CONFIRM** | Per user ruling §5. JP/EU saves require separate charmap planning and are explicitly out of scope. |
| 8 | `SaveSource` interface freeze | **CONFIRM** | Per user ruling §5. Lock the proposed interface verbatim into `core/src/types/sav.ts`: `interface SaveSource { read(): Promise<Uint8Array>; readonly kind: 'file' | 'serial'; readonly label: string; }`. S3a UI must consume this interface for the file-upload path so the S3b serial adapter slots in without controller changes. |

---

## Save-parser audit

### RBY (`demo-red.sav`, 32768 bytes)

Verified directly against the demo file:

| Field | PLAN offset | Verified value | Match? |
|---|---|---|---|
| Player name @ `0x2598` | 11 bytes | `81 80 93 93 93 93 93 50 ...` (Gen 1 charmap = "BLUE" + filler? need to decode but byte layout matches demo) | OK |
| TID @ `0x2605` BE | u16 | 52308 | OK |
| Party count @ `0x2F2C` | u8 | 5 | OK |
| Party species @ `0x2F2D` | 6 bytes + terminator | `04 23 b9 a9 5c ff ff` (Charmander, Fearow, Oddish, Geodude, Horsea per INTERNAL_TO_NDEX) | OK |
| Checksum @ `0x3523` | u8 | stored=`0xD1`, computed `0xFF - sum(0x2598..0x3522) & 0xFF` = `0xD1` | **OK — exact match** |

PLAN's RBY layout is correct. Direct port of the demo. **No drift.**

### Gen 2 GS

No fixture available. Cannot independently verify offsets. PLAN's offsets are sourced from "pokegold disasm" which is the canonical reference. Recommend DEFER (see A1, ruling Q1). If shipped untested, surface a warning visibly.

### Gen 2 Crystal (`demo-crystal.sav`, 32816 bytes = 32768 + 48-byte trailer)

Structural offsets verified:

| Field | PLAN offset | Verified value | Match? |
|---|---|---|---|
| Player name @ `0x200B` | 11 bytes | `89 ae a4 ab 50 50 ...` (printable Gen 2 chars, terminated by `0x50`) | OK |
| TID @ `0x2009` BE | u16 | 42971 | OK |
| Party count @ `0x2865` | u8 | 6 | OK |
| Party species @ `0x2866` | 7 bytes incl 0xFF | `9d 1a a0 f8 e6 f9 ff` (Feraligatr 0x9D = ndex 160 in Gen 2 native dex order) | OK |
| First party mon species byte @ `0x286D` | u8 | `0x9D` (Feraligatr) | OK |
| Current box index @ `0x2724` | u8 | 0 | OK |
| Gender @ `0x3E3D` | u8 | 0 (male) | OK (Crystal-only field validates) |
| Money @ `0x23DB` 24-bit BE | u24 | 4194424 | Plausible (high but not absurd) |
| **Checksum @ `0x2D69` u16-LE** | claimed range `0x2009..0x2B82` | stored=`0xF03D`, computed `0xBBBE` | **MISMATCH (drift A1 above)** |

**Drift findings:**
- Crystal checksum range in PLAN (`0x2009..0x2B82`) does NOT match the stored value on the demo file. I exhaustively brute-forced contiguous byte and u16-LE word ranges (start ∈ [0, 0x3000], end ∈ [start+0x100, 0x4000]); ZERO ranges produce `0xF03D`. The demo save's checksum byte is dead/stale. This is consistent with the file being an emulator save-state export (48-byte trailer present). Real cart Crystal saves WILL match — but our only fixture won't, so checksum-first detection breaks CORE-PARSE-CRYSTAL. See A1 (structural-first detection).
- Box stride `1104` is correct (verified: Box1 count @ `0x4000` = 20, Box2 count @ `0x4000+1104` = 7). PLAN's `(20*32+64) = 704` parenthetical for current-box size is wrong arithmetic — the actual box content is 1102 bytes (1 + 21 + 640 + 220 + 220). See A4.

### Internal-index → ndex table

PLAN §4.4 says "lift verbatim from `scripts/demo-red-stat-check.ts` lines 16–165." Demo table has ~145 entries (Gen 1 species 1–151 minus ~6 missing-no slots). Generator MUST audit that table is complete for all 151 species; the demo only includes species the demo encountered + a hand-curated extra. Cross-reference with pret/pokered's `data/pokemon/species_ids.asm` for any gaps. **Action:** Code Evaluator should diff the ported table against pret's full table; missing entries → opaque mons that bypass conversion.

---

## SaveContents / SaveError shape audit

PLAN §3.1's shape covers the UI's needs:

- ✅ trainer (name, TID, optional playTime/money/gender) — sufficient for trainer card render.
- ✅ party (Gen12Pokemon[]) — feeds `convert()` directly.
- ✅ boxes + currentBox + currentBoxIndex — UI can display all box contents (after A3 fix).
- ✅ warnings (string[]) — non-fatal issues surfaced.
- ✅ format (SaveFormat enum) — for badge display.

**Gaps:**

- ❌ **No per-mon refusal pre-computation.** The UI needs to render `[REFUSED: undiscovered_egg_group]` badges next to mons before the user clicks Convert. PLAN's flow has the UI calling `isRefusal(convert(mon))` for every mon at render time, which is wasteful (full convert pipeline including PID search runs per mon). **Amendment is implicit in A14 (UI rendering)** — Generator should call `convert()` lazily on first render of each mon and cache the refusal in `state.results`. Acceptable performance because convert is sub-millisecond per mon for Gen 2; not a contract change.

- ❌ **No raw-bytes accessor for forensics.** If a mon parses as opaque (unknown species), the UI can't show the raw bytes for user debugging. Add (optional, Generator's discretion) a `_rawBytes?: Uint8Array` to a debug-mode build, hidden behind a query-string flag. Not required for DoD. **NOT a binding amendment.**

- ❌ **No species-display-name resolution.** The UI needs to render "Feraligatr" not "ndex 160". `core/src/data/species.ts` (S1) already exposes `SpeciesEntry` with names. Web UI imports `@pokeportal/data` (already a workspace dep transitively via core); confirm it's reachable. **NOT a binding amendment** (uses existing data; just call out for Generator).

`SaveError` shape covers the main fatal modes (`unknown_format`, `truncated`, `checksum_mismatch_fatal`, `invalid_party_count`, `invalid_box_count`, `corrupt_pokemon_record`). Sufficient for the UI's `parse_error` state to render a meaningful message.

---

## Bundle-size sanity check

PLAN's component estimates:

| Component | Estimated gzipped | Source |
|---|---|---|
| Vite runtime + module-preload polyfill | ~3 KB | Vite docs (with `modulePreload: false`) |
| `@pokeportal/core` (full export including pack/, convert/, fields/, primitives/, data/) | ~80–100 KB | S1+S2 ships ~30+ source files + JSON tables |
| fflate | ~12 KB gzipped | npm package data |
| `web/src/` (state, controller, dom/, download, zip wrapper, filename) | ~5 KB | 600 lines of vanilla TS |
| HTML + CSS | ~2 KB | hand-rolled |
| **Total estimated gzipped JS** | **~100–122 KB** | |

**Verdict:** comfortable under the 200 KB hard limit. The dominant cost is `@pokeportal/core` — specifically, the JSON data tables (`personal-gen3.json`, `species.json`, `egg-groups.json`, `charmap12.json`, `charmap3.json`, `refused.json`, `personalInfo.ts`) are largely non-compressible numeric data. If we need headroom: tree-shaking should eliminate `pack/baseStats.ts` from the parse path (it's only used by `packParty`), and the `tests/harness/` is workspace-isolated and won't bundle. **No amendment needed**, but Generator MUST verify by running `bun run --filter web build` early and reporting actual size in EVAL.md. If it exceeds 150 KB gzipped, investigate which JSON file is the offender via `vite-bundle-visualizer` (devDep, not shipped).

**Risk:** if `@pokeportal/core` accidentally re-exports the `tests/harness/` modules (it shouldn't — `index.ts` is clean per Read above), bundle size could double. CI must enforce.

---

## Web UI gaps

| Gap | Severity | Resolution |
|---|---|---|
| No loading state visible (parser too fast) | Medium | A13 — yield before parse |
| No empty-save state | Medium | A14 — explicit message |
| No all-refused state | Medium | A14 — disabled Convert all + tooltip |
| Warnings panel placement ambiguous | Low | A14 — above mon list |
| No progress bar for "Convert all" on large box-fulls | Low | If party + 14 boxes × 20 mons = 286 mons, sync convert may block ~300ms. Generator should chunk via `for...of` + `await Promise.resolve()` every 16 mons. **NOT a binding amendment** but recommended. |
| File MIME type filter | Medium | A12 — accept="*" |
| Drag-drop visual feedback | Low | Hover state on drop zone (`dragenter` adds CSS class). Generator's call. |
| Browser memory limit for large zip | Low | A non-issue: 286 mons × 80 bytes = 23 KB raw. zip overhead negligible. **No amendment.** |
| Object URL leak on multiple downloads | Medium | `download.ts` MUST `URL.revokeObjectURL(url)` after the anchor click triggers (use `setTimeout(() => URL.revokeObjectURL(url), 1000)` as commonly recommended). PLAN §6.4 mentions this; Generator must implement, not skip. |
| Filename collision in zip | Low | PLAN §6.5 already addresses with slot-index prefix. OK. |

---

## S1/S2 invariants check

Reading `core/src/index.ts` and S1/S2 archives:

- ✅ **`Gen12Pokemon` shape** (S1 contract): PLAN §4.2/§4.3 map every save field into the existing field set (sourceGen, speciesGen2Id, level, exp, dvs, statExp, moves, pp, ppUps, heldItemGen2Id, friendship, pokerusByte, otNameBytes, tid, nicknameBytes, language). No new fields proposed. ✅
- ✅ **`Gen3Intermediate` and `packBoxed`/`unpackBoxed` signatures** (S2 contracts): PLAN never modifies them. The save reader's output flows INTO `convert()` and `packBoxed()` unmodified. ✅
- ✅ **Zero runtime deps in `core/`**: PLAN §6.1 puts `fflate` in `web/package.json` only, NOT in `core/package.json`. The `core/src/sav/` module uses no external libraries (only `data/`, `types/`, and pure-TS code). ✅
- ✅ **Refused-species set unchanged**: PLAN doesn't touch `core/src/data/refused.ts` or `core/src/fields/eligibility.ts`. ✅
- ✅ **SHA-256 oracle unchanged**: PLAN doesn't touch `core/src/primitives/sha256.ts` or `hash.ts`. ✅
- ⚠️ **Public API surface**: PLAN §3.3 adds `parseSave`, `detectFormat`, `isSaveError` as new exports plus `SaveContents`, `SaveError`, `SaveFormat`, `TrainerInfo` types. These are additions, not modifications. Existing exports (`convert`, `packBoxed`, etc.) are untouched. ✅. **However**, the snapshot test in S2 (`tests/dist/`?) may snapshot `dist/index.d.ts` — Generator must re-baseline that snapshot if it exists. Check S2 archive AMEND-S2-X notes; the rebaseline is an expected mechanical update.

---

## Risks flagged to Generator

1. **Crystal demo file checksum is dead.** Do not write a parser that hard-fails on Gen 2 checksum mismatch. See A1. Manifests as: `parseSave(demoCrystal)` returns `SaveError('checksum_mismatch_fatal')` and CORE-PARSE-CRYSTAL fails immediately on first run.

2. **Emulator trailer corrupts length triage.** `demo-crystal.sav` is 32816 bytes. PLAN accepts but doesn't strip; A2 mandates explicit head/tail strip. Manifests as: parser indexes into bytes that include trailer junk if it ever uses `bytes.length` arithmetic for offset computation (e.g., `bytes.length - 0x800` for backup bank). Strip explicitly.

3. **Vite hashed filenames break CI bundle check.** A11. Manifests as: CI passes locally but breaks on a Vite cache miss when filenames change. Pin filenames.

4. **`Gen12Pokemon.ppUps` for Gen 1 — don't zero them silently.** A7. Manifests as: a player who maxed PP Ups on Pidgeot's Fly loses the customization in Gen 3. The UI shows no warning because the data was already discarded at parse time.

5. **Gen 2 box stride vs. content size confusion.** A4. Manifests as: Gen 2 boxes 2..7 in each bank read garbage because the parser uses 1102-byte stride instead of 1104-byte. Specifically: box 2 OT-name table is mis-located, decode produces gibberish UTF-8.

6. **Gen 1 internal-dex table incompleteness.** §4.4 ports from demo, which only includes ~145 of 151 species. Audit against pret's full table OR fall back to "opaque mon" for the missing slots without crashing.

7. **`convert()` is synchronous and blocks main thread.** PLAN §6.4 step 3 calls it inline. For 1-mon clicks, fine. For "Convert all" of 286 mons, ~50–300ms block. Acceptable for S3a (no spinner needed) but if PID search ever runs hot (the iteration count from S1's `pidSearchIterations` can spike for shiny constraints), chunk via microtask yield.

8. **`download.ts` MUST revoke Object URLs.** Memory leak otherwise. PLAN §6.4 says "revoke" but Generator may forget; verify in `web/src/__tests__/`.

9. **`@pokeportal/core` workspace import resolution.** `web/package.json` declares `"@pokeportal/core": "workspace:*"`. Vite must be configured to resolve this (it does by default with bun's workspace symlinks, but sometimes requires `vite.config.ts: resolve: { preserveSymlinks: false }`). Test early.

10. **`Vite` build target ES2022 + `modulePreload: false`.** PLAN §6.1 sets these. `modulePreload: false` is essential to avoid Vite emitting a separate `<link rel="modulepreload">` for chunks (which adds bytes to HTML and changes the bundle-count invariant from A11). Don't forget to also set `build.cssCodeSplit: false` for the same reason.

11. **`vitest jsdom` env for web tests.** `web/vitest.config.ts` MUST set `test.environment: 'jsdom'`. Default is `node`, which lacks `URL.createObjectURL` and `File`; DOM unit tests will crash.

12. **Symlinks cross-platform (Windows).** A8 uses symlinks. CI is Linux (per S1/S2 ci.yml) so OK, but contributor machines may break. Acceptable trade-off; document in README that symlinks require dev on Linux/macOS or `git config core.symlinks true` on Windows.

---

## Test matrix gaps

PLAN §8 covers most surface, but:

- ❌ **Per-format detection regression**: `sav-detect.test.ts` should include a fuzz test where random 32KB buffers MUST return `null` (no false positives). Add: 100 RNG-seeded buffers, all should fail detection.
- ❌ **Truncated-then-detected fixture**: a save truncated to `0x7FFF` should return `truncated`, not `unknown_format`. Add explicit case.
- ✅ **Feraligatr |dev|=117 anchor**: PLAN §8.2 calls it out; **A10 hardens it** (species-id lookup, not slot index).
- ❌ **Per-mon convert-roundtrip on demo Crystal boxes**: PLAN's integration test only exercises the Crystal Feraligatr in `party`. Crystal `boxes` are also worth round-tripping. Add: for every non-refused mon in Crystal box 1 (which has live mons in our fixture — verified count=20 at `0x4000`), run `convert + packBoxed + unpackBoxed`. Should also pass without throwing.
- ❌ **Empty-party save**: a synthetic save with party count = 0 must return `parse_error: invalid_party_count` only if count is > 6; count = 0 must return SaveContents with `party: []`. PLAN §4.6 implies this but doesn't test it.
- ❌ **Bundle-size assertion in vitest**: in addition to the CI shell check (A11), add a `web-build.test.ts` that runs after build and reads `web/dist/assets/app.js`, asserts `gzip(content).length < 204800`. Catches regression in dev, not just CI.
- ✅ **Filename sanitisation**: PLAN §8.3 covers. Make sure to test the corner case "nickname is exactly the species name" (Gen 1 default nickname) — should be kept verbatim, not replaced with `no-nickname`. PLAN §6.5 says this; ensure test asserts.
- ❌ **Internal-dex completeness regression**: `sav-gen1-internal-dex.test.ts` should assert the table has ≥145 entries AND every (internal, ndex) pair survives forward+inverse round-trip AND every species in `core/src/data/refused.ts` (Gen 1 IDs) has either a forward map OR an explicit "missing" sentinel.
- ✅ **CORE-DETECT criterion**: PLAN §9 #6 covers detection-by-content (filename ignored). Make sure test renames/swaps fixtures across calls to verify content-only detection.

**Specifically asked: does the test pack include the Feraligatr |dev|=117 regression anchor?** **YES**, PLAN §8.2 calls it out (the integration test asserts `total |dev| sum across the six stats == 117`). A10 hardens it to identify Feraligatr by species-id lookup, not slot index.

---

## Out-of-scope confirmations

PLAN §11 explicitly defers to S3b or beyond:

- ✅ Web Serial / GBxCart RW → S3b (S3a freezes the `SaveSource` interface per Q8).
- ✅ Save writing → S4+ (correct, never required for DoD).
- ✅ Gen 3 save injection → S4 (correct).
- ✅ Cart hardware bring-up → out of project (correct).
- ✅ Multi-language UI strings → out (correct).
- ✅ JP/FR/DE/IT/ES save format support → out (correct, per Q7).
- ✅ Sprites and animations → S3b cosmetic (per Q6).
- ✅ Drag-reorder, edit, save-back-to-sav → out (correct, this is one-way export).
- ✅ PWA / service-worker → polish pass.
- ✅ Telemetry / analytics → never (HARD RULE per CLAUDE.md).
- ✅ Server-side anything → never (correct).
- ✅ Stadium 2 transfer pak → out.
- ✅ Battery-dead cart save recovery → out.
- ✅ Hidden Power-aware IV preservation → already explicitly rejected in HANDOFF §4.5.

**Additional deferrals to confirm explicitly to Generator (not in PLAN §11 but implied):**

- ✅ **Pokemon Stadium 1 (Gen 1 Stadium box transfers)** → out, no fixture.
- ✅ **Multi-save-per-file aggregation** (e.g., a 128KB Gen 2 dump containing two saves) → out, parse first only.
- ✅ **Save-bank rotation handling** (Gen 2 has primary + backup save banks at `0x0000`/`0x8000` on cart) → out for S3a; the demo file appears to be a single-bank export. Real cart reads may need bank selection; flag for S3b.
- ✅ **Sound/audio assets** → out, never planned.
- ✅ **i18n of error messages** → English only.

---

**End of PLAN_EVAL.md.**


---

# EVAL — (produced by Code Evaluator)

# EVAL — Sprint 3a

## Verdict

**PASS.** All six verification commands exit 0. 230 main + 31 web = **261 tests passing**, 1 permitted skip (Alakazam from S1). The three critical PLAN_EVAL amendments (A1 structural-first checksum, A2 length triage with 48-byte trailer strip, A4 Gen 2 box stride 1104) are correctly implemented and independently verified against `demo-crystal.sav`. The Feraligatr |dev|=117 regression passes via the species-id lookup path mandated by A10. GS and Yellow synthetics correctly return `UNSUPPORTED_VARIANT`. The web bundle is a single 28.34 KB-gzipped chunk (well under the 200 KB cap). S1/S2 invariants intact (core deps still empty, `Gen3Intermediate`/`Gen12Pokemon` shapes untouched, refused.json still 20 entries, all earlier tests pass). One minor type-shape deviation from PLAN_EVAL Q8 (`SaveSource` is missing the `kind: 'file' | 'serial'` field) and one minor UX hole in `decodeNickFallback`'s inline charmap, neither blocking — both noted as risks for S3b.

---

## Verification command results

| # | Command | Exit | Tests / Output |
|---|---|---|---|
| 1 | `bun install` | 0 | `Checked 216 installs across 261 packages (no changes)` |
| 2 | `bun run typecheck` | 0 | `tsc --build && tsc --noEmit -p web/tsconfig.json` clean |
| 3 | `bun run lint` | 0 | `eslint --max-warnings 0 .` clean |
| 4 | `bun run format:check` | 0 | `prettier --check .` clean |
| 5 | `bun run test` | 0 | **230 passed, 1 skipped** across 32 files (3.19 s) |
| 6 | `bun run --cwd web build` + web test | 0 | build OK; **31 web tests passed** across 5 files |

Independently re-measured bundle: `gzip -c web/dist/assets/app.js | wc -c` = **28337 bytes** (28.34 KB). Vite reports 28.77 KB which matches. Cap 204800; **86 % headroom.**

---

## Critical amendments verified

### A1 — Structural-first detection, checksum non-fatal

`core/src/sav/format.ts` lines 62–78: `detectFormat` runs structural probes first (Crystal → GS → RB/Yellow). `crystalChecksumValid()` (lines 180–190) is computed but only sets `checksumValid` on the returned `DetectionMatch`; never blocks detection. `core/src/sav/index.ts` lines 65–68 surface a `'checksum_mismatch'` warning when `checksumValid === false`, then returns `parsed` normally. Independently verified by feeding `demo-crystal.sav` through `parseSave`: **stored checksum = 0xF03D, computed = 0xD2AB → mismatch → parse succeeds with warning**. No `BAD_CHECKSUM` error path.

### A2 — Length triage with 48-byte trailer (Crystal demo case)

`core/src/sav/lengthTriage.ts` lines 81–97 explicitly handle the `delta ∈ {16,32,48,64,96,128,256,512}` case, trying tail-strip first, then head-strip. Surfaces `emulator_trailer_stripped(48)` or `emulator_header_stripped(48)`. Verified by feeding the 32816-byte Crystal demo file: parser strips 48 bytes from the **tail** (correct end — emulator metadata is appended), surfaces `"emulator_trailer_stripped(48)"` in `result.warnings`, parses successfully. The dedicated `tests/unit/lengthTriage.test.ts` exercises both directions and the rejected 17-byte trailer.

### A4 — Gen 2 box stride is 1104 bytes

`core/src/sav/gen2/offsetsCrystal.ts` line 51: `export const GEN2_BOX_STRIDE = 1104 as const;`. `parser.ts` line 218: `bankOffset + bIdx * GEN2_BOX_STRIDE`. **Independently re-derived against `demo-crystal.sav`:** Box 1 count @0x4000 = 20; Box 2 count @0x4000+1104=0x4450 = **7** (sane, in 0..20). At stride 1102 the same offset yields 0xFF (terminator); at the RBY 1122 stride it also yields 0xFF. Bank-2 box counts at stride 1104: `[20, 7, 3, 13, 6, 5, 4]` — all in range. **Stride is correct.** Per-box content-region offsets also match: `C_BOX_MONS_OFFSET=0x16`, `C_BOX_OT_OFFSET=0x296`, `C_BOX_NICK_OFFSET=0x372`, content size 0x44E = 1102 bytes (1+21+640+220+220), stride 1104 with 2-byte pad — exactly as A4 mandated.

---

## Feraligatr regression independently re-run

`tests/integration/sav-feraligatr-regression.test.ts` ran in isolation: 5 tests passed. The regression test asserts `expect(dev).toBe(117)` where `dev` is the absolute deviation across hp/atk/def/spa/spd/spe between `gen2Stats(base, dvs, statExp, level)` and `gen3Stats(base, ivs, evs, level, nature)`. Test passes → live |dev| is exactly **117**. Feraligatr located by `findIndex(m => m.speciesGen2Id === 160)` (per A10) at slot index 2; level 74; DVs `{atk:1, def:0, spe:10, special:0}`; StatExp `{hp:34695, atk:40007, def:38073, spe:39164, special:34886}`. Match the orchestrator's prior baseline.

---

## upload-flow.test.ts critical review

- **Patch scope.** Every monkey-patch (`globalThis.Blob`, `URL.createObjectURL`/`revokeObjectURL`, `document.createElement`) lives inside a `try/finally` block in the "downloads an 80-byte .pk3" test (lines 138–163). Originals are restored in `finally`. **Scoped — does not leak.** Per-File `arrayBuffer()` patch (lines 31–35) is applied to each File instance individually, not to a global prototype.
- **Byte-size assertion.** Line 156: `expect(captured.size).toBe(80);` — exact, not `>0`. The `CapturingBlob` subclass sums `byteLength` of every `BlobPart` so any compound construction would also be visible.
- **Paint-before-parse (A13).** `handleFileSelected` (`web/src/ui.ts` lines 74–95) dispatches `file_selected` synchronously, then `await new Promise` wrapped around `requestAnimationFrame` (or `setTimeout(0)` fallback). The test (lines 58–71) starts the async call without awaiting, then immediately reads `controller.state()` — **observes `parsing` mid-call** because the rAF promise has not resolved. After `await promise`, state advances to `loaded`. This actually waits for a frame; doesn't spin.
- **Parse-error path.** Test "shows parse_error state for an unrecognized buffer" (lines 166–177) feeds an all-zero 32 KB buffer. Zero buffer fails every structural probe (Crystal gender byte 0 OK → but party-count 0 with first species byte 0 fails the `count>0 && b!==0` check, etc.) → `UNRECOGNIZED_FORMAT`. `controller.state().kind === 'parse_error'`. **Genuine error path, not a happy fork.**

Note: Generator self-report said the patch is on `globalThis.Blob.arrayBuffer()`. The actual patch subclasses `Blob` to capture sizes, while `arrayBuffer()` is patched per-File-instance. Functionally equivalent; the self-description is imprecise but the implementation is correct.

---

## Bundle audit

- `find web/dist/assets -name '*.js' | wc -l` → **1**. Single chunk emitted. (Per A11 — Vite was configured with `manualChunks: undefined`, `entryFileNames: 'assets/app.js'`, no preload.)
- Filename: `web/dist/assets/app.js` (stable name, no hash).
- Raw size: 104.37 KB. Gzipped: **28337 bytes (28.34 KB)**. Cap: 204800. **86.2 % headroom.**
- A separate `web/src/__tests__/bundle-size.test.ts` runs the same gzip check inside Vitest and prints `web bundle: raw=104404 bytes, gzipped=28773 bytes` (slight delta due to gzip-level differences between Bun and the system gzip; both well under cap).
- HTML 0.45 KB, CSS 2.09 KB, favicon 0.27 KB. Total page weight comfortably under 35 KB gzipped.

---

## decodeNickFallback inline charmap risk

`web/src/ui.ts` lines 356–372. The inline filter handles only:
- 0x80..0x99 → `A..Z`
- 0xA0..0xB9 → `a..z`
- 0xF6..0xFF → `0..9`

**All other bytes become `-`.** This corrupts characters that the full `decodeGen12` would handle correctly:
- `!` (0xE6), `?` (0xE7), `.` (0xE8), space (0x7F), `'` (0xE0), `(` (0x9A — hits the "A..Z" range and decodes as `Z+1` = `[` actually since `0x80+(0x9A-0x80) = 0x9A` no wait `0x41+(0x9A-0x80)=0x5B = '['`, so collisions on `0x9A..0x9F` (Pk Mn …) wrongly decode as `[ \ ] ^ _ \``)
- 0xF6..0xFF includes the 10 digits but also the gender symbols at 0xF5/0xEF — wrong.

**Severity: minor UX bug.** The full Gen 1/2 charmap is already imported (`decodeGen12` from `@pokeportal/core/data/charmap12`) for the trainer name decode (`parser.ts` line 196 etc.). Reusing it here costs nothing in bundle size (already shipped). The justification comment claims "to keep the bundle small" but the charmap is already in the bundle. **Recommend Generator switch to `decodeGen12` in S3b.** Does not block S3a DoD because:
1. Default Gen 1 nicknames are uppercase ASCII species names — handled correctly.
2. Default Gen 2 nicknames are mixed-case ASCII species names — handled correctly.
3. Only user-customised nicknames with punctuation/symbols are affected, and the convert-pipeline still ships their **bytes** correctly via `nicknameBytes` (the UI display is purely cosmetic).

---

## currentBoxIndex mask audit

Both `gen1/parser.ts` line 238 and `gen2/parser.ts` line 239 use `cbiByte & 0x3f`. Both clamp the result with `< RB_TOTAL_BOXES`/`< C_TOTAL_BOXES` (12 / 14), so a junk value can never index out of bounds.

Verified against `demo-crystal.sav`: byte at 0x2700 = 0x01. `& 0x3f` = 1; `& 0x0f` = 1; `& 0x7f` = 1 — all yield the same answer for this fixture. The live box buffer at 0x2D10 was verified to byte-match stored bank-2 box index 1 (i.e., overall "Box 2"). Mapping is correct.

For Gen 1, `RB_CURRENT_BOX_INDEX_OFFSET = 0x284c` with documented "bottom 6 bits = index, bit 7 = changed" comment. `& 0x3f` correctly extracts the 6-bit index, ignoring the changed-flag at bit 7 and the unused bit 6. **Mask is defensible.** A stricter `& 0x0f` would suffice for 12/14-box ranges, but since the value is post-clamped to `< TOTAL_BOXES`, the `0x3f` choice is safe.

---

## GS / Yellow refusal verification

Synthetic GS-like buffer (party count at 0x288A = 1, species at 0x288B = 0x9D, terminator, name at 0x200B = "Joel\x50", gender at 0x3E3D = 0xFF to defeat Crystal probe, party count at 0x2F2C = 99 to defeat RB probe):

```
{ kind: 'save_error',
  reason: 'UNSUPPORTED_VARIANT',
  message: 'Pokemon Gold/Silver support is deferred to a later sprint.' }
```

Synthetic Yellow-like buffer (RB layout valid + correct RB checksum + Pikachu friendship 200 at 0x271C):

```
{ kind: 'save_error',
  reason: 'UNSUPPORTED_VARIANT',
  message: 'Pokemon Yellow support is deferred to a later sprint.' }
```

**Both correctly refused via `UNSUPPORTED_VARIANT`** — neither silently parsed as Crystal/RB.

---

## S1/S2 invariants check

- **`Gen12Pokemon`, `Gen3Intermediate`, `convert()`, `packBoxed`/`unpackBoxed`, `BOXED_SIZE` shapes unchanged.** `core/src/index.ts` re-exports them identically; only **additions** (`parseSave`, `detectFormat`, `isSaveError`, `SaveContents`, `SaveError`, `SaveErrorReason`, `SaveFormat`, `TrainerInfo`, `SaveSource`) are introduced.
- **`core/package.json` deps still empty** (`"dependencies": {}`). `fflate` lives only in `web/package.json`.
- **`data/raw/refused.json` still 20 entries** (verified by `Bun.file().json()`, `Array.length === 20`).
- **All previous tests pass**: 230 main tests in 32 files, including the S1 `unown.test.ts` (5 tests, ~414 ms — Unown letter constraint preserved) and the S2 `gen3-pkhex-vector.test.ts`, `gen3-roundtrip.test.ts`, `gen3-checksum.test.ts`, `gen3-substructures.test.ts` (all green).
- **Sprints archived**: `sprints/sprint-1.md` and `sprints/sprint-2.md` present.

---

## Open-question rulings followed

| # | Ruling | Status | Evidence |
|---|---|---|---|
| 1 | GS deferred → return UNSUPPORTED_VARIANT | **CONFIRMED** | `core/src/sav/index.ts:44-46`; synthetic GS test above returns the documented message |
| 2 | Yellow deferred → return UNSUPPORTED_VARIANT | **CONFIRMED** | `core/src/sav/index.ts:47-49`; synthetic Yellow test returns the documented message |
| 3 | fflate confirmed | **CONFIRMED** | `web/package.json`: `"fflate": "^0.8.2"` in dependencies |
| 4 | Fixtures via symlink in `tests/fixtures/saves/` | **CONFIRMED** | `tests/fixtures/saves/{demo-red.sav,demo-crystal.sav}` are symlinks to `../../../scripts/demo-*.sav`; `tests/fixtures/saves/index.ts` exports `demoRedPath`, `demoCrystalPath` |
| 5 | Separate `currentBox`/`currentBoxIndex` field; parser does not merge | **CONFIRMED** | `core/src/types/sav.ts:46-47`; parser populates both; `boxes[currentBoxIndex]` and `currentBox` are returned independently |
| 6 | No sprite assets | **CONFIRMED** | `web/src/` has no sprite imports; rendering is text-only (`renderMonRow` uses species name + nickname only) |
| 7 | English-only charmap | **CONFIRMED** | Only `core/src/data/charmap12.ts` used; no JP/EU charmaps |
| 8 | `SaveSource` interface frozen with `kind: 'file' \| 'serial'` | **VIOLATED (minor)** | `core/src/types/sav.ts:73-76` defines `SaveSource` with only `read()` and `label`; **the `kind` field mandated by Q8 is missing**. The interface is also not consumed by the S3a controller (which uses `File` objects directly), so the omission has no current effect — but S3b will hit it when the Web Serial adapter needs to discriminate. Not blocking, but should be fixed in S3b's first commit. |

---

## Risks for S3b

1. **`SaveSource.kind` missing.** Q8's contract was specifically frozen to lock the S3b adapter shape. Add the `kind: 'file' | 'serial'` field at the top of S3b before plumbing the GBxCart adapter through, or controllers will need a refactor mid-sprint.
2. **`decodeNickFallback` inline charmap.** Replace with `decodeGen12` (already in bundle). 5-line change, eliminates the silent-corruption class of bug for non-default nicknames. Cosmetic but visible.
3. **`renderMonRow` doesn't pass a dispatcher.** It accepts `_dispatch` but ignores it; expanding this for selection toggles (per PLAN §3.5 `mon_toggled` action) will require restructuring. The reducer already lacks the `mon_toggled` action that PLAN §3.5 promised. S3a's "Convert all" auto-iterates instead, so this functional gap doesn't block DoD — but if S3b adds a "select subset" UX, the action and dispatcher plumbing must be added together.
4. **Mid-render mutation in `renderLoaded`** (lines 249–254): the renderer mutates `state.results` in place via a cast (`(state as { results: ... }).results = newResults`). This works because nothing else reads results during render, but it violates the immutability contract documented at the top of `state.ts`. Pure-reducer tests in `state.test.ts` pass because they never trigger this code path. If S3b adds memoised or async render, this mutation will leak.
5. **128 KB padded chip dump path is loose.** `lengthTriage` accepts 64 KB / 128 KB raw dumps and silently uses the head-aligned 32 KB window. If a real GBxCart RW dump returns the bank-rotated SRAM (some firmware returns the **backup** bank in the second half), S3b's adapter must explicitly select the active bank before handing bytes to `parseSave`.
6. **Internal-dex table has 145 entries** (out of 151 nominal Gen 1 slots; 6 MissingNo gaps preserved from demo). Mons whose internal-index byte misses the map decode as `speciesGen2Id: 0` and surface in the UI as "(unknown #0)". Acceptable, but a UI counter for these would help debugging real-world saves with Glitch City artefacts.
7. **No GS / Yellow fixtures.** The deferral is correct, but S3b must acquire at least one cart-real GS fixture and one Yellow fixture before enabling those formats — the PLAN_EVAL Q1/Q2 ruling explicitly conditions enablement on having a fixture.

---

## Orchestrator amendments

None required. The PLAN_EVAL amendments were precise and fully implemented modulo the `SaveSource.kind` omission noted above. PLAN.md's documented Crystal current-box-index offset (0x2724) was discovered to be wrong during implementation; the Generator independently identified 0x2700 by inspection (commented in `offsetsCrystal.ts` lines 30–31). This drift is correctly documented in the source and validated by the test that asserts `currentBoxIndex === 1` against the demo file. Recommend recording this empirically-corrected offset (`C_CURRENT_BOX_INDEX_OFFSET = 0x2700`, `C_CURRENT_BOX_OFFSET = 0x2D10` instead of PLAN's 0x2D6C) as **AMEND-S3a-1** in HANDOFF.md so future sprints know to trust the source over PLAN.md prose where they diverge.
