# PLAN.md — Sprint 6a: Gen 3 destination save (save-to-save inject)

## 1. Sprint contract

**Goal.** A user with a Gen 1/2 source save AND a Gen 3 (R/S/E/FR/LG, English)
destination save loads both in the browser, picks a converted Pokemon and an
empty PC box slot in the destination save, and downloads a modified Gen 3 .sav
that — when loaded in PKHeX or copied back to a real cart — contains the
converted mon at the chosen slot with all other save data byte-identical to the
input. The existing `.pk3` single-mon download path from S3a/S5 stays available
as a secondary action.

**Slicing decision: SPLIT into S6a (this sprint) + S6b (next sprint).**

S6a is save-to-save only (file in / file out, both sides). S6b adds the
GBxCart RW Web Serial adapter for cart read AND cart write — the user has the
hardware and intends to use it, but Web Serial brings a different risk profile
(USB permissions UX, firmware version skew, real-cart corruption modes) that
deserves its own loop. The source/destination interfaces in S6a (§4) are
designed so the S6b serial adapter slots in by implementing a `SaveSource` and
a `SaveSink` without changes to the reducer or the inject pipeline.

**In scope (S6a).**
- `core/src/sav/gen3/` reader: parse a 128 KB English Gen 3 .sav into a
  `Gen3SaveContents` (game variant, 14×30 PC boxes as `BoxedRecord[]`,
  trainer/security_key block exposed as opaque ranges).
- `core/src/sav/gen3/` writer: take a parsed `Gen3SaveContents` plus an
  inject request (boxIndex, slotIndex, 80-byte boxed record) and produce a
  modified 128 KB byte buffer with all touched-sector checksums recomputed.
- Game autodetect: distinguish R/S vs Emerald vs FR/LG by structural probe
  (game-code field + security-key XOR self-consistency check). Filename
  ignored.
- Empty-slot enforcement: `injectBoxed()` refuses to overwrite an
  occupied slot. UI greys out STORE on occupied slots.
- Web UI extension: a destination upload zone next to the existing source
  zone; once both saves are loaded, a destination box-picker overlay
  reusing the S5 box-browser primitives but parameterised for 14×30 grid
  and Gen 3 species art; STORE confirm dialog; "Download modified
  `<name>.sav`" trigger. The existing single-mon `.pk3` download path
  remains visible as an alternate action on the source side.
- Round-trip golden test: parse → no-op re-serialise yields byte-identical
  output; parse → inject → re-parse yields the modification at the
  expected slot with all other parsed fields equal.
- Bundle stays ≤ 200 KB gzipped.
- All 289 existing tests remain green.

**Out of scope (deferred to S6b or later).**
- GBxCart RW Web Serial source AND sink (S6b).
- International (JP/FR/DE/IT/ES) Gen 3 saves — English only.
- Battery-dead Gen 3 saves (fully `0xFF`-initialised sectors).
- "Pal Park" / Gen 4 transfer formatting (not relevant — destination is Gen 3).
- Editing trainer info / play time / e-Reader berry data / Mystery Gift slots.
- Bulk multi-mon inject in one shot (S6a injects one at a time; user can
  re-upload the modified .sav and inject again — boring but correct).
- Egg slots / party slot inject (PC boxes only).

**Done when.**
1. `bun install && bun test` is green: 289 existing + ≥ 24 new core tests +
   ≥ 6 new web tests, all passing.
2. `bun run typecheck && bun run lint && bun run format:check` exits 0.
3. `bun run --cwd web build` exits 0; gzipped JS < 200 KB (current 31.6 KB
   leaves ample headroom — budget below).
4. **Round-trip identity.** For each of 5 game-variant fixtures (R, S, E,
   FR, LG): `parseGen3Save(bytes)` succeeds; `serialiseGen3Save(parsed)`
   returns a buffer byte-equal to `bytes`.
5. **Inject round-trip.** For each of the 5 fixtures: pick an empty
   box+slot, build a known 80-byte `.pk3` from a Crystal Feraligatr
   conversion, call `injectBoxed`, re-parse the output, assert the box
   slot now contains a `BoxedRecord` whose 80 bytes equal the input
   `.pk3`; assert all other PC slots and the trainer-info sector are
   byte-identical to the original.
6. **Empty-slot enforcement.** Calling `injectBoxed` on an occupied slot
   returns `{ kind: 'inject_error', reason: 'SLOT_OCCUPIED', ... }`.
7. **PKHeX legality (manual, documented in EVAL).** Load each modified
   .sav in PKHeX, navigate to the injected slot, run "Verify Checksums"
   (PASS) and the legality checker on the injected mon (only the
   expected hatched-egg-from-FRLG flags fire — no "invalid checksum" or
   "save block corrupt").
8. **No regression on the existing path.** `.pk3` single-mon download
   from S5 still works on a fresh page load with only a source save.

---

## 2. Directory layout

Add the following. Do NOT touch existing S1/S2/S3a/S5 code except for the
two web files explicitly noted (`state.ts`, `ui.ts`).

