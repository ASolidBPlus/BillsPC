# PLAN.md — Sprint S8v2.3 (commits — source DELETE + dest WRITE)

> Branch: `ui/s8v2-bills-pc`
> Starts from: `83d189b` (S8v2.2.1 test backfill mini archived)
> Generator's job: wire the stub "Commit N staged" / "Commit N placed" buttons to the
> actual write-side flows. Source commit DELETES selected staged mons from the source
> SAV (download) or source cart (flash). Dest commit INJECTS placed staged mons into
> the dest SAV (download) or dest cart (flash). Reuses the S7b `flashCart` primitive +
> existing `composeSourceWrite` / `composeDestinationWrite` from `core/`. Adds a
> `sourceCommitted` flag per StagedSlot so the transfer box can hold mid-flow state
> across sessions (durable IDB-backed bridge).

---

## 1. Sprint contract

### One-line summary

Replace the two stub Commit buttons in the trading-pipe lane with the real write-side
flows. SAV-mode commits trigger a download of the modified SAV; cart-mode commits go
through the S7b `flashCart` (backup → write → verify) with a typed-PROCEED gate.
Staging-store slots track `sourceCommitted: boolean` so the IDB-backed transfer box
becomes the durable bridge across the source-commit / SWITCH / dest-commit sequence.
After successful source commit → slot's `sourceCommitted` flips to true (ghost styling
drops). After successful dest commit → slot is REMOVED from the transfer box.

### Flow (canonical, per user)

```
1. Load source (SAV or cart) — already working (S8v2.1)
2. Select source mons, "Add to Transfer Box" — already working (S8v2.2)
3. ▶ NEW: Commit source — DELETE from source SAV/cart
4. SWITCH TO DESTINATION — already working (S8v2.1; was blocked by uncommitted
   staged source mons in S8v2.2; now unblocks once all staged are sourceCommitted)
5. Place mons on dest (drives setPlacement) — already working (S8v2.2)
6. ▶ NEW: Commit destination — WRITE to dest SAV/cart
```

### Success criteria (each item is testable)

For all criteria below, "v2" means `?ui=v2` URL flag set.

#### State machine

1. **`StagedSlot` gains `sourceCommitted: boolean` field** (defaults to `false` on
   `placeAt`). Stored in IDB v2 schema (no schema bump — additive field; old records
   read back default to `false`).

2. **Source-commit state-machine transitions for a slot:**
   - `(sourceCommitted: false, placement: null)` ← initial, after `placeAt`. Has dashed-gold
     ghost outline + source-tile `is-staged` overlay + `→ T<n>` source-tile badge.
   - `(sourceCommitted: true,  placement: null)` ← after successful source commit. NO ghost
     ring. Source-tile overlay/badge clears automatically (source bytes updated → tile
     no longer renders the mon at that ref → no overlay match).
   - `(sourceCommitted: true,  placement: {…})` ← after `setPlacement`. NO ghost. Has
     `→ B<n>/S<nn>` placed badge. Visible on dest preview.
   - Slot REMOVED from transfer box ← after successful dest commit.

3. **`placeAt` rejects with descriptive error if any pre-existing slot has
   `sourceCommitted: true` matching the same `sourceRefKey`** (since the source bytes
   have been updated, the same mon physically can't be re-staged from the same
   location). Documented inline.

#### Source commit handler

4. **`runCommitSource(deps, dispatch, refresh)` in `web/src/ui/v2Actions.ts`.**
   - Pre-condition: source loaded; transfer box has ≥1 slot with `sourceCommitted: false`.
   - Selects ALL slots with `sourceCommitted: false` (all-or-nothing per commit; not a
     per-slot opt-in).
   - Branches on `state.kind`:
     - **SAV mode** (`state.cartConnection === null`):
       - Compute modified bytes via `composeSourceWrite(state.sourceBytes, refs)`.
       - On success → `blobDownload(state.fileName, modified)` (filename matches the
         loaded SAV; user gets prompted to overwrite their original).
       - Dispatch `v2_source_committed({ slotIdxs: [...] })` — flips the flag on each
         slot via `stagingStore.setSourceCommitted(idx)` (new method; slot mutation,
         persists in IDB).
       - No typed-PROCEED gate (in-memory bytes; user has the original SAV on disk).
     - **Cart mode** (`state.cartConnection !== null`):
       - Show typed-PROCEED dialog: `PROCEED COMMIT-SOURCE <CART-LABEL-DASHED>`
         (reuses S7b `confirmFlashDialog`).
       - On confirm → call `flashCart(deps.flashDeps, opts)` directly (NOT the legacy
         `runCartFlash` wrapper, which reads ALL `stagedMons`). Build `opts.bytes` via
         `composeSourceWrite(state.sourceBytes, filteredRefs)` where `filteredRefs`
         only includes the `!sourceCommitted` slots.
       - On `flash_succeeded` → dispatch `v2_source_committed({ slotIdxs: [...] })`.
       - On `flash_failed` → existing recovery dialog flow (per S7b).

