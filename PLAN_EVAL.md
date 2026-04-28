# PLAN_EVAL.md — S8v2.3 (commits)

> Plan Evaluator: read-only Plan subagent
> Branch: `ui/s8v2-bills-pc`
> Run on: 2026-04-27

---

## 1. Verdict

APPROVE WITH AMENDMENTS. The plan is well-shaped and reuses S7b + S8v2.2/2.2.1
primitives in the right places, but three load-bearing gaps would cause the
Generator to ship a broken sprint. Amendments below are mechanical fixes; no
re-plan loop is needed.

---

## 2. Amendments (numbered, each load-bearing)

### AMEND-S8v2.3-1: PLAN criteria 8 + 9 are wrong about `flash_succeeded`

**Rationale**: The existing reducer at `web/src/state.ts:1000-1010` only sets
`state.cartFlash.kind = 'cart_flash_succeeded'` plus `verifiedBytes` /
`verifiedAt`. It does NOT touch `state.sourceBytes` (set at lines 648 / 800 /
848 only by file_loaded / cart_read_succeeded actions) or `state.dest.save.bytes`.
PLAN says "verify by reading the code" — I read it; the refresh path doesn't
exist. The legacy v1 cart-flash flow triggered the user to reload the cart
manually after success, which is why the bug never surfaced. v2.3 needs the
bytes refresh because the `stagedSourceRefs` overlay (criterion 15 says it
auto-clears) only clears if `state.sourceBytes` is updated and the `boxBrowser`
re-decodes against the new bytes.

**PLAN section affected**: §1 criteria 8, 9, 15; §4 DoD.

**Recommended fix**: After successful cart flash (source side), the v2.3 handler
must dispatch a NEW reducer action `v2_source_bytes_refreshed { bytes:
Uint8Array, save: SaveContents }` that re-parses the verified bytes via
`deps.parseSave` and swaps both `state.sourceBytes` and `state.save`. Symmetric
`v2_dest_bytes_refreshed` for destination side using `deps.parseGen3Save`. The
handler does the parse before dispatch (parse failure → keep stale bytes + log
+ show banner; the cart write is still committed, the refresh is best-effort).
For SAV mode the in-memory mutation is also explicit via these new actions —
do not piggyback on `flash_succeeded`.

### AMEND-S8v2.3-2: confirmFlashDialog cannot express `PROCEED WITH COMMIT`

**Rationale**: `web/src/ui/confirmFlashDialog.ts:30` hardcodes `action:
'DELETE FROM' | 'WRITE TO'` as a string-union prop and `expectedConfirmString`
always returns `PROCEED ${action} ${cartLabel}` (line 51). PLAN §3 A3 says the
typed phrase is `PROCEED WITH COMMIT` — no cart label, no per-side variant.
The dialog as currently written would produce `PROCEED WITH COMMIT
POKEMON-CRYSTAL-32-KB` which is NOT what A3 specifies. The 4 existing tests in
`web/src/__tests__/confirmFlashDialog.test.ts` pin the current behaviour.

**PLAN section affected**: §3 A3; §1 criteria 4 (source cart branch), 6 (dest
cart branch).

**Recommended fix**: Either (a) widen the `action` union to include `'WITH
COMMIT'` and the cart-label is stripped when action === `'WITH COMMIT'`
(cleanest, single dialog primitive), or (b) keep the legacy v1 path on
`'DELETE FROM' | 'WRITE TO'` and have v2.3 call a new `confirmCommitDialog`
primitive that returns the literal `PROCEED WITH COMMIT` regardless of
action/label. **Recommend (a)**: minimal divergence, single dialog component,
body still shows the cart label for the user to verify visually as A3 already
mandates. Whichever option lands, PLAN must explicitly state the choice +
update the dialog tests.

### AMEND-S8v2.3-3: Dest commit must convert + pack pkBytes BEFORE composeDestinationWrite

