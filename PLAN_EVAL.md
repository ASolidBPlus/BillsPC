# PLAN_EVAL.md — Sprint 6a (Gen 3 destination save inject)

## Verdict

**APPROVE_WITH_AMENDMENTS** — 14 binding amendments. The plan's overall
shape (additive `loaded` extension; `SaveSink` for forward-compat with
S6b; PC-box-only inject; per-game detect via `gameCode`; defensive copy
of `bytes`; round-trip + inject golden tests; STORE-only-on-empty
discipline) is correct and S6b-compatible. The defects below are mostly
**spec-precision errors in §3** (sector sizes, semantic-block IDs that
differ by game, security_key offset, write-policy ambiguity) plus three
genuine scope/safety items the plan omitted (partial-save handling,
sprite-coverage gap, dex-eligibility gate). All amendments must be
applied before Generator runs.

The Generator should treat each amendment as a contract delta against
the cited PLAN section/file. Amendments are listed by severity then by
PLAN section so they can be applied top-down.

---

## Amendments

### A1 — CRITICAL — Per-game sector-id semantic map is wrong; section IDs differ between R/S, Emerald, and FR/LG

**Where**: §3.5 "Per-game semantic-block map" (the table claiming sector_ids 0..13 are identical across R/S, Emerald, FR/LG).

**Defect**: The plan asserts a single shared layout: TrainerInfo=0, TeamItems=1, GameState=2, MiscData=3, RivalInfo=4, PCBuffer=5..13. This is **only correct for R/S/E**. PKHeX `SAV3FRLG.cs` documents that **FireRed/LeafGreen reorder several non-PC sectors** (specifically the post-Trainer blocks; the FR/LG TeamItems block is shorter than R/S/E because the bag layout differs, and several "MiscData"-class blocks are split differently). The PCBuffer is sector_ids 5..13 in **all three games** (this part of §3.5 is correct), so the inject path itself is unaffected — but any code that reads or writes anything in sectors 1..4 using the same offset table for all three games will silently corrupt FR/LG saves.

