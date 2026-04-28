# Sprint 8v2.3 Archive — pokeportal v2 commits + abilitySlot fidelity + transfer-box durability

**Status**: PASS (archived 2026-04-28). Shipped on `ui/s8v2-bills-pc`.
**HIL-validated**: source-cart DELETE → SWITCH → dest-cart WRITE confirmed
end-to-end on real hardware (Pokemon Crystal source → Pokemon Emerald dest
via GBxCart RW v1.4 PCB-6).

**Scope**: wire the stub "Commit N staged" / "Commit N placed" buttons in
the trading-pipe lane to the actual write-side flows. Source commit
DELETES selected staged mons from the source SAV (download) or source
cart (flash). Dest commit INJECTS placed staged mons into the dest SAV
(download) or dest cart (flash). Reuses the S7b `flashCart` primitive +
`composeSourceWrite` / `composeDestinationWrite` from `core/`. Adds a
`sourceCommitted` flag per `StagedSlot` so the IDB-backed transfer box
becomes the durable bridge across the source-commit / SWITCH /
dest-commit sequence.

**Test outcome**: 754 tests passing total (453 core + 301 web), bundle
84.62 KB gzipped (cap 120 KB; +5.21 KB vs S8v2.2.1 baseline of 79.41 KB).

**Previous sprint**: S8v2.2.1 (test backfill mini).

**Next milestone**: collapse v2 → main (drop v1 codepaths + `?ui=v2` flag,
remove "v2" naming throughout). v2 IS the product going forward.

---

## Headline architecture

```
Trading-pipe Commit button (per-side)
    ↓
runCommitSource / runCommitDestination (v2Actions.ts)
    ↓
SAV mode: composeSourceWrite/composeDestinationWrite + blobDownload
Cart mode: typed-PROCEED dialog → flashCart (backup → write → verify)
    ↓
On success:
  - source: setSourceCommitted(idx, true) per slot; v2_source_bytes_refreshed
  - dest:   removeAt(idx) per placed slot; v2_dest_bytes_refreshed
    ↓
Bytes refresh re-parses the verified post-flash bytes via deps.parseSave /
deps.parseGen3Save and swaps state.sourceBytes/state.dest.save in-place.
The source-tile is-staged overlay clears automatically because the mon is
gone from state.save.boxes after the re-derivation.
```

---

## What shipped — sprint contract

The Generator/Evaluator loop covered all 21 success criteria + 9
amendments + 3 decisions (PLAN_EVAL.md + EVAL.md). Highlights:

### State machine

- **`StagedSlot.sourceCommitted: boolean`** field added (default false on
  `placeAt`, persists in IDB additively — no schema bump). State-machine
  transitions: `(false, null)` → `(true, null)` after source commit →
  `(true, {dest})` after place → REMOVED after dest commit.
- **4 new reducer actions**: `v2_source_committed`, `v2_dest_committed`,
  `v2_source_bytes_refreshed`, `v2_dest_bytes_refreshed`.

### Handlers (`web/src/ui/v2Actions.ts`)

- **`runCommitSource(deps)`**: state.kind guard, in-flight guard
  (`state.cartFlash.kind` checks per AMEND-S8v2.3-6), filter slots by
  `!sourceCommitted`, sort refs by slot DESC (per HOTFIX — Gen 1/2 box
  compaction would otherwise invalidate later refs sequentially), branch
  SAV vs cart, dispatch bytes refresh on success.
- **`runCommitDestination(deps)`**: state.dest guard, filter slots by
  `placement !== null`, decode pkBytes via `deserializeGen12FromStaging`,
  run `controller.convert(mon)` + `controller.packBoxed(...)` per slot
  (AMEND-S8v2.3-3 — legacy v1 filter `pkBytes.length === 80` would have
  excluded all v2.2 slots).

### confirmFlashDialog widening

- Action union widened to include `'WITH COMMIT'` (per AMEND-S8v2.3-2 +
  DECISION-1). `expectedConfirmString` short-circuits to the literal
  `PROCEED WITH COMMIT` for the v2 path; cart label still rendered in
  dialog body for visual verification.

### Tests

- 7 new test files covering: source commit (SAV + cart), dest commit
  (SAV + cart), `setSourceCommitted` cross-session durability, SWITCH
  unblock predicate, end-to-end stage→source-commit→SWITCH→place→dest-commit
  integration.

---

## Post-PASS hotfixes (HIL-driven)

Found during user testing on real hardware:

### 1. Multi-mon source commit failure

**Symptom**: `composeSourceWrite failed at staged index 7` when committing
14 staged mons.
**Root cause**: `composeSourceWrite` deletes Gen 1/2 mons sequentially, and
Gen 1/2 box deletion COMPACTS — slot 5 → slot 4. Refs were in slot-ASC
order, so after the first delete the original slot-2 ref pointed at a
shifted/missing mon.
**Fix**: `sortRefsForDelete` helper in v2Actions.ts — global slot-DESC sort
before passing to composeSourceWrite. Different (bucket, box) groups are
independent, so a single global sort works.

