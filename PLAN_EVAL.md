# PLAN_EVAL.md — Sprint 7a (Cart Mode read-only + GBxCart protocol + BackupSink)

## Verdict: **APPROVE_WITH_AMENDMENTS**

The split decision (S7a = read-only Cart Mode + protocol + BackupSink; S7b = staging-box + flash) is sound and well-justified (§2 is one of the strongest slice arguments in the project's history). The `SaveSource` widening (§5) is correctly symmetric with the S6a-frozen `SaveSink`. The state-machine extensions (§8) are additive and don't break the `DestSlot &` discriminator that landed in fe24352. The test plan (§10) genuinely exercises the protocol via mock ports and pins fixture round-trips — this is much stronger than "verify it doesn't crash".

However, **§4's command-byte table contains at least three fabricated/wrong bytes** that would cause every cart read to fail on real hardware. This is a CRITICAL fix and the single reason the verdict isn't APPROVE. There are also four IMPORTANT amendments (firmware probe completeness, BackupSink failure semantics, cart-detect chain ordering, hardware-in-the-loop checklist) and three NICE-to-have refinements. Generator can proceed once the CRITICAL is fixed.

**Amendment count: 11 (1 CRITICAL, 4 IMPORTANT, 4 NICE, 2 META).**

---

## CRITICAL amendments

### AMEND-S7a-EVAL-1 — §4's R3+ command-byte table is wrong (CRITICAL)

**Severity:** CRITICAL. Generator will produce code that does not work on real hardware.

**Evidence.** I cross-checked PLAN §4's command table against the canonical insidegadgets reference (`Interface_Programs/GBxCart_RW_Console_Interface_v1.36/setup.h` — the host implementation that ships paired with R3+ firmware).

| PLAN §4 says | Real firmware uses | Status |
|---|---|---|
| `READ_FIRMWARE_VERSION = 'V'` 0x56 | `READ_FIRMWARE_VERSION 'V'` (0x56) | ✓ correct |
| `READ_PCB_VERSION = 'h'` 0x68 | **No `'h'` define exists in v1.36 setup.h** | ✗ unverified — likely a FlashGBX-only or LK-firmware command |
| `SET_MODE_GB = 'G'` 0x47 | `GB_CART_MODE 'G'` (0x47) | ✓ correct |
| `SET_MODE_GBA = 'g'` 0x67 | `GBA_CART_MODE 'g'` (0x67) | ✓ correct |
| `READ_ROM_RAM_BYTES = 'M'` 0x4d | `READ_ROM_RAM 'R'` (**0x52**) | ✗ **WRONG byte** |
| `WRITE_RAM_BYTE = 'W'` 0x57 | `WRITE_RAM 'W'` (0x57) | ✓ correct |
| `SET_BANK = 'B'` 0x42 | `SET_BANK 'B'` (0x42) | ✓ correct |
| `READ_GBA_SRAM = 'r'` 0x72 | `GBA_READ_SRAM 'm'` (**0x6d**) — `'r'` is **`GBA_READ_ROM`** | ✗ **WRONG byte (and PLAN's value is a different command entirely)** |
| `WRITE_GBA_SRAM_PAGE = 'w'` 0x77 | `GBA_WRITE_SRAM 'w'` (0x77) | ✓ correct |
| `RESET_MBC = 'I'` 0x49 | **Not in v1.36 setup.h** | ✗ unverified — may exist in a different code path or may be invented |
| `XMAS_LED_OFF = 'L'` 0x4c | **Not in v1.36 setup.h** | ✗ unverified — may be invented; cosmetic-only so non-blocking either way |

The two confirmed wrong bytes (`'M'` for read, `'r'` for GBA SRAM read) would cause every cart read to either hang waiting for a response or read ROM bytes when SRAM was requested. Mock-port tests would still pass (because the mocks would be scripted against the wrong protocol), so the unit/integration tests in §10 would NOT catch this — only hardware-in-the-loop testing would, by which point the entire S7a is broken.

**Why this slipped past the planner.** §4 cites two sources ("`firmware/GBxCart_RW_v1.4_PCB/Src/main.c`" and `Lesserkuma/FlashGBX/hw_GBxCartRW.py`). The `Lesserkuma/FlashGBX` code uses a DIFFERENT command set (the LK-firmware command set, where SRAM reads use `AGB_CART_READ_SRAM = 0xC3` and GB SRAM writes use `DMG_CART_WRITE_SRAM = 0xB3` — see `LK_Device.py`'s DEVICE_CMD dictionary). Mixing the two firmware families in one table is the source of the corruption. Pick one firmware family and stick to it.

**What the Generator must do differently.**
1. Re-derive the §4 table directly from one of:
   - `insidegadgets/GBxCart-RW/Interface_Programs/GBxCart_RW_Console_Interface_v1.36/setup.h` (header file, single source of truth for the original-insidegadgets command set), OR
   - `lesserkuma/FlashGBX/LK_Device.py`'s `DEVICE_CMD` dict (different, modern command set; ALSO valid but uses `0xA1`+ codes, not ASCII chars).
2. Pick ONE firmware family — orchestrator should choose (see the orchestrator-questions section). If the user's GBxCart unit is on stock insidegadgets firmware, use the v1.36 setup.h byte values. If they've flashed Lesserkuma's firmware, use that one.
3. Update §4's table with the correct bytes and add a comment in `core/src/cart/protocol/commands.ts` citing the exact source-file URL + commit SHA for each command, so future maintainers can audit drift.
4. Drop the `READ_PCB_VERSION 'h'` row unless it can be verified against a real source — alternatives: read the PCB version via the firmware-version banner string (which embeds it on most firmware revisions), OR drop PCB detection entirely and rely on firmware-version detection alone.
5. Drop `RESET_MBC 'I'` if unverified — substitute with the documented MBC-reset sequence (write `0x00` to address `0x6000` via `'B'` SET_BANK, then re-enable RAM with `0x0a` to `0x0000` per AMBIDEX MBC documentation), which is what real GB hardware does on cart insertion.
6. Re-spec the cart-detect chain in §4 step 4 to use the NEW correct read command and the NEW MBC-reset path.

**§/file modified:** §4 entirely; §6.2 cart-detect chain step numbering may shift; `core/src/cart/protocol/commands.ts`; `tests/unit/cart-commands.test.ts` (the per-command encode tests must be re-derived against the corrected byte values).

---

## IMPORTANT amendments

### AMEND-S7a-EVAL-2 — Firmware probe must capture full identity, not just R3/R4 accept/reject (IMPORTANT)

**Severity:** IMPORTANT. Touches §4 step 2, §6.2, §9 `firmware.ts`.

**Issue.** §4 says "reject if < R3" and §9's `detectFirmware` returns `FirmwareInfo`. The shape of `FirmwareInfo` is not spec'd. The plan needs:
1. The full firmware-version BANNER (a multi-byte string the firmware prints, e.g. `"GBxCart RW v1.4 PCB Firmware R26"`), not just the major rev number. The banner contains the patch-level which is what protocol fixes are tagged against.
2. A `protocolVariant: 'insidegadgets-v1.x' | 'lesserkuma'` discriminator computed from the banner — because the LK firmware also responds to `'V'` but with a different reply shape. If the user has LK firmware installed and we send insidegadgets command bytes, we'll get garbled output without a clear error.
3. A version-rejection error MUST surface to the UI as a specific dialog (not a generic toast) — "Your GBxCart firmware (R2) is too old. Install firmware R3+ via insidegadgets's updater. https://insidegadgets.com/...".

**What the Generator must do differently.** Update `FirmwareInfo` interface in `core/src/cart/types.ts` to include `banner: string`, `majorRev: number`, `protocolVariant: 'insidegadgets' | 'lesserkuma' | 'unknown'`. `detectFirmware()` returns this; `requireSupported(info)` throws `CartError('UNSUPPORTED_FIRMWARE', { banner })` so the dialog can show the user what they have. Add a unit test for an LK-firmware banner being detected as `protocolVariant: 'lesserkuma'` and rejected (S7a only supports one variant — orchestrator picks which per AMEND-S7a-EVAL-1).

**§/file modified:** §4 step 2; §6.2; §9 (`firmware.ts`, `types.ts`, `index.ts` — new `CartError` reason `UNSUPPORTED_FIRMWARE_VARIANT`); `tests/unit/cart-firmware.test.ts` extended (~3 more tests).

---

### AMEND-S7a-EVAL-3 — BackupSink: file-download failure must abort the inner write (IMPORTANT)

**Severity:** IMPORTANT. Touches §6.4 and `web/src/cart/backupSink.ts` design.

**Issue.** §6.4's BackupSink does:
```ts
async write(bytes, opts) {
  blobDownload(this.backupFilename, this.preWriteBytes); // synchronous trigger
  await this.inner.write(bytes, opts);
}
```

The user's stated invariant ("the entire save file is BACKED UP before hand") is violated if the browser silently blocks the download (popup-blocker, "ask where to save" dialog dismissed, disk full). `blobDownload()` returning is NOT proof the file landed on disk — it just means the `<a download>` click event fired.

The user was explicit: "the entire save file is BACKED UP before hand". The contract is "backup must succeed before write begins", not "backup attempt must precede write attempt".

**What the Generator must do differently.**
1. `BackupSink.write()` must use a Promise-resolving variant of `blobDownload` that resolves only after the browser has accepted the save action. The minimum viable approach: use `showSaveFilePicker()` when available (Chromium has it; same `'serial' in navigator` browsers we already require for cart mode) and `await` the file handle write. Fall back to `<a download>` only when the picker is unavailable, with a UI-blocking dialog "Did the backup file download? [Yes, continue] [No, cancel write]" gated on user click.
2. If the picker throws (user cancelled or permission denied), `BackupSink.write()` MUST throw `CartError('BACKUP_FAILED', { reason })` and NOT call `this.inner.write()`. The cart is left untouched.
3. Add a unit test: `backupSink.test.ts` gets a 5th case — recording-inner-sink + a recording-blobDownload that REJECTS — assert `inner.write` was NEVER called.

**§/file modified:** §6.4; `web/src/cart/backupSink.ts`; `tests/web/backup-sink.test.ts`; `web/src/cart/browserCompat.ts` (add `showSaveFilePicker` capability probe).

---

### AMEND-S7a-EVAL-4 — Cart-detect chain must NOT trust user-selected format (IMPORTANT)

**Severity:** IMPORTANT. Touches §6.2 and `core/src/cart/protocol/cartHeader.ts`.

**Issue.** §4 step 5 says `parseCartHeader` returns `kind: 'gb' | 'gbc' | 'gba'` and §4 step 6 branches accordingly. Good. But §6.2 ("clicking `Connect cart` invokes `parseSave(bytes)`") doesn't specify which `parseSave` — Gen 1/2 has its own `parseSave`, Gen 3 has `parseGen3Save`. The cart-mode flow needs an autodetect equivalent to Upload Mode's behaviour: file readers don't trust user-selected format (per the S3a `detectFormat` design), and the cart path must match.

The plan implicitly does this via `parseCartHeader` → `kind` discriminator, but never explicitly says "after reading SRAM, dispatch to `parseSave` vs `parseGen3Save` based on cart-header kind". An ambiguity-by-omission risk exists where the Generator writes `await parseSave(bytes)` for everything and Gen 3 carts fail.

**What the Generator must do differently.** Add to §6.2:

> After SRAM read completes, dispatch to:
> - `parseSave(bytes)` (Gen 1/2 reader) if `cartHeader.kind` ∈ {'gb', 'gbc'}
> - `parseGen3Save(bytes)` (Gen 3 reader) if `cartHeader.kind === 'gba'`
>
> The cart-detect chain establishes which reader to call; the SaveSource never returns a pre-parsed save, only raw bytes + a `cartHeader` metadata field. This matches Upload Mode's "user drops a file, we autodetect format from bytes" contract.

Update `GbxCartSource.read()` return type or add a sibling `GbxCartSource.identity` field that includes `cartHeader: CartHeader` so the controller can dispatch. Add an integration test: `cart-roundtrip-fixture.test.ts` includes both a Gen 2 fixture and a Gen 3 fixture, and asserts the dispatch picks the correct reader.

**§/file modified:** §6.2; §5 (`GbxCartSource` interface gets a `cartHeader` field on its identity); §10 (integration test asserts both readers reachable).

---

### AMEND-S7a-EVAL-5 — Hardware-in-the-loop manual-validation checklist is missing (IMPORTANT)

**Severity:** IMPORTANT. Pokeportal has no automated HIL CI. The user has the hardware. PLAN §10 talks about mock-port tests + fixture round-trips, but there's no explicit "user must run these manual steps to verify before PASS".

**Issue.** Without a checklist, the Code Evaluator can mark S7a PASS based on green tests + bundle-size, then the user discovers on first real-cart attempt that AMEND-S7a-EVAL-1's wrong command bytes ship. The Code Evaluator needs an explicit list of human-only validation steps to ask the user to run.

**What the Generator must do differently.** Add §10.5 "Manual hardware validation (orchestrator runs with the user's GBxCart RW):"

1. Plug GBxCart RW into a USB port on the dev machine, with a known Gen 1/2 cart inserted.
2. `bun run --filter web dev`, navigate to `localhost:5173`, click `[Cart Mode]`, click `Connect cart`.
3. Confirm the browser port-picker shows the GBxCart device.
4. Pick it; verify within 30s the source pane shows the trainer name + species names matching what's actually on the cart.
5. Compare the read bytes to a known-good `.sav` exported from the same cart via FlashGBX or insidegadgets's official tool. They MUST be byte-identical (modulo any RTC-bank bytes if Gen 2).
6. Repeat with: at least one Gen 1 cart, at least one Gen 2 cart (Crystal preferred for the MBC3+RTC + bank-switch path), at least one Gen 3 cart.
7. Yank the cable mid-read; confirm the disconnect dialog appears.
8. Plug into a Firefox profile; confirm `[Cart Mode]` is disabled with the expected tooltip.

The Code Evaluator should mark S7a as PASS *contingent on* the user reporting items 1-8 work. Document in `EVAL.md`'s success-criteria table.

**§/file modified:** §10 (new §10.5 added); `EVAL.md` template (the Code Evaluator's standing template should grow a "manual validation" column).

---

## NICE amendments

### AMEND-S7a-EVAL-6 — Mode-toggle granularity decision should be deferred to user-feedback (NICE)

**Severity:** NICE. Touches R6 / §6.1.

**Issue.** R6 picks "global mode" and recommends revisiting only on user feedback. That's fine, but the AppState in §8 commits to `mode: 'upload' | 'cart'` as a single global field. If we later want per-pane mode, we'd need `sourceMode` and `destMode` (probably). To avoid a future refactor, hide the mode behind a single accessor:

```ts
export interface AppState {
  // ... existing fields ...
  readonly modeState: { kind: 'global'; mode: Mode } | { kind: 'per-pane'; sourceMode: Mode; destMode: Mode };
}
export const getMode = (s: AppState, side: 'source' | 'dest'): Mode =>
  s.modeState.kind === 'global' ? s.modeState.mode : (side === 'source' ? s.modeState.sourceMode : s.modeState.destMode);
```

Forward-compatible without commitment. S7a only ships the `'global'` variant.

**What the Generator must do differently.** Optional. Implement as above OR ignore — orchestrator's call.

**§/file modified:** §8.

---

### AMEND-S7a-EVAL-7 — Drop the `kind: 'file' | 'serial'` discriminator on SaveSource (NICE)

**Severity:** NICE. Touches §5 and R9.

**Issue.** R9 itself raises the question. My recommendation differs from the planner's. The discriminator's only stated motivation is "downstream code (cart-mode-specific dialogs like `If the GBxCart isn't listed…`) genuinely needs to know which source type it's dealing with". But that dialog is `web/src/cart/cartConnector.ts`'s problem — a layer that ALREADY knows it's working with a `GbxCartSource` because it constructed it. The dialog doesn't need to discriminate via the interface; it discriminates via the call site.

Adding `kind` to the interface forces `FileUploadSource` and `GbxCartSource` (and any future `BluetoothSerialSource`, `WebUSBSource`) to enumerate themselves in a string union that lives in `core/src/types/sav.ts`, which couples the type-of-source enumeration to the core types module. Bad direction.

**What the Generator must do differently.** Optional. Drop the `kind` field from the §5 interface. Use `instanceof GbxCartSource` at the one site (`cartConnector.ts`) that needs to discriminate. Note that this contradicts AMEND-S3a-2's "the discriminator promised in S3a"; if orchestrator wants to keep the S3a promise, leave it in.

**§/file modified:** §5; `core/src/types/sav.ts`.

---

### AMEND-S7a-EVAL-8 — Pickup the AMEND-S6a-5 64KB single-slot Gen3 fixture cheaply (NICE)

**Severity:** NICE. Touches §10 fixture acquisition.

**Issue.** AMEND-S6a-5 forward-carried "no 64 KB single-slot Gen 3 fixture-backed test". S7a's mock-port testing will exercise GBA SRAM reads; once we have a mock port, dropping in a 64 KB fixture (truncated from `firered.sav`) costs ~5 lines of test code and closes a Gen 3 coverage gap that will block S7b's cart-write certification. NOT a CRITICAL — Gen 3 single-slot fixtures don't affect S7a's deliverable — but the marginal cost is low enough that picking it up here is preferable to forward-carrying again.

**What the Generator must do differently.** Add `fixtures/gen3/firered-single-slot.sav` (truncate `firered.sav` to active slot per AMEND-S6a-1's empirical sector mapping). Add to `cart-roundtrip-fixture.test.ts`: round-trip the 64 KB fixture through GbxCartSource. Adds 1 test.

**§/file modified:** §10 (test count ~67 → ~68); `tests/integration/cart-roundtrip-fixture.test.ts`; new fixture file.

---

### AMEND-S7a-EVAL-9 — Read-progress chunking granularity (NICE)

**Severity:** NICE. §4 says "4 KB chunks for `onProgress` granularity". 32 KB GB save → 8 progress events; 128 KB GBA save → 32 progress events. UI updates at 60Hz can render every event. Fine. But the read-speed expectations (32 KB/s GB, 16 KB/s GBA) mean each 4 KB chunk takes 125 ms / 250 ms — perceptible chunkiness. Drop to 1 KB chunks (32 events / 128 events) → 31 ms / 62 ms per event → smooth.

**What the Generator must do differently.** Optional. Lower chunk size from 4 KB to 1 KB. Trade-off is per-chunk command overhead (`READ_ROM_RAM` re-issued per chunk, ~2 ms per command on USB-CDC-ACM); 128 chunks × 2 ms = 256 ms added latency on GBA reads. Acceptable for smoother progress.

**§/file modified:** §4 read speed expectations; `core/src/cart/protocol/session.ts`.

---

## META amendments (process / project-hygiene)

### AMEND-S7a-EVAL-10 — Vendor / version-pin the GBxCart firmware reference (META)

**Severity:** META. AMEND-S7a-EVAL-1's whole problem is that "the protocol" is actually multiple co-existing protocols across firmware versions and forks. Future sprints will hit this again (firmware updates, new GBxCart variants). The Generator should vendor the relevant `setup.h` (or `LK_Device.py` excerpt) into the repo at `core/src/cart/protocol/gbxcart-rw-v1.36-setup.h.txt` (or similar) at a specific commit SHA, and `commands.ts` should cite that in-repo file for every command byte. This way protocol drift is discovered by `git blame` rather than by users with broken hardware.

**§/file modified:** None of the planned files; new vendored-reference file under `core/src/cart/protocol/`.

---

### AMEND-S7a-EVAL-11 — S7b sketch in §6.6-§6.8 / §7 should be moved to a separate document (META)

**Severity:** META. §6.6-§6.8 and §7 sketch S7b in detail. PLAN.md headers say "S7a (this sprint) + S7b (next sprint)" but the binding contract is S7a-only. Risk: a future Generator reads §7's IndexedDB schema as binding for S7a, when it's only a sketch for S7b. Mark S7b sections clearly as "non-binding sketch — for S7b's planner to evaluate" in a more prominent banner than the current closing line. Even better: move the S7b sketch to `S7b-SKETCH.md` so PLAN.md is unambiguously S7a-only.

**§/file modified:** §6.6, §6.7, §6.8, §7 (move out OR add a banner at the head of §6.6 saying "non-binding for S7a — these sections are only here so the eval reviewer can sanity-check that S7a's interfaces support S7b's flows").

---

## Things the plan got RIGHT (call-outs for the Generator to preserve)

- **The split decision is the right call.** §2's risk-isolation argument is the single strongest thing in the plan. Don't merge S7a + S7b under any time pressure.
- **`SaveSource` symmetry with `SaveSink` (§5) is correctly designed.** The widened interface mirrors `SaveSink` exactly (`signal`, `onProgress`, returns `Uint8Array`), no hidden assumptions, no widening of the `SaveSink` contract. AMEND-S6a-4 is honoured. Note: the `FileUploadSource` extraction (§5) is a 10-line refactor that deduplicates the file-read path — Generator should land it cleanly.
- **`BackupSink` as a decorator (R10) is the right architectural choice.** Per AMEND-S7a-EVAL-3's caveat, the implementation must handle download failure correctly, but the wrapper-based approach is correct — it makes "every cart write IS backed up" a type-level guarantee.
- **Cart-detect chain (§4 step 5) correctly uses the Game Boy header at 0x100-0x14F.** The Nintendo logo bytes at 0x104-0x133 ARE the canonical "is this a GB cart" probe (this is what a real Game Boy boot ROM does). Generator should preserve this.
- **State-machine extensions (§8) are additive.** The new `mode` field and `cartSource` field are added to AppState without breaking the `DestSlot &` discriminator from fe24352. Existing reducer cases are untouched. ✓
- **Bundle-size budget (§10) explicitly tracked.** Current 42.7 KB, cap 200 KB, projected post-S7a 73 KB. Comfortable. Generator should add the `bundle-size.test.ts` assertion.
- **Per-pane invariant (§6.1, §6.7) honours `project_pokeportal_gsball_animation.md`.** Cart pane LEFT, staging pane RIGHT. §6.7's note "yes — left! per the user's invariant the cart is always left, staging always right" explicitly nails this. The animation sprint will inherit this layout cleanly.
- **The cart-mode integration is additive to Upload Mode (§8 mode-toggle invariant).** "Switching `Cart → Upload` doesn't drop the cart-side state OR the staging box" — non-destructive toggle is the right choice. ✓
- **Browser-compat fallback (§11) is correct.** Detection probe is right (`'serial' in navigator`), fallback is right (Upload Mode unchanged), tooltip wording is right.

---

## Questions for the orchestrator

These need user/orchestrator clarification before the Generator can proceed:

### Q1. Which GBxCart firmware family does the user's hardware run?

**Why it matters.** AMEND-S7a-EVAL-1 — the protocol command bytes depend on firmware family. Stock insidegadgets firmware (vR1.4 PCB, latest is R26+ as of 2025) uses ASCII-character commands (`'V'`, `'G'`, `'R'`, etc.). Lesserkuma's reflashed firmware uses 0xA0+ binary opcodes via a totally different command set. The two are mutually incompatible.

**How to find out.** Have the user open https://insidegadgets.com/wp-content/uploads/2021/04/GBxCartRW_v1.4_PCB_Firmware_Updater_v1.30.zip OR plug the cart in and `cat /dev/ttyACM0` after sending `'V'\n` (will print the banner). Most users have stock insidegadgets firmware unless they specifically reflashed for FlashGBX.

**Default if unanswerable.** Assume stock insidegadgets, vR1+ ('V'-banner-style commands per `Console_Interface_v1.36/setup.h`). Document the assumption + recovery path in `core/src/cart/protocol/firmware.ts` ("if your firmware shows banner pattern XYZ, file an issue, this version of pokeportal supports stock insidegadgets only").

### Q2. Is per-pane mode (independent source-mode and dest-mode) actually wanted?

**Why it matters.** R6 is unresolved. Per-pane mode would let a user upload a Gen 1 .sav AND read their Gen 3 cart in one session. Useful workflow if the user has a Gen 1 file backup but no working Gen 1 cart. Adds state-machine complexity (~30 lines reducer code).

**Default if unanswerable.** Global mode (planner's choice). Defer per-pane to a future sprint based on user feedback.

### Q3. Do we want `BackupSink` to use `showSaveFilePicker` or stay with `<a download>`?

**Why it matters.** AMEND-S7a-EVAL-3 — `showSaveFilePicker` gives stronger backup-success semantics but adds a UX prompt. `<a download>` is silent (file lands in Downloads with no further interaction) but offers no success signal. Trade-off: stronger guarantee vs smoother UX.

**Default if unanswerable.** `showSaveFilePicker` with `<a download>` fallback + a "Did the backup save?" confirmation dialog when falling back. The user was explicit ("backed up before hand") — the strong-guarantee variant matches their stated intent.

### Q4. Should the BackupSink ship in S7a or defer entirely to S7b?

**Why it matters.** §3 / §9 ship the BackupSink in S7a "for testing". But S7a is read-only Cart Mode — there are no cart writes to back up yet. Shipping the BackupSink in S7a means it gets unit-tested in isolation but not exercised end-to-end until S7b. Two options:

(a) Ship in S7a with unit tests + a hidden "Test backup" debug button that exercises the round-trip with a known no-op cart write. Adds ~1 day.
(b) Defer entirely to S7b. S7a doesn't ship the BackupSink at all.

The planner picked (a) implicitly. (b) would shrink S7a's surface and let S7a focus purely on read-side flows.

**Default if unanswerable.** Ship in S7a (option (a)) — having `BackupSink` written + unit-tested when S7b's planner sits down means S7b focuses purely on the staging-box UX, which is the harder sprint. The marginal cost of a debug button is acceptable.

---

> END OF PLAN_EVAL.md.

---

## Orchestrator decisions (binding for Generator)

**Q1 — Firmware support: BOTH families, autodetect on connect.**
The user's call: "Does the firmware I use matter? Theoretically it
should support both and detect as such right". Yes. Generator must
implement BOTH command sets and autodetect at port-open time:

- **Stock insidegadgets firmware** — ASCII-character command set
  (`'V'`/`'G'`/`'R'`/etc.). Reference: insidegadgets'
  `Console_Interface_v1.36/setup.h` for the canonical opcode table.
  AMEND-S7a-EVAL-1 (CRITICAL) corrected the planner's mis-specced
  bytes — use `R` (0x52) for `READ_ROM_RAM` and `m` (0x6d) for
  `GBA_READ_SRAM`. Verify all opcodes against the real source before
  shipping.
- **Lesserkuma FlashGBX firmware** — 0xA0+ binary opcode set.
  Reference: `Lesserkuma/FlashGBX` repo (look at the firmware source
  + `hw_GBxCartRW.py` for protocol mappings).

Detection sequence at port-open:
1. Send `'V'\n` (0x56 0x0A).
2. Read response until newline timeout (~250 ms).
3. If banner matches `/^GBxCart RW v\d/` → stock insidegadgets.
4. Else send Lesserkuma's identification opcode (`0xA0` family —
   verify the right one).
5. If recognized → FlashGBX firmware.
6. Otherwise surface "Unsupported firmware: $banner" error and abort.

Architecturally: define a `CartProtocol` interface in
`core/src/cart/protocol/index.ts` with two impls
(`InsidegadgetsProtocol`, `FlashgbxProtocol`). The `GbxCartSource`
constructor takes a `CartProtocol`; the `connect()` factory does the
autodetect dance and returns the right one. Mock-port tests cover
BOTH impls — protocol-specific unit tests AND a shared
"any-protocol" interface conformance test.

Cost: ~+150 LoC over single-protocol; doubles the mock-port test
matrix. Worth it — eliminates a setup-quirk failure mode users
shouldn't have to debug.

**Q2 — Global Mode toggle (per planner default).** One Mode toggle
for both panes; per-pane mode deferred to a future sprint based on
user feedback. Keeps the state machine simple in S7a.

**Q3 — BackupSink: `showSaveFilePicker` with `<a download>` fallback.**
Use the stronger-guarantee File System Access API where available
(Chromium 86+; Web Serial is also Chromium-only so this is the same
audience). Fall back to the transient `<a download>` element on
browsers that lack `showSaveFilePicker`. When falling back, show a
"Did the backup save?" confirmation dialog before allowing the cart
write to proceed. Per user's explicit "BACKED UP before hand" intent —
the strong guarantee matches the stated contract.

**Q4 — Ship BackupSink in S7a.** Per AMEND-S7a-EVAL-4 / planner
default. Unit-tested in isolation in S7a; exercised through a hidden
"Test backup" debug action that round-trips the backup write against
a known no-op cart write. S7b's planner inherits a working,
already-tested BackupSink rather than a new feature in their critical
path.