5. **Staging mutation rule on source commit success:**
   - Each committed slot gets `sourceCommitted: true` (preserves `placement`,
     `pkBytes`, `speciesId`, etc.).
   - The mon's source-tile `is-staged` overlay clears AUTOMATICALLY because
     `state.sourceBytes` no longer has the mon at that ref (next render of
     `boxBrowser` shows the slot empty; no `stagedSourceRefs` match).
   - `stagedSourceRefs` (controller-derived array) updates: now only includes
     refs from slots where `sourceCommitted === false` (so mid-flow re-staging
     is correctly tracked).

#### Dest commit handler

6. **`runCommitDestination(deps, dispatch, refresh)` in `web/src/ui/v2Actions.ts`.**
   - Pre-condition: dest loaded; transfer box has ≥1 slot with `placement !== null`.
   - Selects ALL slots with `placement !== null` (all-or-nothing per commit).
   - Branches on `state.dest.kind` semantics (SAV vs cart, mirror of source):
     - **SAV mode**:
       - Compute modified bytes via `composeDestinationWrite(state.dest.save, refs)`.
       - On success → `blobDownload(state.dest.fileName, modified)`.
       - Dispatch `v2_dest_committed({ slotIdxs: [...] })` — REMOVES each committed
         slot from the staging store via `stagingStore.removeAt(idx)`.
       - No typed-PROCEED gate.
     - **Cart mode**:
       - Show typed-PROCEED dialog: `PROCEED COMMIT-DEST <CART-LABEL-DASHED>`.
       - On confirm → `flashCart(deps.flashDeps, opts)` with bytes from
         `composeDestinationWrite(state.dest.save, filteredRefs)`.
       - On `flash_succeeded` → dispatch `v2_dest_committed({ slotIdxs: [...] })`.
       - On `flash_failed` → existing recovery dialog flow.

7. **Staging mutation rule on dest commit success:**
   - Each committed slot is REMOVED via `stagingStore.removeAt(idx)`.
   - The dest-pane preview overlay clears AUTOMATICALLY because the slot is gone from
     `state.staging.slots` → `previewedPlacements` no longer includes it.
   - The mon NOW renders on the dest box because `state.dest.save.bytes` has been
     replaced with the post-commit bytes (re-decoded by the existing dest reload path
     — see criterion 9).

#### State refresh after commit

8. **After successful source commit (cart mode):** the cart's bytes have been written
   AND verified. Update `state.sourceBytes` (and re-derive `state.save`) to reflect
   the new cart contents. Reuse the existing `flash_succeeded` reducer path which
   already does this for the legacy v1 staging flow (verify by reading the code).

9. **After successful dest commit (cart mode):** same as criterion 8 but for
   `state.dest.save.bytes`. Existing `flash_succeeded` reducer for `target ===
   'destination'` should handle this; verify.

10. **After successful SAV-mode commit (either side):** `state.sourceBytes` /
    `state.dest.save.bytes` are mutated in-memory IN PARALLEL with the download
    trigger. The user's downloaded file is the same bytes the in-memory state shows.
    No reload prompt — the user can keep working.

#### UI wiring

11. **Trading-pipe `Commit N staged` button** (visible in source role) wires to
    `runCommitSource`. The count `N` is `slots.filter(s => s !== null && !s.sourceCommitted).length`.
    Disabled when N === 0. Tooltip reflects state (e.g. "Nothing to commit" when N === 0,
    or "Connect destination cart first" if dest cart is required first — TBD if the
    flow ordering needs that, see Q in §3 below).

12. **Trading-pipe `Commit N placed` button** (visible in dest role) wires to
    `runCommitDestination`. The count `N` is
    `slots.filter(s => s !== null && s.placement !== null).length`. Disabled when N === 0.

13. **SWITCH-block lift:** the existing S8v2.2 SWITCH block triggers when
    `state.staging.slots.some(s => s !== null && !s.sourceCommitted)`. (S8v2.2 used
    `stagedSourceRefs.length > 0`; now refined to `!sourceCommitted` so the
    source-committed/awaiting-place state allows SWITCH.)

14. **Visual state — dashed-gold ghost on transfer-box tiles** renders only for
    `slot.sourceCommitted === false`. After source commit, ghost drops; tile renders
    with normal styling (or a new "committed" border treatment — TBD if a positive
    visual cue is desired; see Q in §3).