```
core/src/
  sav/
    gen3/
      index.ts                # public API: parseGen3Save, serialiseGen3Save,
                              #   injectBoxed, Gen3SaveContents, Gen3Game,
                              #   InjectError, BoxedRecord
      detect.ts               # detectGen3Game(bytes) → Gen3Game | null
      sectorLayout.ts         # SECTOR_SIZE, SECTORS_PER_SLOT, slot offsets,
                              # per-game sector-id → semantic-block map
      slot.ts                 # findActiveSlot(bytes) → { slotIndex, saveIndex,
                              # sectorOrder } — handles save_index%14 rotation
      checksum.ts             # gen3SectorChecksum(sectorBody) — sum of u32 LE
                              # words, fold to u16
      pcBoxes.ts              # readPcBoxBlock(parsed) → BoxedRecord[][] (14×30),
                              # writePcBoxBlock(parsed, boxes) → updates
                              # touched sector buffers
      trainer.ts              # readTrainerInfo(parsed) → { ot, tid, sid,
                              # game_code, security_key } — read-only
      parser.ts               # parseGen3Save(bytes) → Gen3SaveContents | SaveError
      serialiser.ts           # serialiseGen3Save(parsed) → Uint8Array
      inject.ts               # injectBoxed(parsed, req) → Gen3SaveContents | InjectError
      boxedRecord.ts          # BoxedRecord type + helpers; thin wrapper around
                              # the existing 80-byte format from pack/boxed.ts.
                              # An empty slot is encoded as 80 × 0x00; a
                              # non-empty slot has species != 0 in the decrypted
                              # Growth substructure (we do NOT decrypt here; we
                              # use a cheap test: bytes 0..3 (PID) == 0 AND
                              # bytes 28..30 (checksum) == 0 → empty)
  types/
    sav3.ts                   # Gen3SaveContents, Gen3Game, InjectRequest,
                              # InjectError, BoxedSlot

tests/
  unit/
    gen3-detect.test.ts             # all 5 game variants + RB/Crystal saves
                                    # + truncated/zero buffer → null
    gen3-checksum.test.ts           # known-good sector vector
    gen3-slot-rotation.test.ts      # save_index 0..27 cycle, sector_order map
    gen3-pc-boxes.test.ts           # read 14×30 grid; assert empty-slot byte
                                    # invariant (all-zero); pick known
                                    # slot from a fresh-newgame fixture
    gen3-roundtrip.test.ts          # parse → serialise byte-equal (5 fixtures)
    gen3-inject.test.ts             # empty-slot inject; occupied-slot refusal;
                                    # checksum recompute on touched sectors
                                    # only; trainer sector untouched
    gen3-inject-feraligatr.test.ts  # end-to-end: parse Crystal save, convert
                                    # Feraligatr, packBoxed, injectBoxed into
                                    # Emerald fixture, re-parse, verify

web/src/
  state.ts                    # MODIFIED: extend `loaded` with optional dest
                              # save fields (additive, backwards-compatible)
  ui.ts                       # MODIFIED: render a second drop zone for dest;
                              # render the dest box browser overlay; STORE
                              # confirm flow; download modified .sav
  ui/
    destBoxBrowser.ts         # NEW: 14×30 Gen 3 box browser; reuses dialog +
                              # sprite primitives but with its own grid sizing
                              # and Gen 3 species art
    storeConfirm.ts           # NEW: STORE confirm dialog ("Store FERALIGATR
                              # in BOX 3 slot 12 of Pokemon Emerald.sav?
                              # [STORE] [CANCEL]"); greyed-out STORE if slot
                              # is occupied
  __tests__/
    state-dest.test.ts        # new reducer transitions
    destBoxBrowser.test.ts    # 14×30 render; cursor clamp; occupied/empty
                              # tile classes
```

Rationale: `core/src/sav/gen3/` mirrors `core/src/sav/gen1/` and `gen2/` so
the project's mental model stays uniform — "input adapter modules live under
`sav/`." The packer in `core/src/pack/` stays write-only for individual
mons; `gen3/inject.ts` is the new save-level orchestrator that consumes
`pack/`'s `BOXED_SIZE = 80` bytes verbatim. The web layer adds two new
small UI modules (~150 LoC each) and minimally extends `state.ts`/`ui.ts`
to host them. No existing test files are modified.

---

## 3. Gen 3 save format reference

Spec sources: PKHeX `SAV3.cs`, `SAV3RS.cs`, `SAV3E.cs`, `SAV3FRLG.cs`;
Bulbapedia "Save data structure (Generation III)".

### 3.1 File-level layout

A Gen 3 save image is **128 KB (131072 bytes)** total, structured as:

```
0x00000  ┬ Save Slot A : 0x0E000 bytes (14 sectors × 4096)
0x0E000  ┼ Save Slot B : 0x0E000 bytes (14 sectors × 4096)
0x1C000  ┼ Hall of Fame (2 × 4096)
0x1E000  ┼ Mystery Gift / e-Reader / Battle Tower scratch (2 × 4096)
0x20000  ┘ end (= 131072 bytes)
```

Each save slot is 14 sectors of exactly **4096 bytes**. The "live" save
slot is whichever has the **higher save_index** (with `0xFFFFFFFF` treated
as "uninitialised; the other slot wins"). Most games have written both
slots after a few minutes of play; we always read the active slot, write
back to the same active slot, and leave the inactive slot unchanged
(documented design choice — see §8 risk R3).

### 3.2 Sector layout

Each 4096-byte sector ends with a 12-byte footer:

```
offset  size  field
0x0000  3968  body (semantic data)
0x0F80  128   padding (in some sectors used; treat as part of body for
              checksum)
0x0FF4    2   sector_id (0..13)
0x0FF6    2   checksum  (u16, see §3.4)
0x0FF8    4   signature (0x08012025 — magic; identical across all sectors)
0x0FFC    4   save_index (u32; same value across all 14 sectors of a slot)
```

(PKHeX's `SAV3.cs` uses `SIZE_USED = 3968` for all sectors except
`sector_id == 0` where it uses `3884`; we will use 3968 across the board
on read/write because the unused-tail bytes are included in the
zero-extended checksum sum without changing the result. This matches
both PKHeX's behaviour and the original game code — verified during
spec-drafting against PKHeX `SaveUtil.cs`.)

### 3.3 Sector rotation

The 14 sectors of a slot are not stored in semantic-id order on disk.
Instead, sector with `sector_id == 0` is at file position
`(save_index % 14) * SECTOR_SIZE` within the slot, and the rest follow
modulo-14. So:

```
disk_position(slot, semantic_id) =
   slot_start + (((semantic_id - (save_index % 14) + 14) % 14) * SECTOR_SIZE)
```

Equivalently, walking sectors `0..13` of a slot in disk order yields
sector_ids `(save_index%14)..(save_index%14 + 13) mod 14`.