**Rationale**: In v2.2's `runAddSelectedToTransfer` (`v2Actions.ts:126`),
`pkBytes = serializeGen12ForStaging(mon)` — the sentinel-byte (0xFE) JSON
snapshot of the SOURCE-format `Gen12Pokemon`. This is NOT a Gen 3 80-byte PC
slot record. The legacy v1 path at `ui.ts:1752-1757` filters
`m.pkBytes.length === 80` and passes them straight to
`composeDestinationWrite` — that filter would EXCLUDE every v2.2-staged Gen
1/2 mon in v2.3 (their pkBytes is a JSON blob, not 80 bytes). The correct v2.3
path: at dest-commit time, for each placed slot, decode `pkBytes` via
`deserializeGen12FromStaging` (returns `Gen12Pokemon | null`), run
`deps.convert(mon)` to get a `ConvertResult`, then `deps.packBoxed(...)` (or
the convert result's pre-packed `bytes` if convert already packs — verify) to
get the 80-byte Gen 3 record, then assemble `StagedMonRefGen3 { target, bytes }`
for `composeDestinationWrite`. The PLAN's §2.5 helper
`pendingDestCommitRefs(slots)` is described as returning Gen3 refs — it MUST
do this conversion inside.

**PLAN section affected**: §1 criterion 6 (dest commit handler), §2.5
(pendingDestCommitRefs helper).

**Recommended fix**: Spell out the decode → convert → pack pipeline in the
helper. Define the helper signature as

```ts
pendingDestCommitRefs(slots, deps):
  | { kind: 'ok'; slotIdxs: ReadonlyArray<number>; refs: ReadonlyArray<StagedMonRefGen3> }
  | { kind: 'error'; stagedIndex: number; reason: string }
```

so a per-slot conversion failure surfaces with the slot index. Add a test in
`v2-dest-commit-sav.test.ts` that asserts the convert call happens once per
placed slot; add a separate test for the convert-refusal mid-batch case
(handler bails, no slot mutation, banner shown).

### AMEND-S8v2.3-4: Dashed-gold ghost CSS rule is unconditional, not class-driven

**Rationale**: `web/src/style.css:2074` is
`.transfer-box-grid .box-tile.is-occupied { outline: 2px dashed #c0a040; }` —
applied to ALL occupied tiles. The 60% sprite opacity at lines 2078-2082 is
similarly unconditional. The renderer at `web/src/ui/workbench.ts:884-889`
only emits classes `is-occupied | is-empty | is-selected | is-placed`. There
is no existing `is-source-committed` class to leverage. PLAN A1 ("just drop
the dashed-gold ghost") needs both a CSS edit AND a renderer edit.

**PLAN section affected**: §3 A1; §1 criterion 14; §4 DoD.

**Recommended fix**: (1) add an `is-source-committed` class on the tile when
`slot.sourceCommitted === true` in `renderTransferBox`; (2) make both CSS
rules conditional via `:not(.is-source-committed)` —
`.transfer-box-grid .box-tile.is-occupied:not(.is-source-committed) { outline: ... }`
and the same on the opacity rule. Document inline in `style.css` around line
2074 that "committed slots render solid; the comment at line 2071-2073 calls
this out as the v2.3 ship target".

### AMEND-S8v2.3-5: Clear-confirm test must be UPDATED, not just supplemented

**Rationale**: The existing `v2-clear-transfer.test.ts` at line 86 asserts
`expect(capturedMessage!).toContain('pending placements')`. PLAN §3 A2's new
copy is structurally different — `X uncommitted (still on source — safe to
clear) / Y source-committed (PERMANENTLY LOST...)`. The new copy does NOT
include the literal substring "pending placements". The existing test would
fail under the new copy. PLAN DoD says "Clear-confirm dialog copy amended per
Q2 above (if my read is confirmed)" but doesn't mention the test edit.

**PLAN section affected**: §1 criterion 21 (test list); §4 DoD.

**Recommended fix**: PLAN must explicitly call out that
`v2-clear-transfer.test.ts` is MODIFIED (not just augmented): (1) keep the
existing 3 tests but UPDATE the substring assertions to whatever the new copy
actually says when Y === 0 (the `Y === 0 → existing copy stands` clause needs
an exact-string redefinition since the old "pending placements" line is gone),
and (2) ADD a 4th test for the Y > 0 path asserting the substring `PERMANENTLY
LOST` appears. The test file count in PLAN §21 stays at 6 (this is an EDIT to
an existing file, not a 7th file).

### AMEND-S8v2.3-6: PLAN §18 references nonexistent `state.flashState.target`

**Rationale**: The actual reducer state field is `state.cartFlash` (a
discriminated union with kinds `cart_flash_idle | cart_flash_pending |
cart_flash_progressing | cart_flash_failed | cart_flash_succeeded |
cart_recovery_*`). There is no `state.flashState`. PLAN §18 says "or via
reusing the existing `state.flashState.target` indicator" — this would be a
typecheck failure on first build.

**PLAN section affected**: §1 criterion 18; §2.3 CommitDeps.

**Recommended fix**: Replace the hint with the real field. The in-flight guard
for v2.3 is:

```ts
if (state.cartFlash?.kind === 'cart_flash_progressing' ||
    state.cartFlash?.kind === 'cart_flash_pending' ||
    state.cartFlash?.kind === 'cart_recovery_progressing') return;
```

Use this guard at the entry of both `runCommitSource` and
`runCommitDestination`. No new `commitInFlight` flag needed —
`state.cartFlash` IS that flag, already covering both v1 and v2 paths so
accidental double-invoke from v1 stub paths can't fire either. Add an
entry-guard test per handler.

### AMEND-S8v2.3-7: Source-commit guards on state.kind / state.dest

**Rationale**: PLAN's runCommitSource pre-condition is "source loaded;
transfer box has ≥1 slot with `sourceCommitted: false`" but doesn't spell out
the early-bail. If `state.kind !== 'loaded'` (source disconnected mid-flow) or
the user clicks Commit Source via a stale handler binding, the handler would
crash on `state.sourceBytes` access. Symmetric concern for runCommitDestination:
`state.dest === null` would crash on `state.dest.save`.

**PLAN section affected**: §1 criteria 4, 6.

**Recommended fix**: Both handlers begin with explicit guards:
`if (state.kind !== 'loaded') return;` for source side; `if (!state.dest)
return;` for dest side. Mirror the existing guards in `runAddSelectedToTransfer`
(v2Actions.ts:81) and `runAddSelectedToDestination` (line 186). Add a guard
test per handler.

### AMEND-S8v2.3-8: Recovery dialog wiring is implicit, not specified

**Rationale**: PLAN criteria 4 + 6 say "On `flash_failed` → existing recovery
dialog flow (per S7b)" but the existing `recoveryDialog` is rendered by the
controller's render loop at `web/src/ui.ts:1525-1547` based on
`state.cartFlash.kind === 'cart_flash_failed'` AND a populated
`recoveryAvailable`. The v2.3 commit handler does not need to dispatch
anything extra — but it MUST NOT dispatch `v2_source_committed` /
`v2_dest_committed` on the failure branch (criterion 16 says the staging
mutation is success-only). The PLAN is already correct on the "no mutation on
failure" point but doesn't make the recovery-render reuse explicit.

**PLAN section affected**: §1 criteria 4, 6, 16; §4 DoD.

**Recommended fix**: Add a one-liner to the success criteria: "on
`flash_failed` the handler returns without dispatching the `v2_*_committed`
action; the existing controller render loop handles the recovery dialog from
`state.cartFlash` state with no v2.3 changes". Add a test in
`v2-source-commit-cart.test.ts` that asserts `setSourceCommitted` / `removeAt`
are NEVER called when `flashCart` returns `{ kind: 'failed', ... }`.

### AMEND-S8v2.3-9: Source SAV cross-tab / mid-download race needs documentation

**Rationale**: For SAV-mode source commit, `state.sourceBytes` is mutated
in-memory (criterion 10) and a download is triggered. If the user closes the
browser before saving the file to disk, the IDB-persisted `sourceCommitted:
true` flags say "the source has been mutated" but the user has no on-disk
record of the new SAV. Re-loading the original SAV file on next session would
re-introduce the "deleted" mons but the staging store still claims they're
source-committed → next dest-commit attempt would write phantom bytes (the
staged pkBytes still encode the original mons; the "delete" never persisted
to user's disk). This is a real safety hole.

**PLAN section affected**: §1 criterion 10; §4 DoD.

**Recommended fix**: Document the limitation explicitly in PLAN as "SAV-mode
source commit assumes user saves the downloaded file — no recovery mechanism
if the user dismisses the download". Add a UX note at commit time (a banner:
"Save the downloaded SAV BEFORE switching to destination — closing without
saving will desync your transfer box from the on-disk SAV"). For v2.3 this is
acceptable as-is (the cart-mode equivalent is properly bonded via verify), but
the SAV-mode hole needs to be a documented sharp edge, not a silent risk.

---

## 3. Decisions (orchestrator picks one of N)

### DECISION-1: Where does `commitInFlight` live? (PLAN §18 ambiguity)

**Options**:
- **A.** Reuse `state.cartFlash.kind === 'cart_flash_progressing'` (per
  AMEND-S8v2.3-6); no new state field; v2.3 commit handlers check this and
  early-return; v1 stub paths also gated.
- **B.** Add `state.v2.commitInFlight: boolean` field set by v2.3 handlers;
  isolated from v1 cart-flash state.
- **C.** Module-level `let inFlight = false` in v2Actions.ts; cleared in
  finally; not reflected in reducer state at all.

**Recommended: A.** The existing `state.cartFlash` already represents "an
active cart-write flow"; doubling it would invite drift between v1 and v2
bookkeeping. Option C is unsafe across renders.

### DECISION-2: Should `runCartFlash` in `ui.ts:1610-1773` be left intact, or refactored so v1 and v2 share a `composeBytes` parameter?

**Options**:
- **A.** Leave intact. v2.3 calls `flashCart` directly, replicates `flash_phase
  / flash_progress / flash_succeeded / flash_failed` dispatch wiring inside
  `runCommitSource` / `runCommitDestination`. Faster to ship; risk of drift
  between v1 and v2 cart-flash error handling over time.
- **B.** Refactor `runCartFlash` to accept a `composeBytes` callback so both
  v1 and v2 can use it. v2.3 passes a closure that produces filtered bytes;
  v1 passes its current "all stagedMons" closure. Slower to ship; eliminates
  parallel cart-flash error handling.

**Recommended: A** for v2.3 (PLAN says explicitly "DON'T reuse runCartFlash"
in §2.4); flag the refactor as a v2.4+ followup. The dispatch wiring is small
(~25 lines per handler) and can be cleanly extracted later. Keeping
`runCartFlash` intact means v1's HIL-validated path is untouched —
significant risk reduction.

### DECISION-3: Should "Connect destination cart first" tooltip on Commit-source button be in scope for v2.3 (criterion 11 marks TBD)?

**Options**:
- **A.** In scope — show the tooltip when source-commit completed OR when
  cart-mode source-commit is about to run but no dest cart is connected.
  Couples source-commit to dest readiness.
- **B.** Out of scope — the user can source-commit any time; SWITCH then
  prompts for dest cart. Simpler; one less state branch.

**Recommended: B.** The user flow per PLAN §1 is source-commit → SWITCH →
place → dest-commit. Source-commit doesn't need the dest cart connected. The
"connect dest first" affordance already lives in `stagingPane` per
AMEND-S7b-HIL-7. Don't add a competing surface.

---

## 4. Clarifications (Generator should be aware)

### CLARIFICATION-1: Source pkBytes decoding is NOT needed for source-commit

The orchestrator's prompt asks about pkBytes-decoding for `composeSourceWrite`.
composeSourceWrite consumes `StagedMonRefGen12 = { family, format, ref }`
(positional addressing only). The legacy `stagedToGen12Ref` at `ui.ts:1790`
proves it: it reads `m.sourceFamily`, `state.save.format`, and `m.sourceRef` —
never `m.pkBytes`. The v2.3 source-commit handler can compute refs from
`slot.sourceFamily` + `state.save.format` + `slot.sourceRef` directly, no
decode needed. (Decode is only needed for the DEST side — see AMEND-S8v2.3-3.)

### CLARIFICATION-2: `setSourceCommitted` IDB mutation triggers the same fire path

PLAN §2.1 specifies the new method writes back to IDB and fires the subscribe
event. The existing `placeAt` / `removeAt` / `setPlacement` pattern at
`stagingStore.ts:380-444` shows the canonical shape: read → mutate slice →
assign → `txPutSession` → `this.fire()`. `setSourceCommitted` should follow
identically. The controller's `subscribeSlots` listener (per S8v2.2 wiring)
re-derives `state.staging.slots` from the snapshot, which then re-derives
`stagedSourceRefs` (now filtered by `!sourceCommitted`), which causes the
SWITCH button to re-enable. No special cache invalidation needed.

### CLARIFICATION-3: `placeAt` rejection on already-source-committed sourceRefKey must be wired in `placeAt` itself, not just in the v2.3 handler

Criterion 3 says "placeAt rejects with descriptive error if any pre-existing
slot has sourceCommitted: true matching the same sourceRefKey". The existing
`placeAt` at `stagingStore.ts:390-396` rejects on ANY occupied slot's
matching key (committed or not). After source-commit the slot is STILL
occupied (sourceCommitted: true, pkBytes intact, removed only on dest-commit),
so the existing dedupe check ALREADY handles this case. The PLAN's criterion
3 phrasing could be misread as "add a new check" — clarify that the existing
dedupe is sufficient; only the error message may want improving (current:
"sourceRefKey ${X} already staged"; could say "...already staged or
source-committed").

### CLARIFICATION-4: `state.cartFlash` is already the multi-tab safety guard

Per AMEND-S8v2.3-6: the existing `state.cartFlash.kind` covers in-flight
detection. For multi-tab specifically, S7b's BroadcastChannel claim handshake
on `StagingStore.open()` already shows the "another tab claimed" banner. The
Generator does not need to add new BroadcastChannel messages for commit
specifically; the existing claim is sufficient — second tab attempting commit
while first tab's flash is in-flight will see the multi-tab banner AND the
second tab's `state.cartFlash.kind` will not be `progressing` (per-tab
state), so the second-tab guard fires and returns.

---

## 5. Out-of-scope verification

`composeSourceWrite` and `composeDestinationWrite` exports at
`core/src/transfer/composeWrite.ts` are sufficient as-is for v2.3. They
consume the existing `StagedMonRefGen12` and `StagedMonRefGen3` types (also
exported); the `Gen3SaveContents` parameter is the parsed save
(`state.dest.save`); both return either `Uint8Array` or `ComposeError`. The
v2.3 handlers compose these by:
- source: building `StagedMonRefGen12[]` from filtered slots;
- dest: decoding `pkBytes` → `Gen12Pokemon` → convert + pack →
  `StagedMonRefGen3[]` (per AMEND-S8v2.3-3).

NO `core/` modifications are required. PLAN §"Out-of-scope" is correctly
scoped on this point.

The dest-side conversion uses `deps.convert` and `deps.packBoxed` which are
ALREADY on `ControllerDeps` (`ui.ts:104-106`) — no new controller-deps
fields needed.

`flashCart` exists at `web/src/cart/cartFlasher.ts:110` with the signature
`(deps: CartFlasherDeps, opts: CartFlashOptions) → Promise<CartFlashResult>`
matching PLAN §2.4's claim. `CartFlashOptions` requires `bytes`,
`cartCurrentBytes`, `family`, `cartLabel`, `tid`, `backupFilename` — the
v2.3 handler must populate all six (the legacy runCartFlash does this; the
v2.3 handler must replicate). `onPhase` and `onProgress` callbacks are
optional but expected per AMEND-S8v2.3-1 to dispatch the existing
`flash_phase` / `flash_progress` actions.

`confirmFlashDialog` and `recoveryDialog` exist with the signatures PLAN
assumes, with one caveat (AMEND-S8v2.3-2 above on the action union).

---

## 6. Recommendation

APPROVE for Generator dispatch with the 9 amendments and 3 decisions applied
to PLAN.md before kickoff. None of the amendments require re-planning at the
architecture level — they are mechanical clarifications + a few CSS / dialog
/ reducer-action additions.

The MOST IMPORTANT gates the Generator should not skip:
1. **AMEND-1** (bytes refresh wiring) — without this, the source-tile overlay
   won't clear on cart-mode commit, breaking criterion 15.
2. **AMEND-3** (dest pkBytes decode + convert + pack) — without this, the
   dest commit composes 0 bytes (filter excludes all v2.2 slots).
3. **AMEND-2** (typed-PROCEED dialog parameterization) — without this, the
   typecheck fails on the action union or A3's contract is silently violated.

Test additions implied by amendments:
- Bytes-refresh after cart commit (source + dest variants).
- Dialog `PROCEED WITH COMMIT` exact string assertion.
- Dest-commit pkBytes decode + convert + pack pipeline (one happy path, one
  mid-batch convert-refusal).
- Recovery on flash_failed (no slot mutation).
- state.kind / state.dest entry guards.
- Cross-session durability test (sourceCommitted: true persists across
  StagingStore.close + reopen).
- End-to-end integration test (stage → source-commit → SWITCH → place →
  dest-commit) — recommend adding as test file #7 in the PLAN's list, even
  though it overlaps with the 6 atomic ones, because the cross-handler
  interactions (subscribe re-fire, stagedSourceRefs re-derivation, SWITCH
  unblock timing) are exactly where contract-only tests miss bugs.

End of PLAN_EVAL.md.