15. **Visual state — source-tile overlay** (`is-staged` class + `→ T<n>` badge)
    renders only when `stagedSourceRefs` includes the ref. Since `stagedSourceRefs`
    is now filtered by `!sourceCommitted` (per criterion 5), the overlay
    AUTOMATICALLY clears after source commit. Existing rendering code in
    `boxBrowser.ts` requires no changes.

#### Failure handling

16. **Mid-flow failure preserves the transfer box.** If source commit FAILS (cart
    write error, recovery exhausted, etc.) → no slots are mutated. The transfer box
    looks identical to pre-commit. User can retry.

17. **Cross-session durability.** The `sourceCommitted` flag persists in IDB. User
    can: source-commit → close browser → reopen → see transfer box with mons in
    `(sourceCommitted: true, placement: null)` state → SWITCH → place → dest-commit.

18. **Multi-tab safety during commit.** While a commit is in flight (active
    `flashCart` call), other tabs that have the staging store open MUST NOT mutate
    `slots` until the commit settles. This is mostly handled by the existing
    BroadcastChannel claim handshake (per S7b), but the v2.3 commit handlers should
    guard against overlapping commits within the same tab via a `commitInFlight`
    flag (or via reusing the existing `state.flashState.target` indicator). On
    overlap → the second click is a no-op.

#### Tier 1 gates

19. **`bun run typecheck` exits 0; `bun run lint` exits 0.**

20. **Bundle size.** Stays under 120 KB gz. New code is small (~3-5 KB gz for the two
    commit handlers + the SAV-vs-cart branch + the new `setSourceCommitted` store
    method + the v2_source_committed/v2_dest_committed reducer cases).

21. **Tests.** All 269 existing tests still pass. New tests:
    - `v2-source-commit-sav.test.ts` — SAV-mode source commit: `composeSourceWrite`
      called with filtered refs; `blobDownload` invoked with right filename + bytes;
      `v2_source_committed` dispatched with correct slotIdxs; slots flipped.
    - `v2-source-commit-cart.test.ts` — cart-mode source commit: typed-PROCEED dialog
      enforced; `flashCart` called with composed bytes; on success, slots flipped;
      on failure, slots untouched.
    - `v2-dest-commit-sav.test.ts` — symmetric for dest.
    - `v2-dest-commit-cart.test.ts` — symmetric for dest.
    - `stagingStore-sourceCommitted.test.ts` — `setSourceCommitted` API: persists in
      IDB, emits subscribe event, default false on placeAt, preserves other fields.
    - `v2-switch-unblock.test.ts` — SWITCH unblocks once all staged are
      `sourceCommitted: true`.

### Out-of-scope reminders

NOT in v2.3:
- Per-slot opt-in commit (commits are all-or-nothing per side).
- Revert / undo of a committed slot (source-commit is irreversible by design — the
  mon is gone from the source).
- Backup-to-SAV button wiring (still deferred; cart-mode commit's flashCart already
  triggers backup download via BackupSink).
- New same-cart refusal logic (S7b's already in place).
- GS Ball wiggle / red-recall trade animation on commit (queued post-S8 polish).
- Comparison overlay (deliberately removed in v2).
- Any `core/` modifications. `composeSourceWrite` / `composeDestinationWrite` already
  exist and work; if a bug surfaces, fix it inline as a SCOPE-EXCEPTION-CORE entry
  in EVAL.md, NOT silently.

---

## 2. Architecture decisions

### 2.1 New store API: `setSourceCommitted(idx, value): Promise<void>`

Adds to `web/src/cart/stagingStore.ts`. Reads the slot, sets
`{ ...slot, sourceCommitted: value }`, writes back to IDB, fires subscribe event.
Throws if slot is empty.

### 2.2 New reducer actions

```ts
{ type: 'v2_source_committed'; readonly slotIdxs: ReadonlyArray<number> }
{ type: 'v2_dest_committed'; readonly slotIdxs: ReadonlyArray<number> }
```

Both are FIRE-ON-SUCCESS — only dispatched after the underlying write actually
landed (SAV download triggered OR cart flash verified). They do NOT mutate the
staging store directly; the v2Actions handler calls `stagingStore.setSourceCommitted`
/ `stagingStore.removeAt` BEFORE dispatching, and the dispatch causes
`state.staging.slots` to refresh from the store (via the existing `subscribe`
callback in the controller).

The reducer's job is mostly to update derived UI state (e.g.
`state.staging.slots`, `stagedSourceRefs`, banner clears, button-disable
states). The IDB mutation is the source of truth.