`slot.ts::findActiveSlot()` discovers the rotation by reading the
`sector_id` and `save_index` fields of each sector and building a map
`semantic_id → disk_offset` for the active slot. Writes use the same map
so the on-disk rotation is preserved unchanged across an inject.

### 3.4 Checksum

```
function sectorChecksum(body: Uint8Array): u16 {
  let sum = 0 as u32;
  for (let off = 0; off < 3968; off += 4) {
    sum = (sum + readU32LE(body, off)) >>> 0;
  }
  return ((sum & 0xFFFF) + (sum >>> 16)) & 0xFFFF;
}
```

Computed over the first 3968 bytes of the sector body (NOT the footer).
Folded high-half-into-low-half once — Bulbapedia §"Sector checksum".

### 3.5 Per-game semantic-block map

The 14 sector_ids map to game-specific semantic blocks:

| sector_id | R/S            | Emerald        | FR/LG          |
|-----------|----------------|----------------|----------------|
| 0         | TrainerInfo    | TrainerInfo    | TrainerInfo    |
| 1         | TeamItems      | TeamItems      | TeamItems      |
| 2         | GameState      | GameState      | GameState      |
| 3         | MiscData       | MiscData       | MiscData       |
| 4         | RivalInfo      | RivalInfo      | RivalInfo      |
| 5..13     | PCBuffer 0..8  | PCBuffer 0..8  | PCBuffer 0..8  |

The PC buffer spans **9 sectors** (5..13) and is logically a single
33744-byte blob. Sectors 5..12 contain 3968 bytes each of PC data
(the full sector body); sector 13 contains the **remaining 2000 bytes**
followed by 1968 bytes of zero-padding inside its 3968-byte body. (PKHeX
uses `SIZE_PCBOX = 33744` and treats the spillover deterministically.)

PCBuffer logical layout (Bulbapedia §"Pokemon Storage"):

```
offset  size      field
0x0000     4      currentBox (u32 LE; 0..13)
0x0004 33600     14 boxes × 30 slots × 80 bytes = 33600
0x8344    126     box names (14 × 9 bytes)
0x83C2     14     box wallpaper IDs (14 × 1 byte)
total  33744 bytes
```

Game discrimination: the only structural delta within sector 0
(TrainerInfo) that matters for detect is the `game_code` u32 at offset
`0x00AC` of the body:
- **0x00000000** → Ruby OR Sapphire (further distinguishable by EOS
  variant bytes elsewhere — but for inject we treat them identically as
  `RS`)
- **0x00000001** → FireRed OR LeafGreen (further distinguishable by
  e-Reader hash elsewhere — for inject treated as `FRLG`)
- **other (typically nonzero, derived from security_key)** → Emerald

Emerald additionally writes a **security_key** at sector 0 body offset
`0x00AC` (encrypted) and `0x01F4` (plaintext); the two should XOR to
`0xFFFFFFFF` if the slot is intact. R/S/FRLG do not have a security_key.

### 3.6 Ranges that the inject WRITES

For a single PC-slot inject:
- **Always**: the one or two PC-buffer sectors (sector_ids 5..13) whose
  body bytes overlap the 80-byte slot range. Most slots fit entirely in
  one sector (3968 / 80 = 49.6 mons per sector); slots near sector
  boundaries can span two adjacent sectors. The writer computes which
  by: `byteRangeStart = 4 + boxIndex*30*80 + slotIndex*80` and
  `byteRangeEnd = byteRangeStart + 80`, then maps both endpoints
  through the `pcBufferOffsetToSector` table.
- **Never**: sector 0 (TrainerInfo), sectors 1..4 (TeamItems / GameState
  / MiscData / RivalInfo), the inactive save slot, the Hall of Fame
  block, or the e-Reader/Mystery-Gift block. Document explicitly: play
  time, party, money, badges, OT name, security_key all untouched.

Each touched sector has its `checksum` field recomputed and its body
re-XORed at the same on-disk offset. The `sector_id`, `signature`, and
`save_index` fields stay identical on write (no rotation change, no
slot-A/B swap).

---

## 4. Source/destination interface design (forward-compatible with S6b)

Generalise S3a's `SaveSource` to support both reading source bytes AND
reading destination bytes AND eventually writing destination bytes. The
S3a `SaveSource` is unchanged; we add a dual sink interface:

```ts
// Existing (from S3a, unchanged):
export interface SaveSource {
  read(): Promise<Uint8Array>;
  readonly label: string;
}

// New in S6a (in core/src/types/sav3.ts):
export interface SaveSink {
  write(bytes: Uint8Array): Promise<void>;
  readonly label: string;
}

export class FileDownloadSink implements SaveSink {
  constructor(public readonly suggestedFilename: string) {}
  readonly label = 'Download .sav file';
  async write(bytes: Uint8Array): Promise<void> { /* trigger blob download */ }
}

// S6b will add:
//   class GbxCartSource implements SaveSource { ... }   // SRAM read via Web Serial
//   class GbxCartSink   implements SaveSink   { ... }   // SRAM write via Web Serial
```

The web controller treats source and sink as opaque ports. The S6a UI
constructs a `FileDownloadSink` for the destination side; S6b will swap
in a `GbxCartSink` selected via a "Read from cart / Write to cart" toggle
without changing the inject pipeline or the reducer.

The `injectBoxed` core function is sink-agnostic: it returns the modified
`Uint8Array` and the caller hands that to whichever `SaveSink` is wired.

This design also means **destination bytes are a `Uint8Array` produced by
ANY source** (file upload now, cart read later) — the parser and inject
never know or care.

---

## 5. Component decomposition

### 5.1 `core/src/types/sav3.ts`