### 2. Source-tile overlay sticking after commit

**Symptom**: After source commit, the `→ T<n>` badge transferred to the
NEXT mon backfilling the freed slot.
**Root cause**: `stagedSourceRefs` and `stagedSourceTransferSlot`
derivations in ui.ts iterated all slots; didn't filter on
`!sourceCommitted`. After commit, the slot is still occupied
(sourceCommitted=true), so its `sourceRef` (boxIndex+slot) still matched
the new occupant of that physical slot.
**Fix**: filter both arrays by `!s.sourceCommitted` in ui.ts.

### 3. `file_parsed` reducer dropped staging

**Symptom**: Loading a new source SAV emptied the transfer box (data loss
even for already-source-committed mons).
**Root cause**: the `file_parsed` reducer case created a fresh `loaded`
state without preserving `state.staging` (legacy v1 semantics where staging
was tied to a specific source).
**Fix**: in `state.ts`, `file_parsed` now preserves staging, dest, dest
download, v2LeftRole, mode, multiTabBanner — same pattern as `source_clear`.

### 4. Cart-flash dialogs rendered off-page in v2

**Symptom**: PROCEED WITH COMMIT dialog appeared at the bottom of the
viewport (below the fold on the taller v2 workbench layout).
**Root cause**: `.gen2-dialog` / `.confirm-flash-dialog` /
`.flash-progress-overlay` / `.recovery-dialog` had no positioning CSS.
Worked accidentally on v1's shorter layout.
**Fix**: each dialog factory now wraps its output in a
`.flash-modal-backdrop` div — fixed-positioned, semi-opaque navy
backdrop, flex-centered content, drop-shadow on the dialog box. Matches
the cart-loading aesthetic.

### 5. Cart-flash progress overlay missing in v2

**Symptom**: During cart commit, no "DO NOT UNPLUG" overlay rendered
(silent flash).
**Root cause**: `renderV2()` didn't include the cart-flash render block
that legacy `render()` has. When `state.cartFlash` flipped to
`cart_flash_progressing`, no UI surfaced.
**Fix**: added the cart-flash render block to `renderV2` (after the
footer) handling progress + recovery + recovery-failed states.

### 6. Dest stat-inspect showed Lv 1 + Hardy + flat 5 stats

**Symptom**: Native dest mons inspected via the Stat Modal showed
placeholder data instead of the real PID/IVs/EVs/level.
**Root cause**: `makePlaceholderGen3IntermediateFromDestSlot` was a
zero-filled placeholder by design (with a TODO to wire `unpackBoxed`).
**Fix**: call `unpackBoxed(slotData.bytes)` to get the real Gen3Intermediate.
Override `nature = pid % 25` (canonical Gen 3 derivation) and `level =
cuberoot(exp)` (Medium-Fast approximation; exact for ~60% of species,
±a few levels for others — pending a per-species growth-rate table).

### 7. abilitySlot derived from PID (Gen 3 fidelity + pkhex legality)

**Symptom**: pkhex flagged "Ability does not match PID" on ~50% of
converted mons. After fixing, pkhex flagged "Ability does not match
ability number" on 1-ability species when bit=1.
**Root cause #1**: HANDOFF §4.14 hardcoded `abilitySlot()=0` under the
incorrect belief that slot 1 = Hidden Ability. In Gen 3, slot 0 and slot 1
are both regular abilities; the game uses `pid & 1` to pick.
**Root cause #2**: pkhex rejects abilityBit=1 on species with only one
distinct ability (where `Ability1 == Ability2` per pkhex
`PersonalInfo3.HasSecondAbility = Ability1 != Ability2`).
**Fix**: `abilitySlot(pid, hasSecondAbility): 0 | 1` returns
`(pid & 1) as 0 | 1` for 2-ability species, pinned 0 for 1-ability species.
Required `core/src/data/raw/personal-gen3.json` regen with new `ability1`
field (0x17 offset per pkhex `PersonalInfo3.cs:42`). Also relaxed
`unpackBoxed`'s over-strict `abilityBit !== 0` decode check.

### 8. Backup to SAV button wired

Was deferred from S8v2.2 + S8v2.3 plan. Now downloads the active-role's
loaded SAV bytes (source or dest) using the existing `backupFilename`
helper. Disabled when nothing loaded.

### 9. Export/Import Transfer Box (JSON)

- **Export**: dumps `state.staging.slots` as a JSON file containing each
  slot's `pkBytes` (raw byte array — round-trip safe), pkData (decoded
  for human readability), placement, sourceCommitted, etc. Format v2.
- **Import** (debug-only, dashed border + muted styling): clears current
  staging store and re-seeds from the JSON file. Reads `pkBytes`
  byte-for-byte to restore each slot's `Uint8Array` exactly.

### 10. Save to SAV labeled "(not implemented)"

Existing button (was always disabled) now labeled "Save to SAV (not
implemented)" with hover tooltip. Stays disabled — intended feature,
deferred to a future sprint.

### 11. Per-mon Save as .pk2 (Gen 2)