### 2.3 v2Actions extension

Two new exports in `web/src/ui/v2Actions.ts`:

```ts
export interface CommitDeps {
  readonly store: StagingStore;
  readonly state: AppState;
  readonly dispatch: Dispatch;
  readonly refresh: () => Promise<void>;
  readonly flashDeps: FlashDeps | null;       // null in SAV-only environments
  readonly confirmFlashDialog: ConfirmFn;     // typed-PROCEED gate (cart only)
  readonly downloadFn: typeof blobDownload;   // injected for testability
}

export async function runCommitSource(deps: CommitDeps): Promise<void>;
export async function runCommitDestination(deps: CommitDeps): Promise<void>;
```

Pattern matches the v2.2.1 `runAddSelectedToTransfer` / `runAddSelectedToDestination`
pattern. Production `ui.ts` wraps each with a 1-line closure that injects
real deps.

### 2.4 Reuse existing `flashCart` primitive

DON'T reuse `runCartFlash` (that's the v1 wrapper that reads `stagedMons` whole-list).
DO reuse `flashCart(flashDeps, opts)` from `web/src/cart/cartFlasher.ts` directly,
passing pre-computed `bytes` from `composeSourceWrite` / `composeDestinationWrite`
applied to filtered refs only.

### 2.5 Filter helper

Add a private helper in `v2Actions.ts`:

```ts
function pendingSourceCommitRefs(
  slots: ReadonlyArray<StagedSlot | null>,
): { slotIdxs: ReadonlyArray<number>; refs: ReadonlyArray<StagedMonRefGen12> }
```

And the symmetric `pendingDestCommitRefs(slots)` returning Gen3 refs. Encapsulates
the filter + ref-conversion in one place.

---

## 3. Resolved design decisions

Confirmed with orchestrator after PLAN draft:

**A1 (visual after source commit).** Just drop the dashed-gold ghost. NO new
positive visual cue (green border or otherwise). Tile renders with normal
unscaffolded styling once `sourceCommitted: true`. The mon's mere presence in
the transfer box without a ghost is the "fully bonded, awaiting destination"
signal.

**A2 (Clear Transfer Box with source-committed slots).** Clearing IS allowed.
The Clear-confirm dialog copy MUST explicitly call out the permanent-loss case
when any slot is `sourceCommitted: true`. Required dialog copy:

```
Clear N staged mons?
  X uncommitted (still on source — safe to clear)
  Y source-committed (PERMANENTLY LOST — source already deleted, never written to dest)
This cannot be undone.
```

Substring assertions in the v2.3 test for `v2-clear-transfer.test.ts` (extends
the v2.2.1 test): when `Y > 0`, the dialog text MUST contain the substring
`PERMANENTLY LOST`. When `Y === 0`, the existing v2.2.1 copy stands.

**A3 (typed-PROCEED format).** Simplified per orchestrator: `PROCEED WITH COMMIT`.
Single phrase, no cart label, no action variant. The button is per-side (Commit
in source role drives source delete; Commit in dest role drives dest write), so
the typed phrase doesn't need to encode side. The connected-cart label is shown
in the dialog body for the user to verify visually before typing.

**Note on undo.** Out of scope; flagged for awareness. After source commit, the
source bytes are permanently changed — no UI undo. After dest commit, same.
Backup files are downloaded automatically by the cart-flow BackupSink (per
S7b); recovery is a manual restore from those backups, not a UI feature.

---

## 4. Definition of done

- 2 new handlers (`runCommitSource`, `runCommitDestination`) in
  `web/src/ui/v2Actions.ts`.
- 1 new store method (`setSourceCommitted`) in `web/src/cart/stagingStore.ts`.
- New `sourceCommitted: boolean` field on `StagedSlot` (defaults false; persists in IDB).
- 2 new reducer actions (`v2_source_committed`, `v2_dest_committed`) in
  `web/src/state.ts`.
- Trading-pipe Commit buttons wired (replace stub `alert()` calls in `ui.ts`).
- SWITCH-block predicate updated to use `!sourceCommitted` instead of
  `stagedSourceRefs.length > 0`.
- Visual: dashed ghost renders only for `!sourceCommitted` (style.css update).
- Clear-confirm dialog copy amended per Q2 above (if my read is confirmed).
- 6 new test files (per criterion 21).
- `bun run typecheck` / `lint` / `test` all green.
- 275+ tests passing (269 baseline + 6 new files of ≥1 test each).
- Bundle still under 120 KB gz.
- Sprint archived to `sprints/sprint-8v2.3.md`.
- Commit on `ui/s8v2-bills-pc`, pushed.

End of PLAN.md.