```ts
export type Gen3Game = 'RUBY_SAPPHIRE' | 'EMERALD' | 'FIRERED_LEAFGREEN';

export interface Gen3SaveContents {
  readonly game: Gen3Game;
  readonly bytes: Uint8Array;       // FULL 128 KB; parser stores the original
                                    // and serialiser writes a modified clone
  readonly activeSlot: 0 | 1;       // which save slot is live
  readonly saveIndex: number;       // u32; for sector rotation
  readonly sectorOrder: ReadonlyArray<{
    readonly semanticId: number;    // 0..13
    readonly diskOffset: number;    // absolute byte offset in `bytes`
  }>;
  readonly trainer: {
    readonly otNameBytes: Uint8Array;  // 7 bytes (Gen 3 charmap)
    readonly tid: number;
    readonly sid: number;
    readonly gameCode: number;
    readonly playTimeFrames: number;   // for display only
  };
  readonly pcBoxes: ReadonlyArray<ReadonlyArray<BoxedSlot>>;
  // ^ exactly 14 boxes × 30 slots, every slot present (empty or filled)
  readonly currentBoxIndex: number;    // 0..13; the box the player last opened
  readonly boxNamesRaw: Uint8Array;    // 126 bytes; opaque to S6a
  readonly warnings: readonly string[];
}

export type BoxedSlot =
  | { readonly kind: 'empty' }
  | { readonly kind: 'filled'; readonly bytes: Uint8Array; /* 80 bytes */ };

export interface InjectRequest {
  readonly boxIndex: number;     // 0..13
  readonly slotIndex: number;    // 0..29
  readonly bytes: Uint8Array;    // 80; output of pack/boxed.ts::packBoxed
}

export type InjectErrorReason =
  | 'SLOT_OCCUPIED'
  | 'OUT_OF_RANGE'
  | 'BAD_PAYLOAD_SIZE';

export interface InjectError {
  readonly kind: 'inject_error';
  readonly reason: InjectErrorReason;
  readonly message: string;
}

export function isInjectError(x: Gen3SaveContents | InjectError): x is InjectError;
```

### 5.2 `core/src/sav/gen3/detect.ts`

```ts
export function detectGen3Game(bytes: Uint8Array): Gen3Game | null;
```

Algorithm:
1. Length check: must be exactly 131072 bytes (no emulator-trailer
   stripping for Gen 3 — the format is fixed-size and we don't have a
   compelling reason to widen the contract).
2. Find active slot via `findActiveSlot(bytes)`.
3. Read the TrainerInfo sector body (sector_id 0).
4. Read `gameCode = readU32LE(body, 0xAC)`.
5. If `gameCode === 0x00000000` → `RUBY_SAPPHIRE`.
   If `gameCode === 0x00000001` → `FIRERED_LEAFGREEN`.
   Else → `EMERALD` (Emerald derives gameCode from security_key, so it's
   always a non-trivial value; cross-check by reading `security_key`
   plaintext at sector 0 body offset `0x01F4` and verifying
   `(securityKey ^ encryptedAt0xAC) === 0xFFFFFFFF` if R/S/FRLG didn't
   match cleanly).
6. Return `null` on length mismatch, signature mismatch on every sector,
   or all-`0xFF` body (battery-dead save).

### 5.3 `core/src/sav/gen3/sectorLayout.ts`

Pure constants and small helpers, no I/O:

```ts
export const SECTOR_SIZE = 4096 as const;
export const SECTORS_PER_SLOT = 14 as const;
export const SLOT_A_OFFSET = 0x00000 as const;
export const SLOT_B_OFFSET = 0x0E000 as const;
export const SECTOR_BODY_SIZE = 3968 as const;
export const SECTOR_FOOTER_OFFSET = 0x0FF4 as const;
export const SECTOR_SIGNATURE = 0x08012025 as const;
export const PCBUFFER_FIRST_SECTOR = 5 as const;
export const PCBUFFER_LAST_SECTOR = 13 as const;
export const PCBUFFER_TOTAL_BYTES = 33744 as const;
export const PCBUFFER_BOX_COUNT = 14 as const;
export const PCBUFFER_SLOTS_PER_BOX = 30 as const;
export const PCBUFFER_SLOT_BYTES = 80 as const;
export const PCBUFFER_BOX_DATA_OFFSET = 4 as const;
// Helper:
export function pcBufferOffsetToSector(logicalOffset: number): {
  sectorSemanticId: number;
  inSectorOffset: number;
};
```

### 5.4 `core/src/sav/gen3/checksum.ts`

```ts
export function gen3SectorChecksum(sectorBody: Uint8Array): number;
```

Implements §3.4 verbatim. Tested against a hand-computed vector AND
against the round-trip identity (a fresh-parse-then-serialise must
recompute the same checksum the file already had).

### 5.5 `core/src/sav/gen3/slot.ts`

```ts
export interface ActiveSlot {
  readonly slotIndex: 0 | 1;
  readonly saveIndex: number;
  readonly sectorOrder: ReadonlyArray<{ semanticId: number; diskOffset: number }>;
  readonly checksumValid: boolean;
}
export function findActiveSlot(bytes: Uint8Array): ActiveSlot;
```

Walks both slots, reads sector 0's `save_index` from each, picks the
higher (treating `0xFFFFFFFF` as "uninitialised, prefer the other"), then
walks the 14 sectors of the active slot and builds the
`semanticId → diskOffset` map. Returns `checksumValid: false` if any
active-slot sector's stored checksum doesn't match recomputation; the
parser surfaces that as a warning, never as a fatal error (mirroring
S3a §A1).

### 5.6 `core/src/sav/gen3/pcBoxes.ts`

```ts
export function readPcBoxBlock(parsed: Gen3SaveContents): {
  pcBoxes: ReadonlyArray<ReadonlyArray<BoxedSlot>>;
  currentBoxIndex: number;
  boxNamesRaw: Uint8Array;
};
export function writePcBoxSlot(
  parsed: Gen3SaveContents,
  boxIndex: number,
  slotIndex: number,
  slotBytes: Uint8Array,
): {
  modifiedSaveBytes: Uint8Array;
  touchedSectorIds: ReadonlyArray<number>;
};
```

