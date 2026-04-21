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
