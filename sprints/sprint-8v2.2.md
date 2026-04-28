# Sprint 8v2.2 Archive — pokeportal v2 multi-select + transfer-box staging

**Status**: PASS (archived 2026-04-26). Shipped on `ui/s8v2-bills-pc`.

**Scope**: extend the v2 workbench (`?ui=v2`) so the user can select source/dest
mons (single-click / cmd-click / shift-range), push them into the IDB-backed
`StagingStore` rewritten to a slot-addressed 30-slot fixed-capacity model
(1:1 with a Gen 3 PC box), render the staged mons as the RIGHT-pane TRANSFER
BOX with post-conversion Gen 3 sprites, and let the user pre-assign each
staged slot a `placement` cursor target on the loaded destination box —
without writing any cart bytes (commits remain S8v2.3).

Layered on top of the contract sprint, the polish pass shipped pixel-faithful
**Stat Inspect modal** rebuilds for RBY (Gen 1), GSC (Gen 2), and FRLG (Gen 3
AFTER), the v2 "Add to Transfer Box" / "Send to Destination" / "Cancel Send"
controls on the modal, the Transfer Box → Destination preview pipeline with
ghost styling, and the trading-pipe "Commit N staged" stub.

**Test outcome**: 256 tests passing (36 files), bundle 79302 bytes gzipped
(cap 120 KB; +14 KB vs S8v2.1's 65.27 KB end-of-sprint). Generator's S8v2.2
contract pass landed at 70.73 KB; the +9 KB delta comes from the post-PASS
polish (stat-screen renderers + vendored ability table + gen3 typing table).

**Previous sprint**: S8v2.1 (LEFT-pane loaded state — source SAV/cart → gen 2
box, dest SAV/cart → gen 3 box).

**Next sprint**: S8v2.3 — candidate scope: COMMIT button wiring (S8v2.2
shipped a stub `alert()`), source-cart DELETE flow on commit, dest-cart WRITE
flow on commit, typed-PROCEED gate per S7b, backup-to-SAV button wiring,
backfill the 6 missing integration test files called out in EVAL §6.6.

---

## Headline architecture

```
v2 RIGHT pane = TRANSFER BOX (slot-addressed, 30 slots)
    ↑
    StagingStore (IDB-backed, slot-addressed rewrite)
    ↑
    runAddSelectedToTransfer  ← LEFT pane (source role) "Add" button
                              + Stat Inspect modal "Add to Transfer Box"
    ↓
    runAddSelectedToDestination → setPlacement(idx, {destBox, destSlot, ...})
                                 ← LEFT pane (dest role) "Add" button
                                 + Stat Inspect modal "Send to Destination"
    ↓
    previewedPlacements: ReadonlyMap<destBoxIndex, ReadonlyMap<destSlot, StagedSlot>>
                        ← computed in buildWorkbenchProps
                        → consumed by destBoxBrowser to overlay placed mons
                          on the dest box without mutating state.dest.save
```

The `placement` field is the key v2.2 innovation: staged mons can be
pre-assigned to dest slots without leaving the transfer box. The actual
MOVE-out-of-transfer (`removeAt` per placed slot) is S8v2.3 commit scope.

---

## What shipped — in detail

### Slot-addressed StagingStore rewrite (`web/src/cart/stagingStore.ts`)

- New API: `placeAt(idx, payload)` / `removeAt(idx)` / `setPlacement(idx, p)` /
  `clear()` / `getSlot(idx)` / `getAllSlots()` / `occupiedSlots()` /
  `nextEmptySlot()` / `isStaged(sourceRefKey)`.
- Old StagedMon-list API preserved as `@deprecated` shims (`stageMon`,
  `unstageMon`, `setDestination`, legacy `subscribe(session => …)`) so
  S7b-era code (`stagingPane.ts`, legacy `ui.ts` paths) keeps working.
- IDB v1 → v2 structural migration triggered by detection of `'stagedMons'`
  key (NOT a schemaVersion bump — IDB version stays at 1). Migration
  handles: well-formed v1 records, corrupt entries (skipped + logged),
  destFormat 5-way ↔ 2-way mapping, and overflow when v1 had >30 staged
  mons (`pendingMigrationOverflow` counter consumed by controller-init
  dispatch into `staging_migration_overflow` action → banner).

### Selection model (`web/src/state.ts`)

- Three independent reducer-owned selections on `CartSlot`:
  `v2SourceSelection` (MonRef[]), `v2DestSelection` (MonRef[]),
  `v2TransferSelection` (slot-index[]).
- New actions: `v2_select_toggle`, `v2_select_clear`,
  `v2_transfer_select_toggle`, `v2_transfer_select_clear`,
  `v2_transfer_box_full`, `v2_transfer_box_full_dismiss`,
  `v2_transfer_placement_overflow`, `v2_transfer_placement_overflow_dismiss`,
  `v2_transfer_convert_skip`, `v2_transfer_convert_skip_dismiss`,
  `v2_transfer_party_skip`, `v2_transfer_party_skip_dismiss`,
  `v2_select_all_transfer_box`, `staging_migration_overflow`,
  `staging_migration_overflow_dismiss`.
- `withSelectionsCleared` helper called from all 11 context-shift actions
  (role switch, box change, source/dest clear, reset, etc.) so selections
  never survive a context boundary.
- `state.staging` carries BOTH `slots` (new 30-array) AND `stagedMons`
  (derived via `slotToLegacyMon` adapter) so legacy `stagingPane.ts` reads
  keep working unmodified.

### v2 controller wiring (`web/src/ui.ts`)

- `runAddSelectedToTransfer(refsOverride?)` — handles BOTH the LEFT-pane
  "Add" button (uses `v2SourceSelection`) AND the Stat Inspect modal's
  "Add to Transfer Box" single-mon path. Skips party-bucket mons (party
  mons can't transfer; banner counts skipped). Pre-conversion via
  `convertGen12()` so `slot.speciesId` carries the POST-conv ndex
  (AMEND-S8v2.2-8). `pkBytes` is sentinel-byte JSON snapshot of the
  source-format Gen 1/2 record (see `stagingPayload.ts`).
- `runAddSelectedToDestination(idxsOverride?)` — places staged mons into
  the dest cursor; advances cursor; sets `placement` per slot. Verified
  to never call `removeAt` or `clear` (the load-bearing v2.3 boundary —
  dedicated negative-assertion test in
  `__tests__/v2-add-to-dest-no-remove.test.ts`).
- `runClearTransferBox` — confirm dialog with copy mentioning
  "N staged mons" + "pending placements" (AMEND-S8v2.2-10).
- Block SWITCH TO DESTINATION when uncommitted staged source mons exist
  (button stays in original label, just disabled with explanatory tooltip).

### Workbench layout (`web/src/ui/workbench.ts`)

- RIGHT pane renders TRANSFER BOX from `state.staging.slots` (30-array).
  Tiles: `is-empty` / `is-occupied` / `is-selected` / `is-placed`
  + `→ B<n>/S<nn>` arrow badge for placed slots. Read-only in source role
  (no click handler); selectable in destination role (cmd/ctrl/shift mods
  forwarded to controller).
- Source LEFT-pane tiles get a mirroring `→ T<n>` badge + dashed gold ghost
  outline (60% opacity) when staged but not yet committed — the visual
  symmetry that signals "this mon is in flight".
- Banner stack above TRANSFER BOX label: multi-tab claim, migration
  overflow, transfer-box full, placement overflow, convert-skip,
  party-skip — all dismissible.
- Trading-pipe lane between LEFT and RIGHT panes hosts the "Commit N
  staged / N placed" button (S8v2.2 stub fires `alert("S8v2.3")`).
- "Clear Transfer Box" button under RIGHT pane; disabled when empty.
- "Select all in Transfer" button (symmetric with LEFT pane's
  "Select all in box").

### Stat Inspect modal — pixel-faithful Gen 1/2/3 stat screens

A from-scratch redesign of the per-mon detail popover, replacing the
S8v2.1 "spacious table that doesn't align" with image-template overlays
matching the canonical in-game UI of each generation. Implementation:
vendored bg PNG (cleaned of original-game text) + CSS-positioned text
overlays at flood-fill-detected placeholder coordinates, scaled by a CSS
custom property.

**RBY (Gen 1)** — `renderRbyStatScreen` in `statScreen.ts`. Vendored
`rby-stats-template.png` cleaned to a blank template. Pokemon Emerald
font (TTF → woff2 via fonttools). Greyscale Gen 1 sprite. No. <ndex>
right-aligned per Rhydon reference. `1.75x` display scale (matches GSC).

**GSC (Gen 2)** — `renderGscStatScreen`. Vendored
`gsc-stats-template-clean.png`. Canonical icons cropped from
`gsc-menus.png` (HP:, :L, shiny mark ✨, ♂/♀). Gen 2 gender via
`gen2Gender(dvs, ratio)` from atk DV (NOT trainer's gender). Shiny via
`gen2Shiny(dvs)` from core. `1.75x` display scale.

**FR/LG (Gen 3 AFTER)** — `renderFrlgAfterPanel`. Vendored `bg_skills.png`
from a Pokemon Essentials FRLG plugin. Composited: gen 3 party sprite,
HP bar from vendored `overlay_hp.png`, Pokeball icon, ability info from
vendored `gen3Abilities.ts` (78-entry lookup), nature from neutral
bucket map, shiny star indicator. Pokemon Emerald font. `0.656x` scale
(336×252 native).

**3×2 stat-grid** — `renderGen3UnifiedCard`. Replaces the wide table with
six per-stat cards (HP, Atk, Def, Spe, SpA, SpD). Each card shows:
final value (color-coded by ±delta), DV→IV transition, StatExp→EV
transition. Dashboard-themed pixel-art chunky borders + scanline overlay
+ navy "STAT INSPECT" title strip.

**Modal action buttons** — context-aware label (`"Add to Transfer Box"` /
`"Party mons can't transfer"` / `"Already in Transfer"` /
`"Transfer Box full"` / `"Send to Destination"` / `"Cancel Send"`) with
matching disabled state. Source-side, dest-side, and transfer-side click
paths all open the same modal; the controller decides which CTAs to render.

### Vendored binary assets

- 251 `web/public/sprites/gen3-shiny/<n>.png` (PokeAPI emerald shiny set)
- 251 `web/public/sprites/crystal-shiny/<n>.png`
- 251 `web/public/sprites/crystal-anim-shiny/<n>.gif`
- 251 patched `web/public/sprites/party-gen2/<n>.png` (16×33 with 1px
  transparent gutter row — workaround for Chromium subpixel rounding leak)
- 386 patched `web/public/sprites/party-gen3/<n>.png` (32×65 with gutter)
- `web/public/fonts/pokemon-emerald.woff2` (Pokemon Emerald font, 9.7 KB)
- `web/public/sprites/stat-screens/{gsc,rby}-stats-template-clean.png`
- `web/public/sprites/stat-screens/frlg-skills-bg.png`
- `web/public/sprites/stat-screens/frlg-overlay-hp.png`
- `web/public/sprites/stat-screens/frlg-icon-pokeball.png`
- `web/public/sprites/stat-screens/frlg-shiny-star.png`
- `web/public/sprites/stat-screens/gsc-shiny-mark.png`
- `web/public/sprites/stat-screens/gsc-icon-{hp,l,male,female}.png`

### Critical bug fixes during this sprint

1. **CSS minifier hoisting bug** — Vite's CSS minifier was taking scoped
   overrides of `.ss-section-tag .party-icon-img` and hoisting them into
   a bare `.party-icon-img` global rule, breaking box-browser party-icon
   bounce animation site-wide. Fix: replaced selector overrides on
   `.party-icon-img` with a custom `.ss-tag-icon` wrapper class styled
   via `transform: scale()` instead of dimensions. Discipline: never
   write a CSS rule ending in `.party-icon-img` for overrides.
2. **PNG strip subpixel leak** — Even with the wrapper class fix, scaled
   sprite-strip frames showed the next frame leaking under the current
   one (fire flames under Typhlosion, etc.). Fix: PIL script patched all
   251 gen2 + 386 gen3 party-icon PNGs to add a 1-px transparent gutter
   row between strip frames.
3. **Wrong gender on stat-screen BEFORE panel** — initial impl used
   `mon.otGender` (the trainer's gender) instead of the mon's. Fix:
   import `gen2Gender` from core, derive from atk DV.

---

## EVAL.md verdict (pre-polish)

The Code Evaluator subagent's verdict on the contract pass (before the
post-PASS polish work): **PASS WITH CAVEATS**.

- All 12 amendments landed.
- All 16 success criteria met.
- 12/12 amendments PASS (2 with minor test-coverage caveats).
- Tier 1 gating: `bun run typecheck` exit 0; `bun run lint` exit 0;
  `cd web && bun run build` exit 0; `bun run test` 36 files / 256 tests.
- Tier 4 out-of-scope: zero diff in `core/`, `cartReader.ts`,
  `cartFlasher.ts`; legacy paths preserved verbatim; `?ui=v2` opt-in
  preserved.

Caveats (carried into S8v2.3 backlog):

- 6 integration test files called out in PLAN §7 are missing:
  `v2-source-stage-flow`, `v2-transfer-dest-flow`, `v2-clear-transfer`,
  `v2-transfer-full-banner`, `v2-placement-collision`,
  `v2-staged-overlay-source-tile`. The CRITICAL ones (slot-api,
  migration, controller-subscribe, no-remove, selection reducer,
  transfer-box render) are all present.
- `v2-add-to-dest-no-remove.test.ts` re-implements the production
  handler's contract rather than directly invoking the production
  `runAddSelectedToDestination` from `ui.ts:1195`. Recommend wiring
  the real handler in S8v2.3.
- Confirm-dialog copy substring assertion missing for AMEND-S8v2.2-10
  (production code emits the right copy at `ui.ts:1290`; no test
  enforces it).

---

## Files touched (high level)

- `web/src/cart/stagingStore.ts` — slot-addressed rewrite + IDB v1→v2 migration
- `web/src/cart/stagingStore.types.ts` — `StagedSlot` / `StagedPlacement` types
- `web/src/cart/stagingPayload.ts` — NEW; sentinel-byte JSON snapshot codec
- `web/src/state.ts` — selection model, new actions, dual `slots`+`stagedMons` field
- `web/src/ui.ts` — controller wiring (runAddSelectedToTransfer / Destination, Clear)
- `web/src/ui/workbench.ts` — TRANSFER BOX renderer, banner stack, trading-pipe lane
- `web/src/ui/boxBrowser.ts` — `is-staged` overlay + `→ T<n>` badge on source tiles
- `web/src/ui/destBoxBrowser.ts` — `previewedPlacements` overlay rendering
- `web/src/ui/statScreen.ts` — NEW; RBY/GSC/FRLG image-template stat-screen renderers
- `web/src/ui/gen3Abilities.ts` — NEW; 78-entry ability ID→name+description
- `web/src/ui/pokemonTypesGen2.ts` — NEW; 251-entry pre-Gen-6 typing table
- `web/src/style.css` — modal scanlines, 3×2 stat grid, ghost styling, .ss-tag-icon
- `web/src/__tests__/stagingStore-migration.test.ts` — NEW
- `web/src/__tests__/stagingStore-slots.test.ts` — NEW
- `web/src/__tests__/state-v2Selection.test.ts` — NEW
- `web/src/__tests__/v2-add-to-dest-no-remove.test.ts` — NEW (per AMEND-S8v2.2-6)
- `web/src/__tests__/v2-controller-staging-subscribe.test.ts` — NEW
- `web/src/__tests__/v2-transfer-box-render.test.ts` — NEW
- 251 `web/public/sprites/party-gen2/*.png` — gutter-row patched
- 386 `web/public/sprites/party-gen3/*.png` — gutter-row patched
- vendored asset packs (see "Vendored binary assets" section above)

---

## Followups (S8v2.3+)

1. Wire `Commit N staged` button to actual source-cart DELETE flow (currently
   stub `alert()`).
2. Wire `Commit N placed` button to actual dest-cart WRITE flow (currently
   stub `alert()`).
3. Typed-PROCEED gate (`PROCEED <ACTION> <CART-LABEL>`) per S7b discipline.
4. Backfill 6 missing integration test files from EVAL §6.6.
5. Wire `v2-add-to-dest-no-remove.test.ts` to the actual production handler
   (drop the duplicated `runAddSelectedToDestinationContract` helper).
6. AMEND-S8v2.2-10 substring assertion test for Clear-confirm dialog copy.
7. Backup-to-SAV button wiring (S8v2.x deferred).
8. `consumeMigrationOverflow(): number` API on StagingStore to remove the
   external mutation of `pendingMigrationOverflow` from `ui.ts:245`
   (encapsulation followup from EVAL §6.5).
9. GS Ball "anime trade" animation polish on commit (queued post-S7
   followup, deferred again).

End of sprint-8v2.2.md.
