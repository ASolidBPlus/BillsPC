# Sprint 7b Archive — pokeportal Cart Mode (write side)

**Status**: PASS (archived 2026-04-25, HIL-validated end-to-end on real
hardware). DMG SRAM write confirmed on Pokemon Red (Gen 1, MBC3, 32 KB
SRAM); AGB Flash write confirmed on Pokemon Ruby (JP, Gen 3, 128 KB Flash)
via GBxCart RW v1.4 PCB-6 with R42+L14 firmware on Arch Linux.

**Scope**: Cart-mode WRITE flow on top of S7a's read-only foundation.
Composable sink stack (`BackupSink` → `WriteAndVerifySink` → `GbxCartSink`)
mandates pre-flash backup + write + readback verify. IndexedDB-backed
persistent staging box (multi-tab `BroadcastChannel` claim handshake) for
parking mons between source-cart-read and dest-cart-write. `confirmFlashDialog`
typed-PROCEED gate (must type `PROCEED <ACTION> <CART-LABEL-DASHED>`).
`recoveryDialog` capped at 3 attempts before falling back to FlashGBX
escape hatch. Cart-mode UI: cart pane LEFT, staging RIGHT (per AMEND-S7b-15
+ DECISION-4); STORE-in-destination button doubles as Stage trigger in
Cart Mode; "Connect destination cart" affordance lives in the staging pane
when no dest cart is connected. Same-cart hard-refuse (TID + label compare
on dest-connect) per AMEND-S7b-16 / DECISION-2.

**Test outcome**: 637 tests passing (453 core + 184 web), 1 permitted
skip. +153 vs S7a baseline. Web bundle 61 KB gzipped (cap 120 KB per
DECISION-9; +9 KB vs S7a-end of 52 KB).

**Previous sprint**: S7a (Cart Mode read-only).