New CTA on the Stat Inspect modal for Source AND Transfer Box mons (Crystal
only). Requires new `core/src/sav/gen2/encoder.ts` (`encodeMonGen2(mon)` —
inverse of the parser's `readMon`). PK2 layout: 32-byte boxed record +
11-byte nickname + 11-byte OT name = 54 bytes (matches pkhex's PK2
convention).

---

## Files touched

**New core**:
- `core/src/sav/gen2/encoder.ts` — Gen 2 mon encoder for PK2 export

**Modified core**:
- `core/src/convert.ts` — `abilitySlot(pid, hasSecondAbility)` call
- `core/src/data/personalInfo.ts` — `ability1` field
- `core/src/data/raw/personal-gen3.json` — regenerated with `ability1`
- `core/src/fields/ability.ts` — derives from PID; pin 0 for 1-ability
- `core/src/index.ts` — `encodeMonGen2` + `EncodedGen2Mon` exports
- `core/src/pack/boxed.ts` — relaxed `abilityBit !== 0` decode check;
  `intermediate.abilitySlot = misc.abilityBit`
- `core/src/types/target.ts` — `abilitySlot: 0 | 1`
- `scripts/gen-personal-info.ts` — read ability2 at offset 0x17

**New web**:
- `web/src/__tests__/stagingStore-sourceCommitted.test.ts`
- `web/src/__tests__/v2-source-commit-sav.test.ts`
- `web/src/__tests__/v2-source-commit-cart.test.ts`
- `web/src/__tests__/v2-dest-commit-sav.test.ts`
- `web/src/__tests__/v2-dest-commit-cart.test.ts`
- `web/src/__tests__/v2-switch-unblock.test.ts`
- `web/src/__tests__/v2-end-to-end-commit.test.ts`

**Modified web**:
- `web/src/cart/stagingStore.ts` — `setSourceCommitted` method
- `web/src/cart/stagingStore.types.ts` — `sourceCommitted` field
- `web/src/state.ts` — 4 new actions, reducer cases, `file_parsed` staging
  preservation
- `web/src/style.css` — `.flash-modal-backdrop`, `.is-source-committed`
  CSS gating, `.wb-import-transfer-json` debug styling
- `web/src/ui.ts` — `unpackBoxed` for dest stat-inspect,
  `stagedSourceRefs` filter, `Backup to SAV` handler, JSON export/import
  handlers, `Save as PK2` handler, cart-flash render block in `renderV2`,
  `runCommitSource` / `runCommitDestination` wrappers
- `web/src/ui/confirmFlashDialog.ts` — `'WITH COMMIT'` action variant +
  backdrop wrap
- `web/src/ui/flashProgressOverlay.ts` — backdrop wrap
- `web/src/ui/recoveryDialog.ts` — backdrop wrap
- `web/src/ui/statScreen.ts` — `onSaveAsPk2` opt + button render
- `web/src/ui/v2Actions.ts` — `runCommitSource`,
  `runCommitDestination`, `pendingDestCommitRefs`, `sortRefsForDelete`,
  Clear-confirm copy update
- `web/src/ui/workbench.ts` — `is-source-committed` class,
  `countPendingSourceCommit`, SWITCH-block predicate refinement,
  Export/Import JSON buttons, "Save to SAV (not implemented)" label
- `web/src/__tests__/_helpers/staging.ts` — `FakeStagingStore.setSourceCommitted`
- `web/src/__tests__/confirmFlashDialog.test.ts` — `'WITH COMMIT'` tests
- `web/src/__tests__/v2-clear-transfer.test.ts` — updated copy assertions
- `tests/fixtures/pkhex/oracle-vectors.json` — regenerated for new
  abilitySlot semantics
- `tests/integration/exports.test.ts` — added `encodeMonGen2`
- `tests/unit/gen3-substructures.test.ts` — `expect(it.abilitySlot)`
  instead of pinned 0

---

## Followups (carried forward)

1. **Collapse v2 → main**: drop v1 codepaths (legacy `render()`,
   comparison overlay, upload-mode UI, `?ui=v2` flag), remove "v2"
   naming throughout. v2 IS the product. Next sprint scope.
2. Per-species growth-rate table → exact level-from-exp computation in
   dest stat-inspect (currently Medium-Fast cuberoot approximation).
3. Save to SAV (real implementation): write transfer box as Crystal SAV.
   Needs a Gen 1/2 inserter (`insertMonGen2` symmetric to
   `deleteMonGen2`) — not shipped this sprint to avoid adding untested
   core code. Encoder is in place from the PK2 work.
4. Send back to source (commit-back from transfer box): user discussed
   this and decided to defer (under-Lv-5 mons are "user trains them up"
   per the same essence-preservation philosophy).
5. Gen 1 (RBY) PK2 export: would need a Gen 1 encoder + type/catch-rate
   data vendor for 151 species. Currently button only enabled for
   Crystal/Gen 2.
6. Backup to SAV button filename says "backup-pre-" (inherited from
   `backupFilename` helper used for pre-flash backups). Cosmetic; could
   add a "manual-backup-" variant.

End of sprint-8v2.3.md.
