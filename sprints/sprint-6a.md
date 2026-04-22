# Sprint 6a Archive — pokeportal Gen 3 Save Read/Write (save-to-save inject)

**Status**: PASS (archived 2026-04-22).
**Scope**: Gen 3 save reader (R/S/E + FR/LG, English) + Gen 3 save writer (inject converted mon at chosen box+slot, recompute checksums, output modified `.sav`). Web UI: destination drop zone + 14×30 destination box-picker + STORE-in-destination action alongside the existing `.pk3` download. Save-to-save only — Web Serial GBxCart RW adapter is S6b.
**Test outcome**: 390 tests passing (312 core + 78 web), 1 permitted skip. Web bundle 36.61 KB gzipped (cap 200 KB; +4.62 KB vs S5).
**Previous sprint**: S5 (visual makeover).
**Next sprint**: S6b (Web Serial GBxCart RW adapter — user owns the hardware, so the cart-read/write integration is real, not speculative).

---

## Retrospective amendments (binding for S6b)

- **AMEND-S6a-1** (HANDOFF / planner correction, applied): Gen 3 sector
  rotation is **NOT** a uniform function of `save_index`. The PLAN's
  formula `physical_id = (logical_id + rotation) % 14` (with
  `rotation = save_index % 14`) holds for the rotated saves we tested
  (Ruby slot A: save_idx 152, rotation 12; FireRed slot B: save_idx 71,
  rotation 1) but emerald.sav has `save_idx 1658` (rotation should be
  `1658 % 14 = 6`) yet sector 0 sits at physical position 0. The
  Generator handled this by reading sector_ids empirically per physical
  sector and building the logical→physical map directly from disk,
  instead of computing rotation arithmetically from `save_index`. This
  is the correct approach and the one S6b's GbxCartSource should
  inherit. Fixed in `core/src/sav/gen3/sectors.ts` (`findActiveSlot()`).

- **AMEND-S6a-2** (PLAN_EVAL A2 correction, applied): The plan's
  security-key XOR consistency probe (verify `security_key ^ mirror`
  matches `gameCode`) is **non-applicable on real fixtures** — emerald's
  security-key mirror at body offset `0xFCC` is `0x00000000`, not the
  inverse-XOR. Generator fell back to a simpler `gameCode == 0/1/else`
  discriminator (Ruby/Sapphire/FRLG distinction via gameCode, Emerald
  via gameCode + body content). Documented in `format.ts`. Works on all
  three real fixtures.

- **AMEND-S6a-3** (orchestrator fixture note): The user supplied the
  three Gen 3 fixtures with **Box 1 wiped** as advertised, but in
  Emerald's case Box 1 actually contains 30 mons (it appears the user
  re-deposited a test population there before sending). Generator's
  inject test for Emerald uses **Box 13** (the one the in-game
  `currentBox` field points at, which is empty in this fixture)
  instead. Ruby and FireRed Box 1 are genuinely empty. Tests are
  asymmetric — anyone reading inject.test.ts should know why.

- **AMEND-S6a-4** (forward-carried to S6b — `SaveSink` interface
  freeze): The interface in `core/src/sav/gen3/saveSink.ts` is
  intentionally minimal but includes `signal: AbortSignal` and
  `onProgress?: (bytesWritten, totalBytes) => void` so S6b's
  `GbxCartSink` can drop in without forcing a retroactive widening.
  S6b will provide a second `SaveSink` impl alongside the existing
  `FileDownloadSink` in `web/src/ui/destSink.ts`. Same applies to a
  future `SaveSource` interface for cart reads (not designed in S6a;
  S6b should design it symmetrically with `SaveSink`).

- **AMEND-S6a-5** (forward-carried — coverage gaps from PASS verdict):
  Two minor coverage gaps that didn't block PASS but should be plugged
  in S6b or a follow-up:
  - No 64 KB single-slot `.sav` test fixture. Generator implements
    single-slot support (per A6) but only the 128 KB dual-slot case is
    fixture-backed. S6b can add a `firered-single-slot.sav` fixture by
    truncating the existing `firered.sav` to the active slot.
  - No unit test for `regionalDexWarning()` (the helper that decides
    whether the destination game's regional dex includes a given
    species). Helper is correct and exercised through integration, but
    no per-species pin against future regression.