**Next sprint**: S7c — candidate scope: Gen 1→Gen 2 Time-Capsule cart-to-
cart (deferred per AMEND-S7b-21 + DECISION-3), Gen 3→Gen 3 cart-to-cart
(deferred per DECISION-10), place-time decode sanity check (per AMEND-S7b-17
#2), dry-run UI (per AMEND-S7b-24), JP charmap divergence forward-carried
from S6a/S7a, Hoenn Gen 3 front sprites (we still use the overworld walker
pack throughout per DECISION-4 — works fine but inconsistent with
upload-mode comparison view), GS-Ball "anime trade" animation polish.

---

## Headline architecture

```
Controller (web/src/ui.ts runCartFlash)
  ├─ resolveCartFlashContext(target, state)
  │    ├─ source: composeSourceWrite(state.sourceBytes, staged refs)
  │    │           → bytes-to-write = pre-write SRAM with mons DELETED
  │    │           cartCurrentBytes  = state.sourceBytes (initial S7a read)
  │    └─ destination: composeDestinationWrite(state.dest.save, staged Gen 3 refs)
  │                     → bytes-to-write = pre-write SRAM with mons INJECTED
  │                     cartCurrentBytes  = state.dest.save.bytes
  └─ flashCart(deps, opts)
       ├─ requestPort + detectProtocol
       ├─ backupBytesSnapshot = new Uint8Array(opts.cartCurrentBytes)
       ├─ BackupSink wraps WriteAndVerifySink wraps GbxCartSink
       ├─ backupSink.write(opts.bytes)
       │    ├─ persistBackup → showSaveFilePicker / <a download> + size verify
       │    ├─ inner.write(opts.bytes)
       │    │    └─ GbxCartSink: setRamEnabled(true) → per-bank setBank →
       │    │                    protocol.writeSram(family, bank-bytes) →
       │    │                    setRamEnabled(false)
       │    └─ readback via banked SRAM read; diff vs opts.bytes
       └─ finally: protocol.cleanup() (downgrade baud to 1M) → port.close()
```

For DMG/GBC carts, `protocol.writeSram` runs the FlashGBX cadence per
LK_Device.py:1614-1638 (TRANSFER_SIZE / ADDRESS / DMG_ACCESS_MODE=4 /
DMG_WRITE_CS_PULSE=1 setvars per page; opcode + payload + readAck per
iteration; cleanup setvars at sector end).

For AGB Flash carts (>64 KB), `protocol.writeSram` routes through
`writeAgbFlashBanked` which loops per sector: switch Flash bank if needed
→ JEDEC erase → poll-until-erased → write all 16 pages of the sector
using OP_AGB_CART_WRITE_FLASH_DATA (NOT OP_AGB_CART_WRITE_SRAM — AGB
Flash chips silently no-op the SRAM-write opcode).

For ≤64 KB AGB SRAM carts (rare; non-Pokemon), the path falls back to
flat OP_AGB_CART_WRITE_SRAM with no JEDEC sequence.

---

## Retrospective amendments (binding for S7c and any future cart-write work)

These corrections were caught by HIL bisection on real Pokemon Red +
Pokemon Ruby JP carts during the 2026-04-23 → 2026-04-25 session. Mock-
port unit tests caught NONE of them — the mocks happily ack any opcode
with arbitrary data, so they can't distinguish "wire format correct" from
"wire format wrong but firmware accepts it on the loopback." Real-hardware
HIL is non-negotiable for any cart protocol change.

### AMEND-S7b-HIL-1 (CRITICAL): DMG SRAM write — DMG_WRITE_CS_PULSE=0 cleanup MUST be AFTER the data write, NOT before

The original `writeSram` for DMG had this fatal sequence per page:

```
SET_VAR ADDRESS = 0xA000+off
SET_VAR DMG_ACCESS_MODE = 4
SET_VAR DMG_WRITE_CS_PULSE = 1   # CS asserted
SET_VAR ADDRESS = 0              # WRONG: cleanup happens BEFORE data
SET_VAR DMG_WRITE_CS_PULSE = 0   # CS deasserted BEFORE the actual payload
TX OP_DMG_CART_WRITE_SRAM + slice  # data flows but cart's CS line is low → cart sees nothing
```

Cause: misread of FlashGBX trace by the previous Generator. The `_set_fw_variable("DMG_WRITE_CS_PULSE", 0)` and `("ADDRESS", 0)` lines that show up in the FlashGBX trace are the END-OF-WriteRAM cleanup that runs AFTER the per-iteration data writes — those data writes don't get logged at the python `dprint` level. The Generator saw the setvars in linear order in the log and assumed they happened linearly on the wire, but the python WriteRAM function structure is `setvars → for loop of writes → cleanup setvars`.

Fix: `flashgbx.ts:writeSram` now runs the cleanup setvars AFTER the per-page loop, not within it. Symptom on real hardware was reproducible 2-byte mismatch at offset 0x4000 in Pokemon Red verify (the only bytes our delete actually changed; the other 4094 bytes of the bank coincidentally matched because the cart still had the original bytes there).

### AMEND-S7b-HIL-2 (CRITICAL): AGB Flash page writes need OP_AGB_CART_WRITE_FLASH_DATA (0xC7), NOT OP_AGB_CART_WRITE_SRAM (0xC4)

Per LK_Device.py:3181-3186, AGB carts use a per-save-type opcode map:
- 256K SRAM, 512K SRAM, 1M SRAM (true SRAM): `AGB_CART_WRITE_SRAM` (0xC4)
- 512K FLASH, 1M FLASH (Pokemon R/S/E/FR/LG): `AGB_CART_WRITE_FLASH_DATA` (0xC7) + method byte (1 for 1M, 2 for 0x1F3D variant 512K)

The 0xC4 opcode tells the firmware to do a true SRAM bus write — works for actual SRAM chips but is a SILENT NO-OP against a Flash chip. Symptom on Pokemon Ruby: erase succeeded (cart blanked to all 0xFF), every page write ack'd on the wire, but the Flash chip never accepted any of them. Cart stayed all 0xFF after a full 128 KB write attempt.

Fix: `flashgbx.ts:writeAgbFlashSector` now sends `[0xC7, 0x01]` + payload for the page write opcode. `cartWriteAgbByte` (used for JEDEC commands and bank-switch) still uses 0xC4 — those ARE true bus writes for issuing the unlock sequences, not Flash data writes.

### AMEND-S7b-HIL-3 (CRITICAL): AGB Flash page writes — setvars ONCE per sector, single readAck per page

Two bugs combined: per-page TRANSFER_SIZE/ADDRESS setvars + missing readAck after the page-write opcode + payload. FlashGBX's `WriteRAM` (LK_Device.py:1614-1638) sets TRANSFER_SIZE + ADDRESS once per WriteRAM call and the firmware auto-increments ADDRESS internally between page writes. Re-setting them per-page apparently resets some Flash-write state in the firmware. AND the previous code had a duplicated `readAck` call further down the function so each page write was consuming TWO acks instead of ONE → all subsequent erases misaligned with stale wire bytes.

Fix: `flashgbx.ts:writeAgbFlashSector` hoists setvars out of the per-page loop and the page-write try-block contains exactly one `readAck` call. Per-sector ack count is now 18 (2 setvars + 16 page acks), down from the broken 48.

### AMEND-S7b-HIL-4 (CRITICAL): Verify-after-write must read SRAM with RAM-enable + per-bank switching

`WriteAndVerifySink` originally called `protocol.readSram(family, totalBytes)` directly for the verify pass. Two bugs:

1. `GbxCartSink.write` ends with `setRamEnabled(false)` (MBC RAM-disable latch). The verify-readback then ran with RAM disabled → MBC returned 0xFF for every SRAM byte regardless of what's actually on the cart.
2. DMG SRAM is exposed in 8 KB chunks at 0xA000..0xBFFF via the MBC; `readSram(32768)` walked past 0xBFFF into unmapped/ROM-mirror territory.

Fix: `WriteAndVerifySink.readFullSram` (mirrors S7a's `gbxCartSource.ts:81-118`) brackets DMG/GBC reads with `setRamEnabled(true)` + per-bank `setBank` loop + `setRamEnabled(false)` finally. AGB unchanged because `protocol.readSram` handles Flash banking internally via `readAgbFlashBanked`.

### AMEND-S7b-HIL-5 (CRITICAL): Backup file MUST contain cart's CURRENT bytes, NOT a copy of the bytes-being-written

The original `flashCart` had `backupBytesSnapshot = new Uint8Array(opts.bytes)` — a copy of the post-mutation buffer (what we're about to flash). On a write failure, "restore from backup" would re-flash the same broken/intended state instead of restoring the pre-write cart. Total safety hole: there was NO PATH back to the original cart contents.

Fix v1 (commit `cbdd267`): `flashCart` does a fresh banked SRAM read AT FLASH TIME and uses those bytes as the backup. Worked but added ~3-10s and a new failure point (regressed user with a 3000ms timeout once).

Fix v2 (commit `a9d2f0d`, current): the cart's bytes are already in memory from the initial S7a read (`state.sourceBytes` for source flow, `state.dest.save.bytes` for dest). Pipe those through to `flashCart` as `opts.cartCurrentBytes`. No redundant re-read. `flashCart` defensively-copies at handoff.

### AMEND-S7b-HIL-6 (IMPORTANT): MBC bank-select needs a settle delay; firmware ack arrives before cart bus latches

Diagnosed mid-DMG-debugging then later confirmed unrelated to the actual write bug, but the defensive 20ms settle after `setBank` stayed in. The firmware ack on the bank-select wire arrives faster than the firmware actually drives the MBC bank-select pin on the cart bus — without a small delay the FIRST page write of the new bank can land against the previous bank. FlashGBX doesn't need this on Linux per upstream traces but Web Serial's USB CDC has different ack semantics. `flashgbx.ts:setBank` now does `4× setVarDelayMs` (= 20ms with default 5ms) after the cart write.

### AMEND-S7b-HIL-7 (IMPORTANT): "Connect destination cart" UX gap — chicken-and-egg behind the destinationConnected gate

The `renderCartConnectButton('dest', ...)` originally lived inside `renderCartDestPane`, which only rendered as the right-pane subview when `destinationConnected === true`. So the user couldn't get to the connect button until the dest cart was already connected. Fixed (commit `1f9959d`) by adding `renderConnectDestination` prop to `stagingPane` — the staging pane shows the connect button above the staging list whenever no dest cart is connected. Once connected, the subview toggle (staging ↔ destination) replaces the button.

### AMEND-S7b-HIL-8 (IMPORTANT): STORE-in-destination button doubles as Stage in Cart Mode

The user's UX call (correct): in Cart Mode the existing comparison-overlay STORE button should stage the converted Gen 3 mon into the IDB staging box rather than running the upload-mode inject + zip download. Same mental model (commit a source mon to "destination"), context-aware behavior via `state.cartConnection` branch in `buildDestStoreProp`. Also wires the Place flow: `onPlaceClick` sets `staging.placingMonAt`; the dest-box-browser's `onSlotClick` checks for pending placement and calls `stagingStore.setDestination`.

### AMEND-S7b-HIL-9 (IMPORTANT): Generator stubbed the Commit→flashCart wiring; loop-back required

The first Generator round shipped 9 commits with 22/27 amendments applied, but stubbed the `confirmFlashDialog.onConfirm` handler (it dispatched `cart_flash_dismissed` instead of calling `flashCart()`). Code Evaluator caught this as a PARTIAL_PASS verdict; loop-back Generator (commit `4ef9402`) wired the live trigger + same-cart compare hook + `?cart-write-chunk=64` / `?cart-write-baud=1m` URL flag parsing.

### AMEND-S7b-HIL-10 (NICE): Diagnostic console-log for verify mismatches

`writeAndVerifySink.ts` now `console.error`s the first 10 mismatch entries (offset + expected + actual) when verify fails. Cheap and made HIL bisection of the AGB Flash bug trivial — a single console line revealed "all actual bytes are 0xFF" → erase happened but writes didn't take → opcode was wrong. Without it we'd have been stuck on byte-count alone for a long time.

---

## Final commit log (chronological since `b66659c`)

```
94eab43  hoist SaveSink to family-agnostic core/src/sav/saveSink.ts
11104cd  add JedecFlash + agbFlashSectorPlan helper for AGB Flash writes
036a177  protocol writeSram for DMG SRAM + AGB Flash
dbf1e8b  GbxCartSink + WriteAndVerifySink + transfer matrix/composeWrite
448cc96  IndexedDB-backed StagingStore + multi-tab BroadcastChannel
4b689a0  cartFlasher + recovery controller + BackupSink size-verify
ff73790  reducer extensions for cart-flash + staging sub-states
ce067f9  cart-mode UI — staging pane + confirm/progress/recovery dialogs
979500e  wire cart-write UI into the controller + bump bundle cap to 120 KB
4ef9402  close 3 HIL-blocking gaps from EVAL.md (live wire, same-cart refuse, URL flags)
edaad82  STORE-in-destination becomes Stage in Cart Mode + Place-at-slot wiring
d40644d  fix verify-after-write on DMG — bracket readback with RAM-enable + bank switching
daa0aa6  log first 10 verify mismatches to console for HIL diagnostic
839efb8  add 20ms settle after setBank to fix MBC3 bank-switch race
eb46204  fix DMG SRAM write — move CS_PULSE=0 cleanup AFTER payload, not before
cbdd267  backup must contain CART'S CURRENT bytes, not the bytes-to-write
a9d2f0d  backup uses bytes from initial S7a read, not redundant cart re-read
1f9959d  surface 'Connect destination cart' button in staging pane
f709487  fix AGB Flash page write — match FlashGBX cadence (setvars once + single readAck)
aa00e47  AGB Flash page write needs OP_AGB_CART_WRITE_FLASH_DATA (0xC7), not _SRAM (0xC4)
```

20 commits. The first 11 are the Generator + first loop-back; the last 9
are HIL fixes from the 2026-04-23 → 2026-04-25 hardware-debugging session.

---

## Hardware-in-the-loop validation (what worked end-to-end)

Confirmed by the user (Joel) on 2026-04-25:

**Pokemon Red (Gen 1, MBC3, 32 KB SRAM):**
- Connect Red → S7a read flow populates source pane, party + boxes parse correctly
- Click a mon in source box browser → comparison overlay opens
- "STORE in destination" stages the converted Gen 3 mon into IDB staging box
- "Commit to source" → typed-PROCEED dialog → backup .sav downloads → DMG SRAM write fires → readback verify → success
- Re-read cart confirms the staged mon is gone from Red

**Pokemon Ruby (JP, Gen 3, 128 KB Flash):**
- Disconnect Red, click "Connect destination cart" in staging pane
- Same-cart compare passes (different TID/label vs Red)
- Ruby reads + parses; staging pane stays accessible alongside dest box browser
- "Place at..." on staged Pidgey → click empty slot in Ruby box browser → destination assigned
- "Commit to destination" → typed-PROCEED → backup .sav downloads → AGB Flash write fires (32 sectors × erase + page-write) → readback verify → success
- Re-read cart confirms Pidgey present at the placed slot
- Pidgey appears as PIDGEY in PKHeX (decryption + species ID correct); flagged as illegal by PKHeX legality engine due to the convert-pipeline preserve-moves-verbatim philosophy not matching the FireRed-bred-egg cover story (orthogonal to S7b — this is the known HOME-strict + essence-preservation tradeoff baked into the convert path)

**Recovery path:** also exercised when AGB Flash write was fully blanking the cart (pre-fix). User flashed the pre-write backup .sav back to Ruby via FlashGBX without data loss. The mandatory-backup gate did its job.

---

## What did NOT ship (deferred to S7c or later)

- **Gen 1→Gen 2 cart-to-cart Time-Capsule conversion** — per AMEND-S7b-21 / DECISION-3. The Time-Capsule converter doesn't exist yet and isn't part of the user's stated mission (Gen 1/2 → Gen 3 HOME-strict). Matrix entry returns `'GEN1_TO_GEN2_NOT_YET'`.
- **Gen 3→Gen 3 cart-to-cart** — per DECISION-10. Slot-rotation + active-slot-write-back complexity left for a focused follow-up.
- **Place-time decode sanity check** (per AMEND-S7b-17 #2). At place-time, re-decode the staged bytes via `decodeSlotSummary` and assert species/nickname match the staged-record's display fields. Documented in `stagingStore.ts:148`; the actual hook fires when the place-modal lands properly. For S7b the Place flow uses dest-cursor click which goes straight to `setDestination` — no opportunity for sanity check. S7c follow-up.
- **Dry-run UI affordance** (per AMEND-S7b-24). Compose pure-data path is shipped; just no UI surface to "preview the write before committing." Not blocking — typed-PROCEED + mandatory-backup are sufficient gates.
- **`?dev-skip-backup=1` URL flag** (per AMEND-S7b-25). NICE-only; intentionally skipped to avoid any production exposure.
- **Hoenn Gen 3 front sprites (252-386)** — still using the overworld walker pack everywhere (per DECISION-4). Works fine but visually inconsistent with upload-mode comparison view's gen3-front renders for ndex 1-251.
- **JP Gen 1/2 charmap divergence** (forward-carry from S6a/S7a). JP carts still display nicknames as `?` for non-ASCII bytes.
- **HOME-strict legality of converted mons** — not a sprint deliverable but worth flagging: the `preserveMoves` verbatim copy in `core/src/fields/moves.ts` is incompatible with the bred-egg cover story for many species (Pidgey at Lv5 with only Gust = "Invalid Move 1" because Pidgey learns Gust at Lv9 in FRLG). PKHeX flags converted mons as illegal for this reason. This is a known tradeoff between essence-preservation and HOME-strict legality; either philosophy is legitimate, and a future effort could explore "rewrite moves to nearest legal" as an opt-in.
- **GS-Ball "anime trade" animation polish** (queued in `project_pokeportal_gsball_animation.md` memory).

---

## Forward-carries to S7c (binding contracts)

1. **Same-cart hard-refuse model**: no OVERRIDE escape hatch. If S7c needs to support same-cart read→mutate→write (different from staging), implement it as a separate workflow, not as an OVERRIDE in the dest-connect flow.
2. **Mandatory backup**: every cart-write MUST run through `BackupSink.persistBackup` first; failure throws `BACKUP_FAILED` and aborts before any write opcode hits the wire. Don't add bypass paths even for "trusted" operations.
3. **Verify-after-write**: every write MUST run through `WriteAndVerifySink`. The verify uses banked SRAM read for DMG/GBC; AGB uses `readSram` (Flash banking internal). Don't widen diff masking to "fix" mismatches — narrow specifically on a real-hardware false-positive.
4. **Backup content = cart's CURRENT bytes**: pipe through from the initial S7a read (`state.sourceBytes` / `state.dest.save.bytes`), NOT a re-read at flash time, NOT a copy of bytes-being-written.
5. **AGB Flash opcode**: page writes use `OP_AGB_CART_WRITE_FLASH_DATA` (0xC7) + method byte. JEDEC commands and bank-switch use `OP_AGB_CART_WRITE_SRAM` (0xC4). Don't conflate.
6. **DMG write cadence**: `setvars per page → opcode + payload + readAck per page → cleanup setvars at sector end`. Per LK_Device.py:1614-1638. CS_PULSE=0 cleanup is at the END of WriteRAM, NOT inline.
7. **AGB Flash write cadence**: setvars ONCE per sector, then 16 page-write iterations sharing that setup. Single readAck per page.
8. **bank-select settle**: 20ms after every `setBank` (= 4× setVarDelayMs). MBC bank-select latch propagation is slower than the firmware's wire ack on Web Serial.
9. **Cleanup hook**: `cartFlasher`'s finally-block calls `protocol.cleanup()` BEFORE `port.close()` — downgrades baud back to 1M so the next session can re-handshake without a physical cart power-cycle.
10. **HIL is non-negotiable**: mock-port unit tests caught NONE of the 10 HIL bugs in this sprint. Real-hardware testing on every protocol change is required.

---

> Sprint 7b PLAN.md and PLAN_EVAL.md (with the 27 binding amendments + 10
> orchestrator decisions) are preserved in git history at commit
> `b66659c`. EVAL.md is preserved at the archiving commit. Read via
> `git show b66659c:PLAN.md`, `git show b66659c:PLAN_EVAL.md`,
> `git show <archive>:EVAL.md`.