**What the Generator must do**: Limit S6a's sector-id map to **sector 0 (TrainerInfo, read-only) and sectors 5..13 (PCBuffer, the only sectors we write)**. Explicitly DO NOT define semantic-block names for sectors 1..4 — the plan's `RivalInfo` etc. labels are misleading and unused, and shipping them invites future drift. The detect step reads `gameCode` from sector 0 only, which is in the same body offset across all three games (§3.5's `0x00AC` claim, see A4 below). Document in `sectorLayout.ts` as a one-line comment: "S6a only writes sectors 5..13; non-PC sector layout differs by game and is intentionally not modelled."

---

### A2 — CRITICAL — `gameCode` body offset and `security_key` body offset are wrong / conflated

**Where**: §3.5 ("…game_code u32 at offset 0x00AC of the body…") and §5.2 step 4 (uses `0xAC`) and §5.2 step 5 (claims security_key plaintext at `0x01F4` and "encrypted at 0xAC").

**Defect**: The plan conflates two distinct fields and gets the security_key offset wrong. Per PKHeX `SAV3.cs` and `SAV3E.cs`:

- The TrainerInfo sector body (sector_id 0) contains `gameCode` at body offset **`0x00AC`** in R/S, FR/LG. (This part is correct.)
- In Emerald, the same body offset `0x00AC` holds the **encrypted security_key** (not a meaningful gameCode). The **plaintext security_key copy** lives at body offset **`0x00AC + 0xF20` = `0xFCC`** within sector 0, NOT `0x01F4`. (PKHeX `SAV3E.cs::SecurityKeyOffset = 0xAC`, plaintext mirror at `0xAC + 0xF20`.)
- R/S `gameCode` is `0x00000000` only on a fresh-game save; once the player saves once with gameCode-relevant flags set (rare but possible via certain flags) the value can drift. The detect must therefore not read `gameCode == 0` as a strict R/S guarantee — it must combine `gameCode == 0 OR gameCode == 1` (R/S/E discriminator group) with the security-key XOR consistency probe.

**What the Generator must do**:

1. In `detect.ts`, replace the algorithm in §5.2 with this revised order:
   - **Step A**: Read `gameCode = readU32LE(sec0Body, 0xAC)`. If `gameCode === 1` → `FIRERED_LEAFGREEN`. (Cross-check: also verify body offset `0xAF` flag; FR/LG's `0xAC` is a true 32-bit `1`, not coincidentally part of an Emerald security_key whose low byte happens to be `0x01`.)
   - **Step B**: Else read `securityKeyMirror = readU32LE(sec0Body, 0xFCC)` (NOT `0x1F4`). If `(gameCode XOR securityKeyMirror) === 0xFFFFFFFF` AND `securityKeyMirror !== 0` → `EMERALD`.
   - **Step C**: Else if `gameCode === 0` → `RUBY_SAPPHIRE`.
   - **Step D**: Else → `null` (unrecognised; surface as `UNRECOGNIZED_FORMAT`).
2. In `trainer.ts`, do not expose `securityKey` to S6a callers — we do not write it and reading it adds no inject value. (Keep the read in `detect.ts` only.)
3. Replace every reference to `0x1F4` in PLAN.md notes with `0xFCC` in the Generator's code comments. (The PLAN.md text is not edited per process rules; this amendment overrides it.)

---

### A3 — CRITICAL — Sector body size is 3968 only for sector 0; for sectors 1..13 it's 4084

**Where**: §3.2 ("each 4096-byte sector ends with a 12-byte footer", "SECTOR_BODY_SIZE = 3968"), §3.4 (checksum loops 3968 bytes), §5.3 constant `SECTOR_BODY_SIZE = 3968`.

**Defect**: The plan sources its body size from PKHeX's `SIZE_USED` constant but reads it backwards. PKHeX uses **two** body sizes:

- **sector_id 0 (TrainerInfo)**: 3884 bytes used for checksum (PKHeX `SaveUtil.cs::SIZE_USED_BLOCK0 = 0xF2C = 3884`).
- **sector_id 1..13**: 3968 bytes used (PKHeX `SaveUtil.cs::SIZE_USED = 0xF80 = 3968`).

The plan's parenthetical at §3.2 ("we will use 3968 across the board on read/write because the unused-tail bytes are included in the zero-extended checksum sum without changing the result") is **wrong on two counts**:

1. PKHeX does NOT use 3968 across the board. It uses 3884 for sector 0 and 3968 for sectors 1..13.
2. The "unused tail bytes are zero" assumption is false for sector 0 in many real saves — that 84-byte gap (`0xF2C..0xF80`) overlaps fields the game writes and that contain non-zero data on a played save (specifically, parts of the "extra trainer flags" region in Emerald and the e-Reader scratch area in FR/LG). Including those bytes in the checksum will produce a value that differs from the original on-disk checksum, so a parse → no-op → serialise round-trip will FAIL the byte-equality test.

**What the Generator must do**:

1. In `sectorLayout.ts`, define `SECTOR_BODY_SIZE_TRAINER = 3884 as const` and `SECTOR_BODY_SIZE_DEFAULT = 3968 as const` (drop the single `SECTOR_BODY_SIZE` constant).
2. In `checksum.ts`, change the function signature to `gen3SectorChecksum(body: Uint8Array, sectorId: number): number`. Loop bound: `(sectorId === 0) ? 3884 : 3968`. Add a unit test with a TrainerInfo sector that has non-zero bytes in `[0xF2C, 0xF80)` to anchor the difference.
3. In `gen3-roundtrip.test.ts`, the parse → no-op → serialise byte-equality test is what catches this regression. Add an explicit assertion that EACH sector's recomputed checksum equals its stored checksum on a fresh-untouched parse; a single byte-equality at the file level is necessary but the per-sector assertion produces a clearer failure if A3 is mishandled.

---

### A4 — CRITICAL — Writeback policy unspecified for save_index; plan lets the active slot get clobbered by the inactive slot on next in-game save

**Where**: §3.1 ("we always read the active slot, write back to the same active slot, and leave the inactive slot unchanged"), R3 ("Inactive save slot left untouched"), §5.9 inject step 5.

**Defect**: The "write back to the same slot, do not bump save_index, leave inactive untouched" policy is the **safest choice for the file we write**, but the plan's R3 narrative is wrong about the behaviour when the .sav is loaded in-game afterwards. When the player loads our modified .sav and saves once:

- The game reads the active slot (our modified one — correct, our injected mon is loaded into PC).
- The game then writes the NEXT save to the **previously-inactive slot** with `save_index = old_save_index + 1`.
- The mon is in PC RAM, so it gets written into the new active slot's PC region — the inject survives.

This part is fine. But there's a separate hazard the plan doesn't surface: **if `save_index` of the active slot was very large (close to `0xFFFFFFFE`) and the inactive slot was `0xFFFFFFFF`** (uninitialised / battery-fresh-second-slot), the game's "pick higher" comparator goes the wrong way and re-reads the OLD inactive slot on next boot, which contains stale or zero data. PKHeX guards against this by **always writing to BOTH slots**, with the new slot getting `save_index + 1` and the old slot getting `save_index` (so the new slot wins on re-read regardless of overflow corner cases).

For S6a's "user owns the cart" use case the corner case is vanishingly rare, but the plan's chosen policy needs to be **explicit, tested, and called out as a known limitation** rather than presented as the safe default.

**What the Generator must do**:

1. In `inject.ts`, document the writeback policy as an inline comment block: "S6a writes back to the SAME active slot with the SAME save_index. Inactive slot is left byte-identical. This matches the file we read; the player's next in-game save will rotate slots normally and the injected mon will be carried into the next active slot via PC RAM. Known corner case: if the original active slot had `save_index === 0xFFFFFFFE` and the inactive slot was `0xFFFFFFFF`, the next boot in-game will read the wrong slot. We do not guard this — see EVAL R3."
2. In `gen3-roundtrip.test.ts`, add an explicit assertion: `output.slice(inactiveSlotOffset, inactiveSlotOffset + 0xE000)` byte-equals `input.slice(inactiveSlotOffset, inactiveSlotOffset + 0xE000)`. The Hall-of-Fame and e-Reader/Mystery-Gift blocks (offsets `0x1C000`..`0x20000`) get the same byte-equality assertion.
3. Do NOT switch to a dual-slot writeback policy in S6a. The simpler policy is safer for the common case; a future sprint can revisit.

---

### A5 — CRITICAL — Empty-slot detection semantics conflict with in-game state

**Where**: §5.6 "Empty-slot detection" ("a slot is empty iff all 80 bytes are zero"), R5, §5.1 `BoxedSlot` discriminator, §5.9 inject step 3.

**Defect**: The plan picks the all-zero check, citing PKHeX. **PKHeX actually uses `species == 0` after decryption**, NOT all-zero pre-decrypt. The two definitions agree on a fresh save (the game zeroes empty PC slots to all-`0x00`), but they diverge when the player has ever DEPOSITED-AND-WITHDRAWN from a slot: the game writes `species = 0` to mark the slot empty but **does not zero the rest of the 80 bytes**, leaving stale PID/OT/IV bytes from the previous occupant. With the all-zero rule, S6a will treat such a slot as **occupied** and refuse to inject — which directly contradicts the user-facing "this slot is empty in PKHeX, why won't this tool let me use it?" experience.

The PID-zero-and-checksum-zero check (mentioned in §5.1 boxedRecord.ts comment) is a **different** check from PKHeX's, and it's also wrong: a real Pokemon's PID can legitimately be small (PID 0 is rare but reachable after an inject from another tool; PID 0 is what the *empty Box 1 Slot 1 of a fresh game* has, alongside checksum 0).

**What the Generator must do**:

1. Adopt the PKHeX rule: **a slot is empty iff its decrypted Growth substructure has `species == 0`**. This requires decrypting the 48-byte block before classification. The decrypt is cheap (12 XORs per slot, 14×30 = 420 slots, ~5040 XOR ops total — sub-millisecond).
2. In `pcBoxes.ts::readPcBoxBlock`, decrypt each filled-looking slot to read `species` (use the existing `decryptBlock` and `unshuffleSubstructures` from `core/src/pack/`). If `species === 0` → `{ kind: 'empty' }`, else `{ kind: 'filled', bytes: <80-byte raw record> }`.
3. The `BoxedSlot.filled` variant keeps the **encrypted** 80 bytes (we never want to re-encrypt on write — the inject takes a freshly-packed encrypted record from `packBoxed` and writes it as-is).
4. Add a unit test in `gen3-pc-boxes.test.ts`: a synthetic slot with `species = 0` but non-zero PID and stale Growth bytes parses as `empty`, and an inject into that slot SUCCEEDS (not `SLOT_OCCUPIED`).
5. Update §5.6 boxedRecord.ts comment in `boxedRecord.ts` source to reflect the actual rule (the PLAN.md text is informational; the code comment is what matters).

---

### A6 — CRITICAL — Plan does not handle 64 KB (single-slot) Gen 3 saves; will crash on real input

**Where**: §3.1 ("a Gen 3 save image is 128 KB"), §5.2 step 1 ("must be exactly 131072 bytes"), §1 in-scope ("128 KB English Gen 3 .sav").

**Defect**: A non-trivial fraction of Gen 3 saves in the wild are **64 KB** (single save slot, no slot B, no Hall of Fame, no e-Reader scratch). These come from:

- mGBA's "save type override" set to `flash512` (vs `flash1m`) — produces 64 KB.
- Hardware GBxCart RW dumps when the cartridge's flash chip is the 512 Kbit variant (some bootleg carts and a small number of original-hardware revisions).
- Older emulator save formats (VBA pre-1.7).

PKHeX accepts both. The user has explicitly named PKHeX as their compatibility benchmark. If S6a refuses to load a 64 KB save with `TOO_SHORT`, the user will (correctly) report a regression against PKHeX.

The user has also explicitly named the GBxCart RW as their hardware target for S6b. If S6b reads a 64 KB SRAM and S6a's parser refuses it, the integration breaks.

**What the Generator must do**:

1. In `detect.ts` and `parser.ts`, accept input lengths of **131072 (128 KB)** OR **65536 (64 KB)**. For 64 KB inputs:
   - Treat the entire buffer as Slot A (no Slot B exists).
   - `findActiveSlot` returns `slotIndex: 0` unconditionally; `inactiveSlotOffset` does not exist.
   - The Hall-of-Fame and e-Reader/Mystery-Gift blocks do not exist; serialiser must NOT write past offset `0x10000` (= 65536).
   - Parser surfaces a `gen3_single_slot_save` warning so the EVAL can grep for it.
2. In `gen3-roundtrip.test.ts`, add at least one 64 KB fixture (can be derived from a 128 KB fixture by `bytes.subarray(0, 0x10000)` — but only if Slot A happens to be active in the source, which is true for fresh saves).
3. In `serialiser.ts` and `inject.ts`, branch on `parsed.bytes.length` (don't hardcode 131072).
4. Document in §1 In-scope: "128 KB AND 64 KB English Gen 3 .sav images."

---

### A7 — IMPORTANT — Sprint 14 (FR/LG distinction) and the `gameCode == 1` discriminator are insufficient to tell FR from LG; plan's R/S vs FR/LG safe-grouping is right but the user-visible label may mislead

**Where**: §5.1 `Gen3Game = 'RUBY_SAPPHIRE' | 'EMERALD' | 'FIRERED_LEAFGREEN'`, §5.13 UI summary `Pokemon Emerald`.

**Defect**: The plan correctly groups R+S and FR+LG as detect-equivalent. But the §5.13 UI text "Destination: <name> (Pokemon Emerald)" implies S6a knows the precise game. For Emerald that's true. For R/S and FR/LG it isn't. The user has been clear (HANDOFF philosophy: "do not over-claim"); a UI label that promises a specificity the parser cannot deliver is a small but real lie.

The user owns all 5 carts and intends to verify each modified .sav in PKHeX. They will notice.

**What the Generator must do**:

1. The data-model `Gen3Game` enum stays as the plan defines it (R/S grouped, FR/LG grouped). This is correct because the inject behaviour is identical within each group.
2. The UI label must read `Ruby/Sapphire`, `FireRed/LeafGreen`, or `Emerald` — explicit slash, no false specificity.
3. Add `Gen3Game` → human label as a single helper in `web/src/ui/destBoxBrowser.ts` (or wherever the label is rendered): `function gameLabel(g: Gen3Game): string`.
4. Update §5.13 UI mockup in the Generator's implementation to reflect this. (PLAN.md text not modified per process rules.)

---

### A8 — IMPORTANT — Box names must be decoded; the plan's "punt" recommendation is wrong because the table is already vendored and the UX win is real

**Where**: R7 ("Box names opaque, recommendation: decode"), §3.5 PCBuffer logical layout, §5.6 `boxNamesRaw`.

**Defect**: The plan's R7 contains both a recommendation TO decode and an `opaque` field design that doesn't decode. These contradict. The Plan Evaluator's job is to break the tie.

Decode them. The Gen 3 charmap is at `core/src/data/charmap3.ts` (already vendored, already used by `pack/boxed.ts` for nicknames). Adding `decodeGen3` for box names is a one-import, ~5-line addition. The UX value is significant: a user who renamed their boxes for organisation (`LEGENDS`, `BREEDING`, `COMP TEAM`) and then sees `BOX 1..14` in the picker has a real friction. Conversely, the cost of NOT decoding compounds: the user will ask for it in S6b/S7 and we'll have to plumb it through then.

**What the Generator must do**:

1. In `Gen3SaveContents`, replace `boxNamesRaw: Uint8Array` with `boxNames: readonly string[]` (length 14). Keep `boxNamesRaw` as a parallel field for round-trip serialisation.
2. In `pcBoxes.ts`, decode each 9-byte box-name slot via `decodeGen3` (port from `charmap3.ts::GEN3_BYTE_TO_UNICODE`). The decoder should stop at the Gen 3 terminator `0xFF` and trim trailing whitespace; default to "BOX N" if the decoded string is empty.
3. In `destBoxBrowser.ts`, render `state.dest.save.boxNames[boxIndex]` as the box title.
4. Add a unit test in `gen3-pc-boxes.test.ts`: a synthetic boxNames blob with a renamed box ("LEGENDS\xFF") decodes to `"LEGENDS"`.
5. The existing GEN3_QUESTION_MARK fallback in `charmap3.ts` handles unmapped bytes — no new code needed there.

---

### A9 — IMPORTANT — Gen 3 sprite directory is incomplete (251/386); picker will render broken images for Gen 3-native species above ndex 251

**Where**: §5.11 ("Sprite art is the Gen 3 set (already vendored in `web/public/sprites/gen3/`)"); §1 ("Gen 3 species art").

**Defect**: `web/public/sprites/gen3/` contains files `1.png` through `251.png` only — that's the Gen 1+2 dex range, not the Gen 3 range. Species 252 (Treecko) through 386 (Deoxys) have no sprite files. The S6a destination picker shows EXISTING mons in the destination .sav's PC, which can include any Gen 3 species the player caught. A FireRed save with a wild Gyarados in box 1 slot 0 renders fine (ndex 130, ≤ 251). A Ruby save with Sceptile (ndex 254) renders a 404.

The plan's roundtrip + inject tests use **fresh** saves (per §7.1) where most boxes are empty, so the test suite would not catch this. EVAL would catch it during manual PKHeX validation (step 7.4) only if the user happens to have a non-fresh Ruby/Emerald save handy — but per §7.1 we explicitly use fresh saves.

**What the Generator must do**:

1. Add the Gen 3 sprite range (252..386) to `web/public/sprites/gen3/`. The same source the existing 1..251 came from (S5 vendored) should have these. If the existing source is HGSS-style (per S5), use FRLG-style sprites for the Gen 3 range — they're stylistically consistent with the destination context.
2. Alternatively (acceptable fallback): if sprite acquisition is blocked, the picker renders a generic "?" placeholder for missing-sprite tiles AND surfaces a one-line warning at the top of the picker: `Sprites for Gen 3 species (252-386) not yet vendored — placeholder shown.`
3. Add a unit test `tests/unit/sprite-coverage.test.ts` (or add an assertion to `destBoxBrowser.test.ts`) that verifies the sprite directory contains all 386 species OR that the placeholder fallback path renders a placeholder element. Whichever path the Generator picks, the test must exist.
4. Bundle-size impact: the sprite files are static assets, NOT bundled into the JS, so this does NOT affect the 200 KB gz cap.

---

### A10 — IMPORTANT — National Dex / regional Pokedex eligibility unenforced; FR/LG inject of e.g. Mareep will silently produce a slot that the in-game PC viewer cannot display

**Where**: User-question §13 ("game-code differences in mon storage"), R-section silence on the issue.

**Defect**: Gen 3 games each have an in-game restriction: until the player obtains the National Dex, the PC viewer **silently hides** species not in the regional dex. R/S regional dex covers the Hoenn 202; FR/LG regional dex covers Kanto 151; Emerald regional dex covers Hoenn 202 (mostly). Until National Dex is unlocked, an injected Mareep (Johto species) into a fresh FireRed save sits in the PC's underlying data but doesn't show on the in-game box screen. PKHeX will see it; the player using the cart in-game won't.

The S6a use case is "convert Gen 1/2 mons to Gen 3 boxes." The user's source-side Gen 1/2 species are mostly Kanto+Johto = ndex 1..251. The destination Gen 3 game choice matters:

- **Emerald + National Dex unlocked** (any save past mid-game): all Kanto+Johto visible — fine.
- **Emerald + pre-National-Dex** (fresh save): only the ~80 Kanto/Johto species in Emerald's regional dex visible.
- **R/S, any state**: same as Emerald.
- **FR/LG + post-National-Dex**: all visible.
- **FR/LG + pre-National-Dex**: only Kanto 151 visible — most Gen 2 species hidden.

The plan does not even mention this. The user owns all 5 carts and will absolutely test the inject on a fresh FR save with a Gen 2 source — and observe "the mon disappeared" — and report it as a bug.

**What the Generator must do**:

1. S6a does NOT enforce regional-dex eligibility (we don't store enough state to know whether National Dex is unlocked). But it MUST surface a warning at STORE-confirm time when the destination is R/S or FR/LG and the source species ndex is **252 (Treecko) or above** (out of dex range entirely; never visible) OR **specifically a Johto species (152..251) and the destination is FR/LG** (not visible without National Dex on FR/LG).
2. Add a STORE-confirm dialog warning row (yellow caption, not red — STORE remains enabled): `Note: this species may be hidden in-game until you obtain the National Dex on the destination cart.` The user clicks STORE knowingly.
3. The conversion path itself doesn't change. We're injecting valid Gen 3 records that PKHeX will see; the in-game visibility is a known constraint the player can resolve by progressing.
4. Add a unit test in `state-dest.test.ts`: storing a Mareep (ndex 179) into a `FIRERED_LEAFGREEN` destination produces `state.dest.storeRequest.warnings` containing a regional-dex hint.
5. Document this as a known limitation in the EVAL §7.4 manual checklist: "The injected mon is in PC data and PKHeX-visible; it will appear in the in-game PC only after National Dex is obtained on the destination cart."

---

### A11 — IMPORTANT — Plan's "BAD_PAYLOAD_SIZE for an 80-byte zero buffer" rule is wrong; reject by checksum/decrypt, not by zero-content

**Where**: §7.2 `gen3-inject.test.ts` row ("injecting an 80-byte zero buffer is rejected as `BAD_PAYLOAD_SIZE`").

**Defect**: Two errors in one line:

1. An 80-byte all-zero buffer has length 80 — exactly the right size. Calling that `BAD_PAYLOAD_SIZE` is a misleading error code.
2. The actual rule should be: "the payload must be a valid Gen 3 boxed record" — and validity is best enforced by **decrypting the payload and checking that `species != 0`** (mirroring A5). A payload that decrypts to species 0 is by definition empty, not a mon, and injecting it would create an undetectable corruption (the slot would look empty but have nonzero header bytes — exactly the case A5 warns against).

**What the Generator must do**:

1. Add a new `InjectErrorReason` value: `'PAYLOAD_NOT_A_MON'`.
2. In `inject.ts` step 1 (currently "Validate `req.bytes.length === 80`"), add a step 1b: decrypt `req.bytes` (using its own embedded PID and TID/SID), unshuffle, check `growth.species !== 0` and `growth.species ≤ 386`. If either fails → `PAYLOAD_NOT_A_MON`.
3. Replace the `gen3-inject.test.ts` row "injecting an 80-byte zero buffer is rejected as `BAD_PAYLOAD_SIZE`" with: "injecting an 80-byte all-zero buffer is rejected as `PAYLOAD_NOT_A_MON` (zero-buffer is the empty-slot encoding); injecting a 79-byte buffer is rejected as `BAD_PAYLOAD_SIZE`."

---

### A12 — IMPORTANT — `SaveSink` interface needs a progress/cancellation hook to be S6b-compatible without rework

**Where**: §4 `SaveSink`, R11 ("Plan Evaluator should sign off that the interface as written is forward-compatible enough").

**Defect**: The plan's interface is:

```ts
export interface SaveSink {
  write(bytes: Uint8Array): Promise<void>;
  readonly label: string;
}
```

For S6a's `FileDownloadSink`, this is fine — the write is instant. For S6b's `GbxCartSink` writing 128 KB to SRAM over USB-serial at ~16 KB/s, the write takes **~8 seconds**. With no progress signal, the UI will appear frozen. With no cancellation, a user who sees the cart isn't responding has no recovery short of unplugging it (which can corrupt the SRAM mid-write).

The plan acknowledges this in R11 ("if `SaveSink.write()` proves insufficient... we'll widen the interface in S6b without breaking S6a's `FileDownloadSink`") — but **widening the interface in S6b retroactively means every S6a callsite has to handle progress/cancellation as `undefined` no-op shims**, which is exactly the kind of "we'll fix it later" design hazard that turns into a "we never fixed it, and now there are two callsites" maintenance liability.

The right time to design the interface is now, when S6b's needs are known.

**What the Generator must do**:

1. Define the interface as:

```ts
export interface SaveSinkProgress {
  readonly bytesWritten: number;
  readonly bytesTotal: number;
}
export interface SaveSinkOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (p: SaveSinkProgress) => void;
}
export interface SaveSink {
  write(bytes: Uint8Array, opts?: SaveSinkOptions): Promise<void>;
  readonly label: string;
}
```

2. `FileDownloadSink.write` ignores `opts` (download is instant; progress is noise). `GbxCartSink.write` (S6b) will use both fields. Both implementations remain conformant to the same interface.
3. Add a one-line comment in `core/src/types/sav3.ts` explaining the design: "Options are accepted but may be ignored by fast/instant sinks. The S6b GbxCartSink uses both."
4. The S6a UI does NOT need to wire `signal`/`onProgress` in this sprint — `FileDownloadSink` ignores them. But the interface is the freeze point; S6b will wire them without changing S6a code.

---

### A13 — IMPORTANT — Test plan misses two regression anchors: per-slot inject preserves all OTHER slots in the same sector, and multi-sector-spanning slots actually exist

**Where**: §7.2 `gen3-inject.test.ts` and `gen3-inject-feraligatr.test.ts`, §3.6 ("slots near sector boundaries can span two adjacent sectors").

**Defect**: Two test gaps:

1. The plan's inject test asserts `pcBoxes[boxIndex][slotIndex]` is filled, but only loosely asserts "all other PC slots equal the original parse." The stronger and more useful regression anchor is: **the byte range of every other slot in the same sector** (the one we touched) is byte-identical pre/post inject. A bug in `writePcBoxSlot` that wrote 81 bytes instead of 80 would corrupt the next slot; a bug that overwrote sector padding would corrupt unrelated state. This needs an explicit per-byte sector-content assertion.
2. The plan §3.6 mentions slot-boundary spanning ("3968 / 80 = 49.6 mons per sector; slots near sector boundaries can span two adjacent sectors"). 4 sub-bytes worth: at a logical PC offset of 4 + i*80, the slot crosses a 3968-byte sector boundary when `(4 + i*80) % 3968 + 80 > 3968`, i.e., when i*80 mod 3968 ≥ 3884. The boundary slots are at logical i = 49, 98, 148, 197, 247, 296, 346, 395 (some past the box-data extent of 33600/80 = 420 slots). So **at least 8 of the 420 PC slots span two sectors**, and the inject path for those slots writes to two sector buffers. **No test in the plan exercises this case.** A bug here corrupts a real player's save.

**What the Generator must do**:

1. Add `gen3-inject-spans-sector.test.ts`: synthesise (or pick from the fresh fixture by computing the right boxIndex/slotIndex) one of the boundary slots — e.g. logical slot index 49 = box 1 slot 19 — and inject into it; assert that BOTH affected sectors get checksum-updated (the plan's `touchedSectorIds` list now has length 2, not 1) and that the resulting bytes round-trip cleanly through `parseGen3Save`.
2. Add to `gen3-inject.test.ts`: after a single-sector inject, assert `output.slice(touchedSectorOffset, touchedSectorOffset + 4096)` differs from input only at (a) the 80-byte slot range and (b) the 2-byte checksum field; every other byte in that sector matches.
3. Update §1 done-when 5 to require the multi-sector test.

---

### A14 — NICE — AMEND-S5-6 (Gen 1/2 charmap split) — defer; plan's recommendation is correct

**Where**: R1.

**Defect**: None — the plan's punt recommendation is sound. The destination picker decodes Gen 3 nicknames (separate code path), the source-side display drift is already shipped in S5, and fixing the Gen 1/2 charmap split inside S6a inflates surface area without unblocking anything in S6a's deliverable. The Plan Evaluator concurs.

**What the Generator must do**:

1. Do NOT touch `decodeGen12` or `charmap12.ts` in S6a. Leave AMEND-S5-6 carried forward.
2. Add a one-line note to the EVAL: "AMEND-S5-6 still open; deferred per PLAN_EVAL A14."

---

## Cross-cutting confirmations (no amendment needed)

The following plan choices are **correct as-stated** and the Generator should preserve them:

- **R2** (sector 0 untouched on inject) — correct invariant; testing strategy in §7.2 is fine modulo A3's per-sector body-size fix.
- **R4** (PC-only, no party inject) — correct scope.
- **R8** (no batch inject in S6a) — correct scope.
- **R9** (bundle-size headroom analysis) — sound; the +25 KB estimate looks high (the new core code is mostly numeric tables and pure functions that minify well; expect +12-18 KB), but capping at 200 KB is the right gate.
- **R10** (defensive copy of `parsed.bytes`) — correct; reducer must never mutate.
- **R12** (cancel mid-flow) — covered by the existing reducer-test row.
- §4's `SaveSource` reuse from S3a — correct; do not redefine.
- §5.8's identity-when-untouched serialiser — correct; this is the right shape and the right test anchor. Combined with A4's per-slot writeback assertions, this gives the strongest possible byte-equality safety net.
- §6's additive `loaded` extension — correct and S5-backwards-compatible.
- The PKHeX-validation gate in §1 done-when 7 and §7.4 — exactly the right manual safety net for a sprint that mutates a binary save format.

---

## Questions for the orchestrator (resolve before Generator starts)

**Q1 — Fixture acquisition (R6, plan punted to Plan Evaluator)**: How many of the five English Gen 3 fresh-game fixtures will the user provide? The Plan Evaluator's recommendation is **minimum 3 covering all three detect-equivalence groups**: one of {Ruby, Sapphire}, Emerald, one of {FireRed, LeafGreen}. Two fixtures (Emerald + one FRLG) cover the Emerald-vs-FRLG decode disambiguation but skip the R/S codepath entirely; the orchestrator should confirm whether 2 is acceptable or push for 3+. If the user can't produce them, the orchestrator should generate via mGBA + the user's existing ROMs (the user owns all 5 carts AND the corresponding ROMs per HANDOFF context).

**Q2 — Empty-box-init for fresh saves (user-question §14)**: Plan does not address this explicitly but A5+A6 cover the mechanics (a fresh save has all PC slots with `species=0`, all empty, all injectable). Confirming: the user expects S6a to inject into a fresh save with no prior PC mons — yes. Generator should add one explicit test row to `gen3-inject.test.ts`: "inject into a freshly-newgame Emerald save's box 1 slot 0 succeeds." No new amendment, just a test row. The orchestrator should confirm this matches user intent.

**Q3 — UI: STORE button placement when `state.dest` is missing (§5.13 ambiguity)**: The plan says "The S5 `.pk3` download remains visible: when the comparison overlay is open, the action area shows two buttons: `[STORE in destination]` (only enabled when state.dest is set)... `[Download .pk3]`." Should `[STORE in destination]` be **hidden** when `state.dest` is null, or **visible-but-disabled** with a tooltip "load a destination save first"? Visible-but-disabled is more discoverable for first-time users; hidden is cleaner for the source-only workflow. Plan Evaluator recommends visible-but-disabled — it makes the dual-mode workflow apparent. Orchestrator should rule.

**Q4 — Filename suggestion convention (§5.12)**: The plan suggests `pokemon-emerald.modified.sav`. This stomps the original on a re-download. Should it be `pokemon-emerald.modified.sav` (overwrite-prone) or `pokemon-emerald.modified-1.sav` / `pokemon-emerald.${timestamp}.sav` (collision-safe)? Plan Evaluator recommends `${original-stem}.poked-${YYYYMMDD-HHMMSS}.sav` — collision-safe, audit-trail-friendly, matches the project name (pokeportal → "poked"). Orchestrator should rule, including any user preference for filename style.

**Q5 — A10 regional-dex warning**: The amendment requires a soft warning at STORE-confirm. Should the warning be silenceable (preference/checkbox "don't show again")? Plan Evaluator recommends NO — it's informational, fires only on the relevant species/destination pair, and the user has been clear about wanting full transparency over silent data behaviour. Orchestrator should rule.

---

## Orchestrator decisions (binding for Generator)

**Q1 — Fixtures**: User provided 3 saves on 2026-04-22, staged at
`core/test-fixtures/gen3/`:
- `ruby.sav` (sha256 `57f63228…584982`, save_idx 152/153, slot B newer, rotation 12/13 — exercises non-trivial sector rotation)
- `emerald.sav` (sha256 `5187a9fc…ac91a8`, save_idx 1658/1657, slot A newer, rotation 0 — clean baseline)
- `firered.sav` (sha256 `ea8a83fb…1559e9`, save_idx 70/71, slot B newer, rotation 0/1)

All three are 131072 bytes (full dual-slot saves) with valid signature
`0x08012025` on every sector. **Box 1 of every save was wiped by the
user before sending** — slot 0..29 of box index 0 are guaranteed empty
and safe targets for the inject test. The rest of each save contains
real player data, which is exactly what we want for the round-trip
byte-equality assertion (a fresh-game fixture would let trivial bugs
slip through).

Coverage satisfies the Plan Evaluator's "all three detect-equivalence
groups" minimum: {Ruby} for R/S, Emerald for E, {FireRed} for FR/LG.
Sapphire and LeafGreen are not provided — Generator should NOT
fabricate them via mGBA; instead, treat the per-game decode logic for
S and LG as code-equivalent to R and FR respectively (same sector-1
layout, same security_key location), and add explicit comments
documenting that runtime support exists but only R/E/FR have
fixture-backed tests.

**Q2 — Fresh-save inject**: Confirmed yes. Generator must add a test
row in `gen3-inject.test.ts`: starting from one of the supplied
fixtures (with its already-empty Box 1), inject a converted Crystal
Feraligatr into box 1 slot 0, then re-parse and assert the mon is
present and decoded correctly.

**Q3 — STORE button placement**: **Visible-but-disabled** with hover
tooltip "Load a destination save first" when `state.dest === null`.
Disabled state uses the existing `.menu-item--disabled` styling (gray
text, no hover). Per Plan Evaluator recommendation — discoverability of
the dual-mode workflow.

**Q4 — Filename convention**: **`${original-stem}.modified-${YYYYMMDDHHmmss}.sav`**
(e.g. `firered.modified-20260422141930.sav`). Collision-safe via
timestamp; "modified" instead of the planner's "poked" suffix
(off-brand cleverness — the rest of the project uses neutral
language). Timestamp is local time, ISO-8601-compact, no separators
to keep the filename safe across OSes.

**Q5 — Regional-dex warning silenceability**: **No.** Fires per
species+destination pair, informational only, user has consistently
preferred full transparency over silent data behaviour.