- **AMEND-S6a-6** (forward-carried from S5 still pending): Gen 1/2
  charmap divergence on bytes `0x90`, `0xF4` (GitHub issue #1) was
  intentionally not fixed in S6a. Generator added a TODO comment in
  `core/src/data/charmap12.ts`. Should be tackled standalone before any
  sprint that surfaces destination-side nicknames more prominently.

---

## What shipped

**Gen 3 save reader** (`core/src/sav/gen3/`). Public API:
- `parseGen3Save(bytes: Uint8Array): Gen3SaveContents | Gen3SaveError`
- `injectIntoSave(save, slotInBox, mon): Uint8Array`
- `detectGen3(bytes): SaveFormat3 | null`

Handles 128 KB dual-slot AND 64 KB single-slot saves. Picks the active
save slot by `save_index` comparison. Reads sector-rotation map
empirically per physical sector (per AMEND-S6a-1). Decrypts boxed mons
via XOR with PID^OT key + reverses the substructure shuffle by PID%24.
Decodes 14 box names via `charmap3.ts`. Distinguishes Ruby vs Sapphire
vs Emerald vs FireRed vs LeafGreen via `gameCode` discriminator (per
AMEND-S6a-2).

**Gen 3 save writer / injector** (`injectMon.ts`):
- Writes the 80-byte slot into the correct sector(s) — handles the
  multi-sector boundary (a slot can span two sectors at box boundaries;
  test `inject.test.ts > boundary-spanning slot` pins this case
  explicitly).
- Recomputes the per-sector 16-bit checksum (sector body size is `3884`
  for sector 0, `3968` for sectors 1..13 — per AMEND-S6a-3 from
  PLAN_EVAL).
- Same-slot writeback policy: writes back to the slot we read from,
  bumps `save_index`, leaves the other slot byte-identical (verified
  by per-fixture round-trip + inject byte-equality assertion outside
  the touched-sector range).
- **Section 0 (trainer info) is byte-identical after inject** —
  proven by explicit assertion in `inject.test.ts`.
- Empty-slot enforcement: `decodeSlotSpecies()` decrypts the
  substructure and checks `species == 0` (per A5). Inject refuses
  occupied slots with `SLOT_OCCUPIED` error.

**`SaveSink` interface** (`saveSink.ts`). Async `write(bytes)` taking
optional `AbortSignal` and `onProgress` callback. Browser
implementation in `web/src/ui/destSink.ts` (`FileDownloadSink`)
triggers the modified `.sav` download via a transient `<a download>`
element. Designed so S6b's `GbxCartSink` can drop in without changes.

**Web UI extensions** (additive on the S5 state machine — `loaded`
state gained optional `dest`, `destDownload`, `destParsing`,
`destParseError` fields; the discriminator
`'idle' | 'parsing' | 'parse_error' | 'loaded'` is unchanged):
- Second drop zone "Drop destination .sav (Gen 3)" next to the source
  drop zone.
- `destBoxBrowser.ts` — new component, 14×30 grid (5 cols × 6 rows per
  box), prev/next box navigation showing the decoded 9-char box name
  ("BOX 1", "LEGENDS", etc.). Cursor lands on any slot; occupied slots
  get a darker tile.
- `comparisonView.ts` — extended to render two action buttons:
  - `[STORE in destination]` — visible-but-disabled with hover tooltip
    "Load a destination save first" when no destination is loaded (per
    Q3 decision). Enabled iff dest loaded AND cursor is on an empty slot.
  - `[Download .pk3]` — existing S5 behaviour, always enabled for
    non-refused mons.
- Regional-dex warning rendered as a yellow caption between conversion
  details and the action menu when the species isn't in the destination
  game's regional dex (per A10). Not silenceable (per Q5).
- STORE click triggers download with filename
  `${dest-stem}.modified-${YYYYMMDDHHmmss}.sav` (per Q4 — `.modified-`
  not `.poked-`, timestamp for collision safety).

**Sprite gap** (per A9). `web/public/sprites/gen3/` only vendors species
1..251. Destination box rendering for species 252..386 falls back to a
"?" placeholder. TODO comment in `destBoxBrowser.ts`. Vendoring 252..386
is a separate task (could be folded into S6b or done standalone).

**Tests** (per fixture):
- `roundtrip.test.ts` (21 tests): parse → re-serialise → assert
  byte-by-byte equality over the FULL 131072-byte buffer for ruby,
  emerald, firered. Both active and inactive slots verified.
- `inject.test.ts` (29 tests): inject one converted Crystal Feraligatr
  per fixture, re-parse, assert mon at chosen slot + everything else
  byte-identical to original except the touched sectors' checksums and
  `save_index` field. Includes the boundary-spanning slot test
  (box 1 slot 19 spans two sectors).
- `autodetect.test.ts` (10 tests): `parseGen3Save` returns the correct
  `SaveFormat3` for each fixture.
- `rotation.test.ts` (9 tests): explicit assertions on the empirically-
  read sector-id maps for all three fixtures.
- `checksum.test.ts` (5 tests): per-sector body-size selection vector
  (sector 0 = 3884 bytes, sectors 1..13 = 3968 bytes).
- Web: `state-dest.test.ts` (11), `destBoxBrowser.test.ts` (7),
  `gen3-save-flow.test.ts` (9 — full jsdom integration: drop both saves,
  click STORE, verify modified bytes contain injected mon at chosen slot).

---

## Out-of-scope items still deferred to S6b (or beyond)

- **Web Serial GBxCart RW adapter** — S6b. Both `SaveSink` (write to
  cart) and a yet-to-be-designed `SaveSource` (read from cart) interfaces
  needed.
- **64 KB single-slot fixture-backed test** — see AMEND-S6a-5.
- **Vendoring Gen 3 sprites for species 252..386** — see A9 / S6b candidate.
- **`regionalDexWarning()` unit test** — see AMEND-S6a-5.
- **Gen 1/2 charmap divergence fix (GitHub issue #1)** — see AMEND-S6a-6.
- **Mobile responsive** — desktop ≥ 720 px only.
- **International saves** — English only.

---

> Sprint 6a PLAN.md and PLAN_EVAL.md (with the orchestrator-decisions
> block) are preserved in git history at commit `b24b00f` (planner +
> evaluator + fixtures landed together). EVAL.md is preserved at the
> archiving commit. Read via `git show b24b00f:PLAN.md`,
> `git show b24b00f:PLAN_EVAL.md`, and `git show <archive-commit>:EVAL.md`.