Reading: assemble the 33744-byte logical PC blob by concatenating sectors
5..13 (in semantic-id order, using `sectorOrder` to find each on disk),
slice into 14×30 slots of 80 bytes each, classify each slot as
`empty` (all 80 bytes zero) or `filled`.

Writing: compute the byte range `[start, end)` of the target slot inside
the logical PC blob, split it across the one or two sectors that range
overlaps (using `pcBufferOffsetToSector`), and copy 80 bytes from
`slotBytes` into the appropriate disk locations. Returns the modified
buffer and the list of `sector_ids` that need checksum recompute.

**Empty-slot detection.** A slot is "empty" iff all 80 bytes are zero.
This is the same convention PKHeX uses. (A slot whose PID is zero but
whose other bytes are non-zero would be an in-game corrupted record;
we don't try to detect those — `injectBoxed` simply checks all-zero.)

### 5.7 `core/src/sav/gen3/parser.ts`

```ts
export function parseGen3Save(bytes: Uint8Array): Gen3SaveContents | SaveError;
```

Pipeline:
1. Length check → `SaveError(TOO_SHORT)` or `SaveError(UNRECOGNIZED_FORMAT)`.
2. `detectGen3Game(bytes)` → `SaveError(UNRECOGNIZED_FORMAT)` on null.
3. `findActiveSlot(bytes)`. Push `'gen3_checksum_mismatch'` warning if
   any sector failed.
4. Read TrainerInfo (OT name, TID, SID, gameCode, playTimeFrames).
5. `readPcBoxBlock` → 14×30 grid + currentBoxIndex + boxNamesRaw.
6. Return `Gen3SaveContents` — `bytes` is a defensively-copied
   `Uint8Array.from(bytes)` (so the caller can mutate the original
   freely without invalidating the parsed view).

Reuses the existing `SaveError` type from `core/src/types/sav.ts` (no new
error type — Gen 3 errors share the union with Gen 1/2 errors).

### 5.8 `core/src/sav/gen3/serialiser.ts`

```ts
export function serialiseGen3Save(parsed: Gen3SaveContents): Uint8Array;
```

For S6a this is **the identity-when-untouched function**: returns
`Uint8Array.from(parsed.bytes)`. The actual mutation work happens in
`injectBoxed`, which returns a new `Gen3SaveContents` whose `bytes`
field already contains the mutated buffer with recomputed checksums.

This split keeps `parsed.bytes` as the single source of truth and avoids
maintaining a parallel "modified" representation; tests that assert
"parse → serialise byte-equal" become trivial.

### 5.9 `core/src/sav/gen3/inject.ts`

```ts
export function injectBoxed(
  parsed: Gen3SaveContents,
  req: InjectRequest,
): Gen3SaveContents | InjectError;
```

Algorithm:
1. Validate `req.bytes.length === 80`. Fail `BAD_PAYLOAD_SIZE` otherwise.
2. Validate `boxIndex ∈ [0, 14)` and `slotIndex ∈ [0, 30)`. Fail
   `OUT_OF_RANGE` otherwise.
3. Look up `parsed.pcBoxes[boxIndex][slotIndex]`. If `kind === 'filled'`,
   fail `SLOT_OCCUPIED` (S6a does not overwrite — see §1 done-when 6).
4. Call `writePcBoxSlot(parsed, boxIndex, slotIndex, req.bytes)` →
   `{ modifiedSaveBytes, touchedSectorIds }`.
5. For each touched sector id, recompute its checksum from the modified
   body and write it into the sector footer. (Sector_id, signature, and
   save_index are unchanged.)
6. Re-parse the modified buffer to produce the returned `Gen3SaveContents`
   (cheap — reuses `parseGen3Save`). This guarantees the returned object
   is internally consistent and exposes the inject's effect on
   `pcBoxes`.

The returned object's `bytes` field is the new 128 KB buffer ready for
the `SaveSink` to write.

### 5.10 `web/src/state.ts` (extension)

Additive change to the `loaded` variant. **Backwards compatible** — the
S5 box-browser code paths still work when `dest` is `undefined`.

```ts
import type { Gen3SaveContents, BoxedSlot } from '@pokeportal/core';

export interface DestState {
  readonly fileName: string;
  readonly save: Gen3SaveContents;
  readonly cursor: { row: number; col: number };  // 0..5, 0..4 (30/box)
  readonly boxIndex: number;                      // 0..13
  readonly storeRequest: { ref: MonRef; targetBox: number; targetSlot: number } | null;
}

export type AppState =
  | { kind: 'idle' }
  | { kind: 'parsing'; ... }                      // unchanged
  | { kind: 'parse_error'; ... }                  // unchanged
  | {
      kind: 'loaded';
      fileName: string;
      save: SaveContents;                         // source (Gen 1/2)
      results: ReadonlyMap<string, ConvertResult>;
      boxIndex: number;
      cursor: Cursor;
      openMon: MonRef | null;
      // NEW (all optional):
      destParsing?: { fileName: string; size: number };
      destParseError?: { fileName: string; error: SaveError };
      dest?: DestState;
      destDownloadAvailable?: { suggestedFilename: string; bytes: Uint8Array };
    };

export type Action =
  | ...                           // existing actions unchanged
  // NEW:
  | { type: 'dest_file_selected'; file: { name: string; size: number } }
  | { type: 'dest_file_parsed'; save: Gen3SaveContents; fileName: string }
  | { type: 'dest_file_failed'; error: SaveError; fileName: string }
  | { type: 'dest_cursor_move'; drow: -1 | 0 | 1; dcol: -1 | 0 | 1 }
  | { type: 'dest_box_change'; delta: -1 | 1 }
  | { type: 'store_open'; ref: MonRef; targetBox: number; targetSlot: number }
  | { type: 'store_cancel' }
  | { type: 'store_committed'; bytes: Uint8Array; suggestedFilename: string }
  | { type: 'dest_clear' };       // load a different destination .sav
```

The `store_committed` action stores the modified destination bytes on the
state so a fresh "Download" button can fire without re-running inject.
The reducer reuses the inject-result `Gen3SaveContents` returned by
`injectBoxed` to refresh `dest.save` so the box browser immediately
shows the slot as filled.

### 5.11 `web/src/ui/destBoxBrowser.ts`

A trimmed-down sibling to `boxBrowser.ts`. Differences:
- Grid is 6 cols × 5 rows = 30 slots per box (vs 4×5 = 20 source-side).
- Box title shows `◀ BOX 1 ▶` cycling through 1..14.
- Sprite art is the Gen 3 set (already vendored in
  `web/public/sprites/gen3/`); empty slots show a faint dot placeholder.
- Tile click dispatches `store_open` instead of `mon_open`.
- A tile gets `.is-occupied` when the underlying `BoxedSlot.kind === 'filled'`;
  STORE will be greyed out for occupied tiles in the confirm dialog
  (see §5.12). The browser itself does NOT block click — the user can
  still inspect occupied slots; it's the dialog that enforces the rule.
  (This is intentional: showing "this slot is full" by hover/tooltip is
  better UX than a dead-click area.)

Public surface:

```ts
export interface DestBoxBrowserProps { ... }
export function destBoxBrowser(props: DestBoxBrowserProps): HTMLElement;
export function destEntriesForBox(
  save: Gen3SaveContents, boxIndex: number,
): ReadonlyArray<{ slot: number; filled: boolean }>;
```

### 5.12 `web/src/ui/storeConfirm.ts`

Modal dialog using the existing `dialog()` primitive:

```
┌─────────────────────────────────────────────┐
│ STORE FERALIGATR                             │
│ in Pokemon Emerald.sav                       │
│ BOX 3, SLOT 12?                              │
│                                              │
│ [STORE]  [CANCEL]                            │
└─────────────────────────────────────────────┘
```

If the chosen slot is occupied: STORE is disabled and a red caption
reads `slot occupied — pick an empty one.` CANCEL closes the dialog.

STORE's click handler:
1. Resolve the source mon by `monRefKey(ref)`.
2. Pull the cached `result.bytes` from `state.results` (S5 cached it
   when the comparison overlay opened) — if missing, run
   `convert + packBoxed` synchronously.
3. Call `injectBoxed(state.dest!.save, { boxIndex, slotIndex, bytes })`.
4. On `InjectError(SLOT_OCCUPIED)` (race-condition guard), re-render
   with the dialog still open and the error caption shown.
5. On success, dispatch `store_committed` with the new bytes and a
   suggested filename: `${original-name-stripped}.modified.sav` (e.g.
   `pokemon-emerald.sav` → `pokemon-emerald.modified.sav`).

The download itself is a separate UI action (a button that appears in
the toolbar after `store_committed`) so the user can confirm the inject
visually in the box browser before committing the file.

### 5.13 `web/src/ui.ts` (modifications)

Two surgical additions:
1. In `renderLoaded`, render a second drop zone labelled `Drop a Gen 3
   destination save (.sav, 128 KB)` next to the existing source dialog.
   When `state.dest` is set, this drop zone collapses into a one-line
   summary `Destination: <name> (Pokemon Emerald)` with a `[Change]`
   button that dispatches `dest_clear`.
2. When `state.dest` is set, render the `destBoxBrowser` to the right of
   (or below, on narrow viewports) the existing source `boxBrowser`. The
   source-side comparison overlay (S5) keeps working unchanged; on its
   STORE button (which replaces the S5 download `.pk3` button when a
   destination is loaded — see below), open the storeConfirm dialog
   pre-filled with the cursor position from `state.dest.cursor`.

The S5 `.pk3` download remains visible: when the comparison overlay is
open, the action area shows two buttons:
- `[STORE in destination]` — only enabled when `state.dest` is set
  AND the dest-cursor sits on an empty slot.
- `[Download .pk3]` — always available (existing S5 behaviour).

This keeps the S5 single-mon export workflow untouched for users without
a destination save.

---

## 6. State machine extensions

The `loaded` discriminator is unchanged; only its payload is widened.
All new fields are optional. New transitions live entirely within
`loaded`:

```
                              loaded (no dest)
                                    │
                                    │  dest_file_selected
                                    ▼
                              loaded + destParsing
                                    │
                  ┌─────────────────┴─────────────────┐
                  │ dest_file_parsed                  │ dest_file_failed
                  ▼                                   ▼
          loaded + dest                       loaded + destParseError
              │                                       │
              │  store_open                           │  dest_clear
              ▼                                       ▼
          loaded + dest + dest.storeRequest     loaded (no dest)
              │
        ┌─────┴─────────────────────────┐
        │ store_committed               │ store_cancel  /  inject error
        ▼                               ▼
   loaded + dest (refreshed)       loaded + dest (storeRequest=null)
   + destDownloadAvailable
```

Important properties:
- The source-side state (boxIndex, cursor, openMon) is independent of
  the dest-side state. A user can browse source boxes while the dest
  picker is open; opening the comparison overlay doesn't clobber the
  dest cursor.
- Calling `dest_clear` after a `store_committed` discards both the
  parsed dest AND the pending download (the modified bytes go with the
  cleared dest — this is intentional; the user has explicitly asked to
  load a different destination, so the previous-destination download
  is no longer relevant).
- A `reset` clears everything (existing behaviour). Re-uploading the
  source clears the dest as well — they're a paired session.

---

## 7. Test plan

### 7.1 Golden fixtures

Five new binary fixtures, one per English Gen 3 game variant:

```
tests/fixtures/saves/gen3/
  ruby-fresh.sav                # 131072 bytes; new game, walked into route 101
  sapphire-fresh.sav            # ditto
  emerald-fresh.sav             # ditto
  firered-fresh.sav             # ditto
  leafgreen-fresh.sav           # ditto
```

**Acquisition.** A "fresh" save means: ROM booted, intro completed,
trainer named (e.g. `RED` for parity with the source side), first
encounter handled, save written. Empty PC except possibly the starter
in box 1 slot 0 if the player deposited it — for clean inject testing
we want at least one fully-empty box (Box 14 will be empty in any
fresh-game save; we use it as the inject target). Source for these
saves: the user owns all 5 carts and a GBxCart RW; they can produce the
saves directly. Failing that, the orchestrator generates them via
mGBA + the official ROMs the user already owns.

These fixtures should be added to `tests/fixtures/saves/gen3/` as the
plan requires; the EVAL must verify their presence (size 131072,
detectGen3Game returns the expected variant) before running the
inject tests.

**Note on fixture absence (escape valve).** If the user cannot produce
all 5 fixtures in time, the Generator MUST still ship the parser and
inject code unchanged, but tests that depend on missing fixtures get
`test.skip` with an explicit reason. The Plan Evaluator must rule on
whether < 5 fixtures shipping is acceptable for sprint PASS — see §8 R6.

### 7.2 Unit tests

| File | Coverage |
|---|---|
| `gen3-detect.test.ts` | All 5 fresh fixtures detect to expected `Gen3Game`; a Crystal `.sav` (existing fixture) returns `null`; a buffer of length 32768 returns `null`; a 128 KB buffer of all-`0xFF` returns `null` |
| `gen3-checksum.test.ts` | Hand-computed vector for a known sector body matches; checksum of a body of all zeros is 0; checksum of a body of all `0xFF` matches the precomputed reference |
| `gen3-slot-rotation.test.ts` | For each of 28 (saveIndex % 14) × 2 slot configurations, a synthesised slot with that rotation parses back to the correct semanticId → diskOffset map; an inactive slot with `0xFFFFFFFF` save_index is correctly skipped |
| `gen3-pc-boxes.test.ts` | All 5 fresh fixtures expose 14 boxes × 30 slots; at least one box is fully empty (all-empty `BoxedSlot[]`); read currentBoxIndex matches PKHeX's reading of the same fixture (manual verify, hardcoded expected value per fixture) |
| `gen3-roundtrip.test.ts` | For each fresh fixture: `parseGen3Save → serialiseGen3Save` returns bytes that are `Buffer.compare(original, output) === 0` |
| `gen3-inject.test.ts` | Empty-slot inject succeeds and returns updated `pcBoxes`; occupied-slot inject returns `InjectError(SLOT_OCCUPIED)`; injecting an 80-byte zero buffer is rejected as `BAD_PAYLOAD_SIZE` (zero-buffer is the empty-slot encoding, not a valid mon — refuse to make slots "fill themselves with empty"); injecting at boxIndex 14 returns `OUT_OF_RANGE`; touched-sector list contains exactly the sectors whose bodies overlap the slot range; the trainer-info sector body is byte-identical pre/post inject |
| `gen3-inject-feraligatr.test.ts` | Parse Crystal fixture → find Feraligatr → `convert` + `packBoxed` → `injectBoxed` into Emerald fixture box 14 slot 0 → re-parse output → assert `pcBoxes[13][0].kind === 'filled'`; assert the 80 bytes match the input `.pk3`; assert all other slots equal the original parse; assert the modified bytes pass `parseGen3Save` cleanly with no warnings |

### 7.3 Web tests (vitest jsdom)

| File | Coverage |
|---|---|
| `state-dest.test.ts` | `dest_file_parsed` populates `state.dest`; `dest_clear` removes it; `store_open` sets `dest.storeRequest`; `store_committed` updates `dest.save` (so the slot now shows filled) AND populates `destDownloadAvailable`; `reset` clears everything |
| `destBoxBrowser.test.ts` | 14×30 grid renders 30 tiles for the current box; cursor clamps to [0..5] × [0..4]; tiles whose underlying slot is filled have `.is-occupied`; tiles whose slot is empty have `.is-empty`; clicking an empty tile dispatches `store_open` with the right slot index |

### 7.4 Manual / EVAL-driven verification

Documented in EVAL with screenshots / step-by-step:
1. Drop `demo-crystal.sav` as source, drop `emerald-fresh.sav` as dest;
   click Feraligatr in the source comparison overlay; click STORE; pick
   Box 14 Slot 0; click STORE again in confirm; click Download; verify
   downloaded `.sav` is 131072 bytes.
2. Open the downloaded `.sav` in PKHeX, confirm checksum-verify passes
   (`Tools → Verify Checksums`), navigate to PC Box 14 slot 1, confirm
   the mon is present with species Feraligatr, OT name from the source
   save, hatched-from-egg-in-FRLG metadata, and (manually) only the
   expected legality flags from the conversion's deliberate choices
   (the ones documented in HANDOFF §4.6 / §4.8).
3. Same flow with `firered-fresh.sav` and `ruby-fresh.sav`.
4. Bundle-size gate: `bun run --cwd web build && gzip -c web/dist/assets/*.js | wc -c`
   < 204800.

### 7.5 No-regression gate

`bun test` must report at least the previous green count (289) plus the
new tests, with zero failures and no new skips beyond fixtures-missing
skips that the Plan Evaluator pre-approves.

---

## 8. Risks and open questions

### R1 — AMEND-S5-6: Gen 2 charmap split (forward-carried)

The existing tooltip in `boxBrowser.ts` already calls `decodeGen12`,
which has a small Crystal-specific charmap drift on bytes 0x90 and 0xF4.
S6a's destination picker doesn't surface SOURCE nicknames any
differently than S5 does — but the issue tracker says fix this before
the picker UI ships. **Recommendation: punt to a separate cleanup
sprint.** The destination picker shows DESTINATION nicknames (Gen 3
charmap, separate code path), and the source-side display drift is
already shipped in S5; doing the Gen 2 charmap split as a side-quest
inside S6a inflates the sprint surface. PLAN keeps S6a focused on the
Gen 3 inject path. **Plan Evaluator should rule.** Default if no
ruling: defer the charmap fix.

### R2 — Sector 0 (TrainerInfo) untouched on inject

Documented in §3.6 and tested in `gen3-inject.test.ts`. The trainer
sector contains play time, OT name, money, badges, security_key — all
must be byte-identical pre/post inject. The test asserts this directly
by comparing `parsed.bytes.slice(trainerSectorOffset, trainerSectorOffset + 4096)`
before and after inject.

### R3 — Inactive save slot left untouched

S6a only writes to the active slot. The inactive slot — which contains
the previous in-game save — is unchanged. This is the safe choice: if
the player loads the modified .sav in-game, the game writes the next
save to the previously-inactive slot (because save_index increments and
the rotation changes), and our injected mon survives because it's in
the now-inactive slot, which the game still reads as a valid backup.
The alternative (write to BOTH slots) requires understanding the
"backup save" semantics deeply; for S6a, single-slot write is correct
and matches PKHeX's behaviour. **Document in EVAL.** Plan Evaluator may
rule that we should also mirror the inject into the inactive slot for
robustness — flag for discussion.

### R4 — PC slot vs party slot

S6a injects PC box slots only. Injecting into party would require
recomputing party-list metadata (slot count, species list, party-only
fields like current HP) and is out of scope. The user's described use
case is "store mons in a Gen 3 box," which is exactly what we do.

### R5 — Empty-slot definition

We define empty as "all 80 bytes zero." This matches PKHeX. The
alternative (bytes[0..3] = PID = 0 AND bytes[28..30] = checksum = 0)
allows for partially-zeroed garbage to be detected as filled, which is
strictly safer. **Recommendation: stick with all-zero.** A real Gen 3
cart never produces a partially-zeroed slot; the all-zero check is
faster and matches every reference. Plan Evaluator may rule to use the
PID-and-checksum check instead.

### R6 — Fixture acquisition risk

We need 5 fresh-game Gen 3 saves. The user owns all 5 carts AND a
GBxCart, but generating fresh-game saves takes ~30 minutes per cart
(boot, intro, name trainer, first save). If the user isn't willing to
do that for S6a, the Generator can produce them via mGBA + the user's
existing ROMs. **Plan Evaluator should rule on the acceptable minimum
fixture set.** Default if no ruling: ship S6a with at least 2 fixtures
covering the variant pairs (Emerald + one of FRLG; the RS pair shares
detect-and-inject behaviour with Emerald minus security_key, so even
without an RS fixture the parser can be exercised).

### R7 — Box names (14 × 9 bytes = 126 bytes) opaque

S6a does NOT decode box names ("BOX 1", "BOX 2", or user-renamed
"COOLNESS"). The destination picker labels them `BOX 1..14` for now.
Decoding would require porting Gen 3 charmap (already needed by the
existing pack/boxed.ts, so the table exists in `core/src/data/`). Plan
Evaluator may force decoding to ship in S6a — if so, it adds ~30 LoC.
**Recommendation: decode them; the table is already vendored and the
UX win (`BOX 14` vs `LEGENDS` for someone who renamed their boxes) is
real.**

### R8 — Multi-mon inject in one shot

S6a injects one at a time. A user wanting to inject 12 mons into a
fresh save would need to download → re-upload → inject 12 times. This
is correct but tedious. **Recommendation: defer batch inject to a
follow-up.** The "all mons in one shot" UX requires a meaningful
selection model (which mons? which target slots? handle conflicts?)
and inflates S6a beyond its core deliverable.

### R9 — Bundle-size budget headroom

Current: 31.6 KB gzipped. New code estimate: ~150 LoC of new web code +
~600 LoC of new core code, of which ~400 LoC is reachable from web
(parser, inject, types). Conservative: +25 KB gzipped. New target:
~57 KB. Cap is 200 KB. Plenty of room. The Vite build's tree-shaking
already drops the Gen 3 code paths from the source-only flow if it can
prove `state.dest` is never set in the call graph — but we should NOT
rely on that; the test gate is on absolute size, not on lazy-loaded
chunk size.

### R10 — `dest.save.bytes` defensive copy

The parser stores `bytes: Uint8Array.from(input)` so the caller can
mutate the input freely. The reducer must NEVER mutate `dest.save.bytes`
either — `injectBoxed` returns a new `Gen3SaveContents` with a fresh
buffer. Plan Evaluator should sign off that the immutability discipline
holds across the inject path.

### R11 — Compatibility with Sprint 6b's GBxCart sink

The `SaveSink` interface (§4) is the freeze point. S6b will need to
add a `GbxCartSink implements SaveSink` and bury the GBxCart write
protocol behind it. If `SaveSink.write()` proves insufficient (e.g.
GBxCart needs progress callbacks or per-bank chunking), we'll widen the
interface in S6b without breaking S6a's `FileDownloadSink`. **Plan
Evaluator should sign off** that the interface as written is forward-
compatible enough.

### R12 — User cancels mid-flow

If the user opens the comparison overlay, clicks STORE in destination,
then closes the dialog without confirming, the state should return to
"loaded + dest, no storeRequest" — no partial state leaks. Tested by
`state-dest.test.ts::store_cancel restores prior state`.

---

## 9. Out of scope (do not let scope creep)

- GBxCart RW Web Serial (S6b).
- International (JP/FR/DE/IT/ES) Gen 3 saves.
- Battery-dead save recovery / sector-rebuild.
- Editing trainer info, party, money, badges, items.
- Egg slot / party slot inject.
- Multi-mon batch inject in one .sav write.
- e-Reader / Mystery Gift / Battle Tower data injection.
- Pokemon Box GBA / Pokemon Stadium 1-2-3 transfer formats.
- Save format conversion (R/S → Emerald, etc.).
- "Modify converted mon's nickname before inject" UI.
- Choosing which save slot to write to (always the active one).
- Renaming destination boxes from the UI.
- Telemetry / analytics (hard rule, never).

---
