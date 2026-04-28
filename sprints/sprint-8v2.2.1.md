# Sprint 8v2.2.1 Archive — pokeportal v2 test backfill mini

**Status**: PASS (archived 2026-04-27). Shipped on `ui/s8v2-bills-pc`.

**Scope**: backfill the 6 integration test files identified by the S8v2.2
Code Evaluator's followup list, rewire `v2-add-to-dest-no-remove.test.ts`
to invoke the actual production handler against a real `StagingStore`
(fixing the prior sprint's contractual-not-behavioural smell), and add
the AMEND-S8v2.2-10 dialog-copy substring assertion. The minimal
permitted production-code change was a clean byte-for-byte extraction
of three v2 staging closures from `web/src/ui.ts` into a new module
`web/src/ui/v2Actions.ts` so the handlers became directly invokable
from tests.

**Test outcome**: 269 tests passing (42 files), bundle 79.41 KB
gzipped (cap 120 KB; +110 bytes vs S8v2.2 baseline of 79.30 KB).

**Previous sprint**: S8v2.2 (multi-select + transfer-box staging).

**Next sprint**: S8v2.3 — actual commits. Wire the stub "Commit N
staged/placed" buttons to source-cart DELETE and dest-cart WRITE.
Typed-PROCEED gate per S7b discipline. Backup-to-SAV button.

---

## What shipped

### Production-code refactor — `web/src/ui/v2Actions.ts` (NEW, ~280 lines)

Three closures previously living inside `renderV2()` in `web/src/ui.ts`
were extracted into pure functions on a new module:

- `runAddSelectedToTransfer(deps, refsOverride?)` — handles the LEFT-pane
  "Add to Transfer Box" button + the Stat Inspect modal's single-mon
  variant. Skips party-bucket mons. Pre-conversion via `convertGen12()`
  so `slot.speciesId` carries the POST-conv ndex (AMEND-S8v2.2-8).
  `pkBytes` is sentinel-byte JSON snapshot via `serializeGen12ForStaging`.
- `runAddSelectedToDestination(deps, idxsOverride?)` — places staged
  mons into the dest cursor; advances cursor; sets `placement` per slot.
  Body verified to never call `removeAt` or `clear` (the load-bearing
  v2.3 boundary — `v2-add-to-dest-no-remove.test.ts` now asserts this
  against the REAL function, not a re-implementation).
- `runClearTransferBox(deps, dispatch, refresh, confirmDialog)` — confirm
  dialog with copy mentioning "N staged mons" + "pending placements"
  (AMEND-S8v2.2-10). The `confirmDialog` callback is **dependency-injected**
  rather than imported (Generator deviation, well-justified — DI keeps
  the production wrapper trivial and makes the test contract explicit).

The closures in `ui.ts` became 1-line wrappers delegating to these.
**Pure refactor — same behaviour, same call sites.** Confirmed via
zero-diff in production behaviour: bundle delta is +110 bytes
(handler-extraction overhead), all 256 prior tests still pass without
modification.

### New test files — `web/src/__tests__/`

Six new integration test files, 13 new tests total, all invoking the
production handlers from `v2Actions.ts`:

1. `v2-source-stage-flow.test.ts` (3 tests) — source → TRANSFER COPY
   pipeline: `placeAt` count, monotonic idx, `pkBytes` sentinel,
   POST-conv `speciesId` (Lugia 249 → 1 via fakeConvertWithRemap),
   non-mutation of `state.sourceBytes` and `state.save`, selection
   clear, party-bucket skip + party-skip banner.
2. `v2-transfer-dest-flow.test.ts` (1 test) — `setPlacement` count
   (5×), `destBoxIndex` correctness, skip-occupied advance ([0,1,3,4,5]
   over slot-2-occupied), `removeAt`/`clear` never called, no
   `state.dest.save` mutation, `v2_transfer_select_clear` dispatched.
3. `v2-clear-transfer.test.ts` (3 tests) — dialog text contains
   "7 staged mons" AND "pending placements" (AMEND-S8v2.2-10), confirm
   path calls `clear()`, cancel path doesn't, `occupied===0` early-return.
4. `v2-transfer-full-banner.test.ts` (2 tests) — 28+5→banner.skipped===3
   (with reducer round-trip to confirm `transferBoxFullBanner` field),
   30+5→0 placeAt + banner.skipped===5.
5. `v2-placement-collision.test.ts` (2 tests) — cursor advance over
   pre-placed staging slots ([2,3]→[1,3] over pre-placed [0,2]); variant
   asserts cursor skips BOTH dest-cart occupants AND staging-previews
   (selection [1,2,3,4]→destSlots [1,2,3,5]).
6. `v2-staged-overlay-source-tile.test.ts` (2 tests) — source-tile
   `is-staged` class + `source-tile-staged-badge` child + zero-padded
   "T01" badge text; switching boxes lights up the right slot.

### Rewired test — `v2-add-to-dest-no-remove.test.ts`

The dedicated negative-assertion test (the load-bearing AMEND-S8v2.2-6)
no longer re-implements the handler's contract. It now:

- Imports the real `runAddSelectedToDestination` from `../ui/v2Actions.js`.
- Uses a real `StagingStore.open(nextDbName())` backed by
  `fake-indexeddb/auto`.
- Spies on the REAL class methods (`setSpy`, `removeSpy`, `clearSpy`).
- Asserts `removeAt` and `clear` are NEVER called, `setPlacement` IS
  called per selected slot, AND slots 0..2 still occupied with
  `placement !== null` after the run (proves the move-out boundary).

A regression in `v2Actions.ts` (e.g. someone adding a `removeAt(idx)`
in the placement loop) WOULD now fail this test — a guarantee the
prior sprint's contractual test couldn't make.

### Shared test helpers — `web/src/__tests__/_helpers/staging.ts` (NEW)

Five test files import from this new shared module:
`makeGen2Mon`, `makeGen2SaveWithBox0`, `makeGen3Save`, `makeSlot`,
`FakeStagingStore`, `emptySlots`. Each helper has single responsibility
and no surprise behaviour. Extracting `FakeStagingStore` (~80 lines)
alone saved ~400 lines of would-be duplication.

---

## EVAL.md verdict

**APPROVE → ready for S8v2.3 (commits).** All 10 success criteria PASS
(1 with a documented box-index disambiguation caveat that doesn't affect
correctness). Tier 4 out-of-scope discipline excellent: `core/` zero
diff, cart protocol files zero diff, `package.json` zero diff, no new
production features.

**Minor smells flagged for future cleanup (non-blocking)**:

1. `makeDeps` ControllerDeps stub duplicated across 5 test files — could
   move into `_helpers/staging.ts`.
2. `neutralIntermediate` / `fakeIntermediate` Gen3Intermediate builders
   near-duplicated across 2 test files — same destination.
3. `v2Actions.ts` has private copies of `monAt`, `familyFromSaveFormat`,
   `stagingMutate` (also in `ui.ts`). Consolidate when a third caller
   emerges.
4. `runClearTransferBox` takes `dispatch` but never uses it — drop
   from signature.
5. `FakeStagingStore.pendingMigrationOverflow = 0` exposed publicly for
   structural-cast compat — same as prior EVAL's smell #5.

---

## Files touched

**New:**
- `web/src/ui/v2Actions.ts` — handler extraction (criterion 7).
- `web/src/__tests__/_helpers/staging.ts` — shared test helpers.
- `web/src/__tests__/v2-source-stage-flow.test.ts` (criterion 1).
- `web/src/__tests__/v2-transfer-dest-flow.test.ts` (criterion 2).
- `web/src/__tests__/v2-clear-transfer.test.ts` (criterion 3).
- `web/src/__tests__/v2-transfer-full-banner.test.ts` (criterion 4).
- `web/src/__tests__/v2-placement-collision.test.ts` (criterion 5).
- `web/src/__tests__/v2-staged-overlay-source-tile.test.ts` (criterion 6).

**Modified:**
- `web/src/ui.ts` — three closures replaced with thin wrappers
  delegating to `v2Actions.ts`; cleaned up two now-unused imports
  (`decodeGen12`, `serializeGen12ForStaging`).
- `web/src/__tests__/v2-add-to-dest-no-remove.test.ts` — rewired to
  invoke real production handler against real `StagingStore`.

---

## Followups (S8v2.3+)

1. Wire `Commit N staged` button to source-cart DELETE flow.
2. Wire `Commit N placed` button to dest-cart WRITE flow.
3. Typed-PROCEED gate per S7b.
4. Backup-to-SAV button wiring.
5. Move `makeDeps` boilerplate into `_helpers/staging.ts` (Tier 5 smell #1).
6. Consolidate Gen3Intermediate test builders (Tier 5 smell #2).
7. Drop unused `dispatch` from `runClearTransferBox` signature (Tier 5 smell #4).
8. `consumeMigrationOverflow(): number` API on StagingStore to remove
   external mutation of `pendingMigrationOverflow` (carried from S8v2.2).

End of sprint-8v2.2.1.md.
