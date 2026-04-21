# Sprint 2 Archive — pokeportal Gen 3 Wire-Format Packer

**Status**: PASS (archived 2026-04-21).
**Scope**: HANDOFF §4.17 + §7 (output format) — encryption, checksum, substructure shuffle, 80-byte boxed + 100-byte party records.
**Test outcome**: 183 pass / 1 permitted skip (Row-4 Alakazam stretch carried over from S1) across 27 test files. All 5 verification commands exit 0.

---

## Retrospective amendments (corrections + notes)

- **AMEND-S2-1**: HANDOFF §7 says boxed records are 80 bytes and party records are 64 bytes — actual Gen 3 wire format is **80 boxed / 100 party**. PLAN_EVAL Q1 confirmed the override; implementation uses 80/100. HANDOFF text is historical; archive documents the correction.
- **AMEND-S2-2** (forward-carried to S3): The PKHeX `personal_rs` data `core/src/data/raw/personal-gen3.json` contains canonical Gen 3 base stats. Several Gen 1 species (notably Alakazam SpD=85, Snorlax SpD=110) get rebalanced in Gen 6+ — modern dex sites publish those newer values. Tests pin the Gen 3 values, not modern ones. Worth flagging if a S3+ contributor copies "current" Bulbapedia data.
- **AMEND-S2-3** (one-off in demo): demo `scripts/demo-red-boxes.ts` originally inherited Gen 2 SpA base stats for Charizard (85), under-counting FATMAN`s Gen 3 stats by 48 points on SpA. Fixed inline by adding a `BASE_STATS_G3` overrides table containing only species where Gen 3 differs from Gen 1/2 (so far: Charizard SpA 85→109). Doesn`t affect production code.
- **PLAN_EVAL A8 satisfied**: `scripts/gen-pkhex-vector.ts` reimplements the packer from spec without importing production code; `tests/integration/gen3-pkhex-vector.test.ts` uses 5 fixtures and asserts byte-identical match against `packBoxed`.

---

# PLAN — (produced by Planner subagent)

# PLAN.md — Sprint 2: Gen 3 wire-format packer/unpacker

Status: draft — awaiting Plan Evaluator (PLAN_EVAL.md).

## 1. Sprint contract

**Goal.** Take the `Gen3Intermediate` produced by Sprint 1's `convert()` and
produce the on-cart Gen 3 Pokemon record in two byte shapes: the 80-byte
**boxed/storage** record and the 100-byte **party** record, both encrypted
and checksummed per the Bulbapedia "Pokemon data substructures (Generation
III)" spec. Also ship the inverse — `unpackBoxed(bytes)` — needed for
round-trip tests.

**In-scope.**
- Substructure layout for all four substructures (G / A / E / M).
- The 24-way `PID % 24` substructure shuffle.
- XOR encryption with key = `PID ^ OTfull` (where `OTfull = (SID<<16)|TID`).
- Additive u16 checksum over the 24 words of decrypted substructure data.
- 32-byte boxed header + 48-byte encrypted substructure block = 80 bytes.
- 20-byte party-tail (status, level, mail counter, current HP, max HP, 5 stats).
- `DecodeError` discriminated union + `unpackBoxed` inverse.
- Vitest test suite: round-trip, substructure ordering (all 24 orderings),
  encryption-key correctness, checksum correctness, stat-formula match for
  party tail, error paths, a handful of byte-exact PKHeX-generated vectors.

**Out-of-scope.** Gen 1/2 save parsing (S3), Gen 3 save injection (S4),
cart-level save checksums/save-bank rotation, UI/serial/GBxCart, forward
Gen 3→4→5 transfer.

**Done when.** `bun run typecheck && bun run lint && bun test` is green in
`core/` and `tests/`; §9 success criteria all PASS; public API surface in
`core/src/index.ts` extended with `packBoxed` / `packParty` / `unpackBoxed`
and `DecodeError`; `dist/index.d.ts` snapshot re-baselined.

---

## 2. Directory layout

Do NOT restructure Sprint 1 code. Add the following.

```
core/src/
  primitives/
    gen3Crypt.ts            # XOR encrypt/decrypt, key derivation, checksum
    gen3Shuffle.ts           # PID%24 → substructure order + inverse
    leBytes.ts               # readU16/U32/writeU16/U32 LE helpers (tiny)
  pack/
    substructG.ts            # Growth (species, item, exp, pp bonuses, friendship)
    substructA.ts            # Attacks (4 move ids + 4 current PP)
    substructE.ts            # EVs + contest condition
    substructM.ts            # Misc (pokerus, met loc, origins, IVs/egg/ability, ribbons)
    header.ts                # 32-byte boxed header read/write
    partyTail.ts             # 20-byte party-tail compute + write
    packBoxed.ts             # top-level packer (Gen3Intermediate → 80 bytes)
    packParty.ts             # top-level packer (Gen3Intermediate → 100 bytes)
    unpackBoxed.ts           # inverse of packBoxed (bytes → Gen3Intermediate | DecodeError)
    baseStats.ts             # Gen 3 base-stat lookup for party-tail stat formula
  types/
    pk3.ts                   # DecodeError type + BOXED_SIZE/PARTY_SIZE constants

tests/
  unit/
    gen3Shuffle.test.ts      # 24-permutation table + inverse
    gen3Crypt.test.ts        # XOR round-trip; checksum across decrypted block
    substructG.test.ts       # byte-exact layout, boundary values (exp=0, exp=MAX)
    substructA.test.ts       # byte-exact layout
    substructE.test.ts       # EV cap, contest zeros, byte layout
    substructM.test.ts       # IV/egg/ability bit packing, origins packing, ribbons
    partyTail.test.ts        # Gen 3 stat formula match (reuse tests/harness/gen3Stats.ts)
    header.test.ts           # byte-exact header round-trip
    unpack.test.ts           # all DecodeError cases; inverse == identity for fixtures
  integration/
    pack-roundtrip.test.ts   # convert(src) → packBoxed → unpackBoxed === intermediate
    pkhex-vectors.test.ts    # ≥3 byte-exact vectors (see §8)
    party-shape.test.ts      # party 100-byte record matches boxed first 80 exactly
  fixtures/
    pkhex/                   # committed binary PK3 vectors, 80 and/or 100 bytes each
      README.txt             # (not md — committed metadata only; acceptable)
```

Rationale: one-file-per-substructure keeps the 12-byte layouts auditable in
isolation; packers compose via the primitives. `baseStats.ts` lives under
`pack/` because it's only needed by the party-tail computation; do NOT move
the test harness copy — the production table must be independent and sized
to every breedable Gen 3 species (see §10 open question 4).

---

## 3. Public interfaces

Added to `core/src/index.ts`:

```ts
export { packBoxed } from './pack/packBoxed.js';
export { packParty } from './pack/packParty.js';
export { unpackBoxed } from './pack/unpackBoxed.js';
export type { DecodeError, DecodeErrorReason } from './types/pk3.js';
export { BOXED_SIZE, PARTY_SIZE, isDecodeError } from './types/pk3.js';
```

`core/src/types/pk3.ts`:

```ts
export const BOXED_SIZE = 80 as const;
export const PARTY_SIZE = 100 as const;

export type DecodeErrorReason =
  | 'BAD_LENGTH'              // input.byteLength !== 80
  | 'CHECKSUM_MISMATCH'       // computed checksum !== header checksum
  | 'SPECIES_OUT_OF_RANGE'    // species === 0 or > 0x18E (Gen 3 max 412 counting eggs)
  | 'BAD_SUBSTRUCT_ORDER'     // PID%24 lookup out of range (defensive; unreachable)
  | 'BAD_NICKNAME_BYTES'      // non-0xFF-terminated nickname that also contains 0xFF in-range
  | 'BAD_OTNAME_BYTES';       // same for OT name

export interface DecodeError {
  readonly kind: 'decode-error';
  readonly reason: DecodeErrorReason;
  readonly message: string;
  readonly offset?: number;   // byte offset where the problem was detected
}

export function isDecodeError(x: unknown): x is DecodeError;
```

Packers:

```ts
// 80 bytes, fully encrypted + checksummed, ready to drop into a box slot.
export function packBoxed(intermediate: Gen3Intermediate): Uint8Array;

// 100 bytes: first 80 = packBoxed output verbatim; last 20 = party-tail.
export function packParty(intermediate: Gen3Intermediate): Uint8Array;

// Inverse. NOT a lossless inverse for party-tail (stats are recomputed,
// not stored in Gen3Intermediate), so unpackParty is deferred to S3.
export function unpackBoxed(bytes: Uint8Array): Gen3Intermediate | DecodeError;
```

`packBoxed` and `packParty` always succeed for any `Gen3Intermediate` that
`convert()` produces — the S1 type is already constrained tightly enough
(readonly-literal `metLocation: 146`, tuple moves, etc.) that there's no
invalid input to worry about. No thrown exceptions on the success path.

`unpackBoxed` never throws — all failure returns a `DecodeError`.

---

## 4. Algorithm decomposition

### 4.1 XOR encryption key (`primitives/gen3Crypt.ts`)

Key = `PID ^ OTfull`, where `OTfull = ((SID & 0xFFFF) << 16) | (TID & 0xFFFF)`
as an unsigned 32-bit word. The 48-byte substructure block is 12 u32 LE
words; XOR the key against each word (no per-word rotation). This is
PKHeX `PKX.DecryptArray3` and Bulbapedia §Encryption.

Tricky bits:
- **Bitwise 32-bit arithmetic in JS produces signed int32**; always end
  with `>>> 0` when materialising the key to keep it unsigned for
  downstream equality checks.
- **Endianness is little-endian** for the u32 reads/writes, matching GBA.
- Encryption and decryption are the *same* operation — XOR is self-inverse.
  Expose one function `xorCrypt48(block: Uint8Array, key: number)` that
  mutates the block in place, used for both directions.

### 4.2 Substructure ordering (`primitives/gen3Shuffle.ts`)

Given the 4 plaintext substructures `G, A, E, M` (each 12 bytes), the wire
order in the 48-byte encrypted block depends on `PID % 24` — see the
literal table in §6. Implementation:

```ts
// PERMUTATION[pid % 24] = readonly [gSlot, aSlot, eSlot, mSlot]
// where each value ∈ {0,1,2,3} is the slot (0..3) that holds that
// substructure in the wire-order block.
export const PERMUTATION: ReadonlyArray<readonly [number, number, number, number]>;

// Inverse: INVERSE[pid%24][wireSlot] ∈ {'G','A','E','M'} — which substruct
// occupies wireSlot i.
export const INVERSE: ReadonlyArray<readonly ['G'|'A'|'E'|'M', 'G'|'A'|'E'|'M', 'G'|'A'|'E'|'M', 'G'|'A'|'E'|'M']>;
```

Tricky bits:
- **The table is load-bearing**: one wrong row scrambles every Pokemon
  with a matching `PID%24`. Transcribe from Bulbapedia *and* cross-check
  against PKHeX `PKX.cs` `blockPositionInvert` in a test before committing.
- **`PID % 24` in JS with a u32** — JS `%` on `2**32-1` gives a valid
  small positive int, but if anyone ever casts PID through a signed
  operator the sign bit can corrupt the mod. Compute as
  `(pid >>> 0) % 24`.
- Exported both directions to keep `unpackBoxed` symmetric and unit-testable.

### 4.3 Checksum (`primitives/gen3Crypt.ts`)

`checksum = (Σ u16[i] for i in 0..23) & 0xFFFF`, computed over the 48
bytes of **decrypted** substructure data (wire-ordered — checksum is
order-independent since addition is commutative, but the canonical
reference computes it post-order; we do the same).

Tricky bits:
- u16 addition with `& 0xFFFF` *per addition* is not required — the
  final mask suffices because JS numbers handle 20-bit sums exactly. Still,
  prefer the final mask for clarity.
- The checksum goes into the header at offset 28 (u16 LE). See §5.

### 4.4 Party-tail (`pack/partyTail.ts`)

20 bytes at offset 80..99 of a party record:

| Offset | Size | Field          | Source                                   |
|--------|------|----------------|------------------------------------------|
| 0      | u32  | status         | 0 (no status)                            |
| 4      | u8   | level          | `intermediate.level`                     |
| 5      | u8   | pokerus remaining (mail) | 0 — see below                  |
| 6      | u16  | currentHP      | = maxHP                                   |
| 8      | u16  | maxHP          | Gen 3 HP formula                         |
| 10     | u16  | atk            | Gen 3 stat formula                       |
| 12     | u16  | def            | "                                        |
| 14     | u16  | spe            | "                                        |
| 16     | u16  | spa            | "                                        |
| 18     | u16  | spd            | "                                        |

Stat formulas are the **exact** Gen 3 formula — reuse the S1 harness
`tests/harness/gen3Stats.ts` as the reference oracle, but the production
implementation must live under `core/src/pack/partyTail.ts` (do NOT
import test code into production). The S1 harness proves we already know
the formula — copy it verbatim and unit-test the production copy against
the harness.

Tricky bits:
- Byte offset 5 is often documented as "pokerus status" — it's actually
  the "mail remaining time" byte in party data, *unrelated* to the
  Pokerus byte in the Misc substructure. Write 0. (PKHeX calls this
  `CurrentFriendship` in some variants — read the PK3.cs definition to
  disambiguate; in vanilla R/S the byte is unused / 0.)
- Order in the party tail is atk/def/spe/spa/spd — **speed precedes
  special attack**, matching the in-game status screen order. Our
  `Gen3Intermediate.ivs` and `.evs` use order `hp/atk/def/spa/spd/spe`.
  Don't swap at the wrong layer.
- Nature multiplier is always 1.0× (all five S1 natures are neutral) —
  documented in `gen3Stats.ts`. S2's production stat fn does the same,
  but must still apply the formula correctly so that if a future sprint
  relaxes the nature constraint, stat computation stays right.

### 4.5 Boxed header (`pack/header.ts`)

The 32-byte header:

| Offset | Size | Field                   | Source                                  |
|--------|------|-------------------------|-----------------------------------------|
| 0      | u32  | PID                     | `intermediate.pid`                      |
| 4      | u16  | TID                     | `intermediate.tid`                      |
| 6      | u16  | SID                     | `intermediate.sid`                      |
| 8      | 10   | nickname (Gen 3 bytes)  | `intermediate.nickname` padded w/ 0xFF  |
| 18     | u8   | language                | `intermediate.language`                 |
| 19     | u8   | misc flags              | 0x02 = normal (see below)               |
| 20     | 7    | OT name (Gen 3 bytes)   | `intermediate.otName` padded w/ 0xFF    |
| 27     | u8   | markings                | 0                                       |
| 28     | u16  | checksum                | computed post-encryption                |
| 30     | u16  | unknown                 | 0 (PKHeX calls this `Sanity`; 0 is fine) |

Offset 19 "misc flags":
- bit 0 = is-bad-egg (0 for us)
- bit 1 = has-species (1 — set for normal Pokemon)
- bit 2 = use-egg-name (0 — not an egg)

So the byte = `0b00000010 = 0x02`.

Tricky bits:
- Nickname and OT-name are already 0xFF-terminated by S1 per §3.2; pad
  *trailing* bytes with 0xFF to fill the fixed 10/7-byte slot, do not
  truncate a full-length name.
- The S1 `Gen3Intermediate.nickname` is "0xFF-terminated, ≤10 chars
  payload" per the S1 PLAN §3.2 comment. It may be any length ≤11
  bytes (10 chars + terminator). The packer must handle both "already
  terminated at length N ≤ 10" and "exactly 10 chars no terminator" —
  cross-reference S1's `fields/strings.ts` to confirm which and document.

### 4.6 Full pack pipeline (`pack/packBoxed.ts`)

```
1. Build G, A, E, M plaintext (12 bytes each) → 48-byte `plain`.
2. Shuffle plain per PERMUTATION[pid % 24] → 48-byte `shuffled`.
3. Checksum = Σ u16(shuffled) & 0xFFFF.
4. key = (pid ^ ((sid << 16) | tid)) >>> 0
5. `encrypted` = xorCrypt48(shuffled, key)
6. Header bytes (0..31) with checksum at offset 28.
7. Concat: [header | encrypted] → 80 bytes.
```

Note: checksum is computed in wire-order post-shuffle but pre-encryption,
which is numerically identical to pre-shuffle since sum-of-u16s is
commutative. We pick post-shuffle to mirror PKHeX and make the test vector
comparison straightforward.

### 4.7 Unpack pipeline (`pack/unpackBoxed.ts`)

```
1. if bytes.byteLength !== 80 → DecodeError BAD_LENGTH
2. Read header u32 pid, u16 tid, u16 sid, nickname, OT name, etc.
3. key = (pid ^ ((sid << 16) | tid)) >>> 0
4. `decrypted` = xorCrypt48(bytes.slice(32,80), key)
5. Compute checksum; compare to header[28..30]
   → if mismatch, CHECKSUM_MISMATCH
6. Unshuffle per INVERSE[pid % 24] into G/A/E/M buffers.
7. Parse each substructure into the fields of Gen3Intermediate.
8. Species range check: 1..412 → else SPECIES_OUT_OF_RANGE.
9. Populate `_meta` with zero/empty placeholders — we can't recover
   S1 conversion metadata from packed bytes; document this.
```

Tricky bits:
- `_meta` is problematic for round-tripping. Strategy: `unpackBoxed`
  returns a `Gen3Intermediate` with `_meta` set to a canonical
  "decoded-from-bytes" sentinel:

  ```ts
  const DECODED_META: ConvertMetadata = {
    pidSearchIterations: -1,
    evScalingApplied: false,
    evRemainderDistributed: 0,
    zeroDvOverridesApplied: [],
    unownLetterConstrained: false,
    warnings: ['decoded-from-bytes: _meta reflects decode, not original convert()'],
  };
  ```

  Round-trip tests therefore compare the two intermediates **excluding
  `_meta`**. Document this in the test helper.
- Literal-typed fields (`metLocation: 146`, `metLevel: 5`, `metGame:
  'FireRed'`, `originGame: 'FireRed'`, `fatefulEncounter: false`,
  `isEgg: false`, `abilitySlot: 0`, `markings: 0`, `ribbons: []`,
  `contestStats: {all zero}`) are verified on decode — if the on-wire
  byte diverges, return a suitable DecodeError (new reason:
  `UNEXPECTED_LITERAL_FIELD`). Add this reason to the union (§3).

---

## 5. Substructure wire format

All fields **little-endian**. All offsets are within the 12-byte substructure.

### 5.1 G — Growth (12 bytes)

| Offset | Size | Field          | Notes                                   |
|--------|------|----------------|-----------------------------------------|
| 0      | u16  | species        | Gen 3 national dex (1..412)             |
| 2      | u16  | heldItem       | 0 = no item                             |
| 4      | u32  | experience     | Gen 3 EXP, same growth groups as Gen 2 |
| 8      | u8   | ppBonuses      | 2 bits per move × 4 moves = 8 bits     |
| 9      | u8   | friendship     | 0..255                                  |
| 10     | u16  | unknown / pad  | 0                                       |

PP Bonuses byte:
- bits [1:0] = move slot 0 (0..3 PP Ups)
- bits [3:2] = slot 1
- bits [5:4] = slot 2
- bits [7:6] = slot 3

Source: `intermediate.ppUps[i] & 0b11`, packed little-endian (slot 0 in
low bits).

### 5.2 A — Attacks (12 bytes)

| Offset | Size | Field        | Notes                           |
|--------|------|--------------|---------------------------------|
| 0      | u16  | move1        | Gen 3 move ID                   |
| 2      | u16  | move2        | "                               |
| 4      | u16  | move3        | "                               |
| 6      | u16  | move4        | "                               |
| 8      | u8   | pp1          | current PP, not max             |
| 9      | u8   | pp2          |                                 |
| 10     | u8   | pp3          |                                 |
| 11     | u8   | pp4          |                                 |

Source: `intermediate.moves[i]`, `intermediate.pp[i]`.

### 5.3 E — EVs & Contest Condition (12 bytes)

| Offset | Size | Field                     |
|--------|------|---------------------------|
| 0      | u8   | hpEV                      |
| 1      | u8   | atkEV                     |
| 2      | u8   | defEV                     |
| 3      | u8   | speEV                     |
| 4      | u8   | spaEV                     |
| 5      | u8   | spdEV                     |
| 6      | u8   | cool                      |
| 7      | u8   | beauty                    |
| 8      | u8   | cute                      |
| 9      | u8   | clever ("smart")          |
| 10     | u8   | tough                     |
| 11     | u8   | sheen                     |

Note the **EV ordering is H/A/D/Spe/SpA/SpD** (speed precedes special
attack), matching the Gen 3 party-tail stats order. Our
`Gen3Intermediate.evs` uses `hp/atk/def/spa/spd/spe`. The packer must
reorder — document and unit-test this.

S1 guarantees all contest stats are 0 (typed as literal zeros), so
offsets 6..11 are always zero bytes for S2 output.

### 5.4 M — Misc (12 bytes)

| Offset | Size | Field                      |
|--------|------|----------------------------|
| 0      | u8   | pokerus                    |
| 1      | u8   | metLocation                |
| 2      | u16  | originsInfo                |
| 4      | u32  | ivsEggAbility              |
| 8      | u32  | ribbonsAndObedience        |

**originsInfo** (u16 LE):
- bits [6:0]   = met-at level (0..127) — we set **5**
- bits [10:7]  = game of origin — **4 = FireRed** (3 = Ruby, 2 = Sapphire, 15 = Emerald, 5 = LeafGreen)
- bits [14:11] = ball caught in — we set **4 = Poké Ball** (the default /
  bred-egg-hatches-in-Poké-Ball convention)
- bit  [15]    = OT gender — `intermediate.otGender` (0 male / 1 female)

Open question (§10 item 3): ball ID. HANDOFF §7 does not specify. For a
bred egg hatched in FRLG the defensible default is Poké Ball (ID 4).

**ivsEggAbility** (u32 LE):
- bits [4:0]   = HP IV
- bits [9:5]   = Atk IV
- bits [14:10] = Def IV
- bits [19:15] = Spe IV          ← note speed order again
- bits [24:20] = SpA IV
- bits [29:25] = SpD IV
- bit  [30]    = isEgg — **0**
- bit  [31]    = hasHiddenAbility — **0** (S1 abilitySlot=0 always; S1
  §4.14 explicitly forbids hidden abilities)

Speed-before-special ordering again — same swap as EVs. One unified
helper `reorderHASDSpaSpd({hp,atk,def,spa,spd,spe}) → [hp,atk,def,spe,spa,spd]`.

**ribbonsAndObedience** (u32 LE):
- bits [2:0]   = cool ribbon rank (0..4) — 0
- bits [5:3]   = beauty ribbon rank — 0
- bits [8:6]   = cute ribbon rank — 0
- bits [11:9]  = smart ribbon rank — 0
- bits [14:12] = tough ribbon rank — 0
- bit  [15]    = Champion ribbon — 0
- bit  [16]    = Winning ribbon — 0
- bit  [17]    = Victory ribbon — 0
- bit  [18]    = Artist ribbon — 0
- bit  [19]    = Effort ribbon — 0
- bits [25:20] = 6 special ribbons (Marine/Land/Sky/Country/National/Earth) — 0
- bit  [26]    = World ribbon — 0
- bits [30:27] = 4 unused bits — 0
- bit  [31]    = obedience — **0** (our Pokemon is ≤L100 regular, no
  disobedience flag; PKHeX calls this "Fateful Encounter" in some
  sources but the bit is *obedience / met fateful* depending on
  documentation — use 0 and cross-check against PKHeX `PK3.FatefulEncounter`)

**Fateful encounter bit clarification.** Bulbapedia puts fateful
encounter at bit 31 of `ribbonsAndObedience`; PKHeX reads the same bit as
`FatefulEncounter`. Since `intermediate.fatefulEncounter === false`,
bit 31 = 0. This matches the "bred egg" cover story in HANDOFF §4.8.
Flagged in §10 so the Plan Evaluator confirms the bit semantics.

---

## 6. PID % 24 ordering table

Canonical table — transcribed from Bulbapedia and PKHeX `PKX.cs`. Each
row lists, in wire order (slot 0 → slot 3), which substructure occupies
that slot. `G` = Growth, `A` = Attacks, `E` = EVs, `M` = Misc.

| PID%24 | Order      | | PID%24 | Order      |
|--------|------------|-|--------|------------|
| 0      | G A E M    | | 12     | E G A M    |
| 1      | G A M E    | | 13     | E G M A    |
| 2      | G E A M    | | 14     | E A G M    |
| 3      | G E M A    | | 15     | E A M G    |
| 4      | G M A E    | | 16     | E M G A    |
| 5      | G M E A    | | 17     | E M A G    |
| 6      | A G E M    | | 18     | M G A E    |
| 7      | A G M E    | | 19     | M G E A    |
| 8      | A E G M    | | 20     | M A G E    |
| 9      | A E M G    | | 21     | M A E G    |
| 10     | A M G E    | | 22     | M E G A    |
| 11     | A M E G    | | 23     | M E A G    |

These are the 24 permutations of {G,A,E,M} in lexicographic order by the
four letters. (This is the PKHeX convention; cross-check: PKHeX
`PKX.blockPosition` and `blockPositionInvert`.)

Test: the Generator must write a unit test that, for each `PID%24` value
0..23, packs a fixture intermediate with distinguishable substructure
contents (e.g., G.species=0x0001, A.move1=0x0002, E.hpEV=0x03,
M.pokerus=0x04), decrypts and un-shuffles, and asserts the slot
contents match this table.

---

## 7. Party-tail population

Inputs: `intermediate.level`, `intermediate.ivs`, `intermediate.evs`,
`intermediate.nature` (always neutral → 1.0× multiplier),
`intermediate.species` → base-stats lookup.

Base stats come from `core/src/pack/baseStats.ts` — a new file, indexed
by Gen 3 dex ID, covering *all breedable Gen 3 species*. Source: PKHeX
`personal_rs.bin`. Transcription strategy: hand-transcribe from
Bulbapedia for the ~250 species we care about (same approach as S1's
`personalInfo.ts`), cross-check a random 10% against PKHeX binary.

Formula (identical to `tests/harness/gen3Stats.ts`):

```
HP:     floor(((2*base + iv + floor(ev/4)) * level) / 100) + level + 10
Other:  floor((floor(((2*base + iv + floor(ev/4)) * level) / 100) + 5) * 1.0)
```

The production implementation lives at
`core/src/pack/partyTail.ts#computeStats`. The party-tail test
(`tests/unit/partyTail.test.ts`) imports both the production and the
test harness and asserts equality across a matrix of (species, level,
ivs, evs) fixtures — regression insurance that the two implementations
stay in lockstep.

Output: write status/level/mail/HP×2/stats×5 LE per §4.4 into the last
20 bytes of the 100-byte buffer.

---

## 8. Test matrix

### Unit tests

1. **`gen3Shuffle.test.ts`**
   - (a) `PERMUTATION.length === 24`; each row is a permutation of
     `[0,1,2,3]`; all 24 rows distinct.
   - (b) `INVERSE[k][PERMUTATION[k][i]] === tagOf(i)` (invertibility).
   - (c) Byte-exact assertion: for each `k`, shuffling
     `[0xAA, 0xBB, 0xCC, 0xDD]` (1-byte-per-slot abstraction) yields the
     §6 table ordering.

2. **`gen3Crypt.test.ts`**
   - (a) `xorCrypt48(xorCrypt48(x, k), k) === x` for 10 random 48-byte
     buffers and 10 random keys (self-inverse).
   - (b) Key from known PID/TID/SID triple matches a hand-computed
     reference value.
   - (c) Checksum of a known 48-byte block matches a hand-computed value.

3. **`substructG.test.ts`** / **`substructA.test.ts`** /
   **`substructE.test.ts`** / **`substructM.test.ts`** — per-substruct
   byte-exact round-trip (pack → unpack) for ≥5 fixtures each, covering
   boundary values (0, max) and random-middle cases. For M: IV bit-pack
   correctness across all 6 stats at IV=0, 1, 31.

4. **`partyTail.test.ts`**
   - (a) Production `computeStats` matches `tests/harness/gen3Stats.ts`
     across fixtures spanning the S1 stat-preservation table (Pikachu
     L25, Feraligatr L55, Charizard L100, Snorlax L100).
   - (b) HP formula rounding: fixture where `floor(ev/4)` boundary matters.
   - (c) Byte-exact tail write for one complete fixture.

5. **`header.test.ts`** — byte-exact header round-trip, with nickname /
   OT-name padding verified (trailing 0xFF fill).

6. **`unpack.test.ts`** — one test per `DecodeError` reason:
   - BAD_LENGTH: 79 bytes, 81 bytes, 0 bytes.
   - CHECKSUM_MISMATCH: tamper one byte of encrypted block.
   - SPECIES_OUT_OF_RANGE: species = 0 and species = 500.
   - UNEXPECTED_LITERAL_FIELD: isEgg bit set, or abilitySlot = 1.

### Integration tests

7. **`pack-roundtrip.test.ts`**: take 5 S1 `convert()` outputs (Snorlax,
   Pikachu, Charizard, Feraligatr, Unown-A fixtures — all already in
   `tests/fixtures` from S1); `packBoxed` → `unpackBoxed` → deep-equal
   excluding `_meta`. Also byte-for-byte stability: `packBoxed(x) ===
   packBoxed(x)` (packer is deterministic).

8. **`pkhex-vectors.test.ts`**: ≥3 byte-exact test vectors generated by
   PKHeX. Generation approach for the Generator: write a one-off
   script at `scripts/gen-pkhex-vectors.ts` that (a) builds a known
   `Gen3Intermediate` in-code, (b) writes the resulting bytes to
   `tests/fixtures/pkhex/*.bin`, (c) the vectors are then also exported
   as a PK3 by running PKHeX manually and saving the same bytes under
   the same filename. If PKHeX output diverges, the test fails. See §10
   open question 5 — we may substitute this with a pure-textual "known
   correct hex string committed to the test" approach if generating
   PKHeX output out-of-band is infeasible in CI.

9. **`party-shape.test.ts`**: `packParty(x).slice(0, 80) === packBoxed(x)`
   exactly, and the last 20 bytes are the party tail. Plus party-tail
   HP bytes equal `computeStats(x).hp` in LE u16.

### Reused S1 harnesses / fixtures

- `tests/harness/gen3Stats.ts` — oracle for party-tail.
- `tests/fixtures/` — S1 seed fixtures (Snorlax etc.) are the input
  `Gen12Pokemon` — run through `convert()` to get the intermediate,
  then feed into S2 packers.

---

## 9. Success criteria

Each is independently verifiable by the Code Evaluator.

1. `bun install && bun test` exits 0 across `core/` + `tests/`.
2. `bun run typecheck` exits 0 under `strict: true`.
3. `bun run lint` exits 0 (`--max-warnings 0`); `bun run format:check` exits 0.
4. `core/src/index.ts` adds exports `packBoxed`, `packParty`,
   `unpackBoxed`, `BOXED_SIZE`, `PARTY_SIZE`, `isDecodeError`, and types
   `DecodeError`, `DecodeErrorReason`. Snapshot of `dist/index.d.ts`
   updated and committed.
5. `packBoxed(x).byteLength === 80` for every S1 fixture after
   `convert()`. `packParty(x).byteLength === 100`.
6. `packParty(x).slice(0, 80)` exactly equals `packBoxed(x)` for every
   fixture.
7. Round-trip: `unpackBoxed(packBoxed(x))` deep-equals `x` (excluding
   `_meta`) for every fixture. No `DecodeError` returned on any
   `convert()` output.
8. Checksum validation: decoding a 1-bit-tampered byte of the encrypted
   block yields `CHECKSUM_MISMATCH`.
9. Substructure ordering: a parametric test iterates `pid%24 ∈ [0..23]`
   and asserts packed wire order matches the §6 table.
10. Party-tail stats match `gen3Stats(...)` for all fixtures in the S1
    stat-preservation test matrix.
11. ≥ 3 byte-exact PKHeX test vectors pass (§10 open question 5 may
    soften this to 1).
12. `core/package.json` dependencies still `{}` (no new runtime deps).
13. Encryption correctness: decrypting the block of any packed output
    with `key = pid ^ otFull` yields a sum of u16s equal to the header
    checksum.
14. All `DecodeError` reasons have at least one negative test.

---

## 10. Open questions for the Plan Evaluator

1. **HANDOFF §7 size error.** HANDOFF §7 says "Gen 3 64-byte (party) or
   80-byte (full) format." This is inverted/wrong — the boxed (storage)
   record is 80 bytes and the party record is 100 bytes (boxed + 20-byte
   party tail). See Bulbapedia §Structure and PKHeX `PKX.SIZE_3STORED`
   (80) / `PKX.SIZE_3PARTY` (100). **Recommendation: override HANDOFF to
   80 boxed / 100 party.** Plan Evaluator: confirm and note in
   `PLAN_EVAL.md` so the Generator and Code Evaluator both use the
   correct sizes. Do not amend HANDOFF.md without the user's sign-off.

2. **`unpackBoxed` in S2 vs S3.** It's not a user-visible deliverable
   per the HANDOFF, but we need *some* inverse for round-trip testing.
   Options: (a) ship `unpackBoxed` as a real public API in S2 (this
   plan's position), (b) build a test-only decoder. (a) costs a bit
   more code but gives us a defensible public API for Gen 3 save
   introspection in S4. **Recommendation: ship (a).**

3. **Default ball ID.** HANDOFF does not specify a ball for bred-egg
   hatched-in-FRLG. We pick Poké Ball (ID 4). The alternative is
   Premier Ball / Luxury Ball for cosmetic variety, but those have
   different legality footprints. **Recommendation: Poké Ball, ID 4.**

4. **Production base-stats table.** S1 only stored
   `{genderRatio, baseFriendship, ability0}` per species because the
   conversion core didn't need stats. S2 needs a full base-stats table
   for party-tail computation. Option A: extend the existing
   `PersonalInfo` interface with `base: {hp,atk,def,spa,spd,spe}` and
   re-transcribe. Option B: new separate `baseStats.ts` table. Option A
   is DRY; Option B keeps S2 changes isolated.
   **Recommendation: Option A — extend `PersonalInfo`. Transcription
   effort is the same and S1's personal-info-spot-check test extends
   naturally.**

5. **PKHeX byte-exact test vectors.** Generating these requires running
   PKHeX out-of-band (Windows app, GUI) and committing the resulting
   binary. If that's infeasible, fall back to committing the exact
   hex-string bytes our own packer produces for a canonical fixture
   and *separately* validating one of those by manual PKHeX round-trip
   at evaluator review time. **Recommendation: one PKHeX-validated
   vector for a Bulbasaur-at-L5-fresh-egg fixture, two self-consistency
   vectors pinned to our own output.** If CI can't reasonably generate
   PKHeX output, this is the right tradeoff.

6. **Party-tail nature multiplier correctness for future sprints.**
   Stat formula currently assumes neutral nature (1.0×) because S1 only
   picks neutral. Must we implement full nature-multiplier tables now?
   **Recommendation: implement the exact Gen 3 rounding rule
   (`floor(stat * multiplier)`) but keep the multiplier table a
   one-row table `[1.0]` at index 0 with a TODO for future sprints.
   Keeps the rounding path proved out.**

7. **`_meta` on decode.** The S1 `Gen3Intermediate._meta` cannot be
   reconstructed from the packed bytes. We return a sentinel `_meta`
   with `warnings: ['decoded-from-bytes']`. Round-trip tests exclude
   `_meta` from comparison. **Recommendation: ship as specified.**

8. **Obedience bit vs fateful-encounter bit.** Sources disagree on what
   bit 31 of `ribbonsAndObedience` means. PKHeX reads it as
   `FatefulEncounter`. Bulbapedia calls it "obedience" in some
   versions, "fateful encounter" in others. Our value is 0 either way
   (HANDOFF §4.8 — `fatefulEncounter: false`; per §4.17 HOME won't
   flag a bred-egg mon for obedience). **Recommendation: name the field
   `fatefulEncounter` in our packer for consistency with S1's
   `intermediate.fatefulEncounter`.**

9. **`sanity` bytes at header offset 30..31.** PKHeX calls this field
   "Sanity" but treats it as 0 for normal Pokemon. We write 0, and on
   decode we *don't* currently error if it's nonzero. Should we
   tolerate or reject nonzero? **Recommendation: tolerate — write 0,
   read anything. Future save-inspection use case may need to read
   real-cart data where sanity bytes vary.**

10. **Unown form in PID.** Unown's letter form is encoded in PID bits
    0-1 of each byte (per HANDOFF §4.6) — this is not a substructure
    field, it's already baked into the PID by S1. S2 has *nothing* to
    do for Unown besides packing normally. Confirm.

---

## 11. Out of scope for S2

Explicit deferrals:

- Gen 1/2 save-file parsing and `Gen12Pokemon` construction from raw
  save bytes (S3).
- Gen 3 save-file structure: box slot layout, trainer block, save
  sector A/B rotation, save-sector checksums, box names, party layout,
  full-save-file checksums (S4).
- Injection into a physical Gen 3 cart (S4/hardware sprint).
- Gen 3 → 4+ forward transfer (out of project scope per HANDOFF §1).
- Web UI, Web Serial, GBxCart RW driver (S5+).
- Non-neutral-nature stat multipliers (future sprint, if the
  conversion core ever relaxes the neutral-nature rule — won't happen
  per HANDOFF §4.4).
- `unpackParty` (deferred to S3 when we actually need to read
  party-format records off a cart).
- Hall-of-fame / e-reader / Mystery Event variants of the Gen 3 format.


---

# PLAN_EVAL — (produced by Plan Evaluator subagent)

# PLAN_EVAL — Sprint 2

## Verdict

**APPROVE_WITH_AMENDMENTS.**

The plan is substantively correct on the three hardest surfaces: the PID%24 permutation table (§6) matches PKHeX `PKX.blockPosition`/`blockPositionInvert` row-for-row in my independent derivation, the XOR encryption key formula and checksum mechanics (§4.1, §4.3) are right, and the party-tail byte layout (§4.4) is right — the prompt's own sanity-check layout for party tail (u8 status at offset 80) was itself wrong; the plan's `u32 status @ 0..3 / u8 level @ 4 / u8 mail @ 5 / u16×2 HP @ 6,8 / u16×5 stats @ 10,12,14,16,18` matches PKHeX `PK3.cs` exactly. However, there are **six concrete bugs or near-bugs** that will silently corrupt output if the Generator copies PLAN verbatim: (a) `DecodeErrorReason` type (§3) omits `UNEXPECTED_LITERAL_FIELD` which PLAN §4.7 then references — generator won't compile; (b) `ivsEggAbility` bit 31 is mis-labeled "hasHiddenAbility" (§5.4) — there is no hidden-ability concept in Gen 3 at all; this is the **ability slot** bit (0 or 1, chooses Ability1 vs Ability2); (c) `ribbonsAndObedience` bit 31 is waffled between "obedience" and "fatefulEncounter" (§5.4, §10.8) — per Bulbapedia it is *obedience* (Mew/Deoxys); PKHeX aliases it to `FatefulEncounter` for cross-gen API uniformity but the Gen 3 semantics are obedience, always 0 for us; the PLAN must pick a name and document; (d) PLAN §5.4 ribbonsAndObedience bit layout has internal arithmetic errors (bits 20..25 is 6 bits = 6 special ribbons ✓, bit 26 = World ribbon ✓, but bits 27..30 = 4 unused ✓ — actually this one checks out; however PLAN fails to enumerate the 7 "memorial/contest" bits `Cool Super`/`Beauty Super`/etc. explicitly — for our purposes they're all 0 so functionally fine, but the audit below pins the full bit map); (e) §8 test #7 (round-trip) and §9 criterion 7 say "deep-equals x excluding `_meta`" without pinning a test helper — need to bind the exact comparator or the test will silently skip bugs in `_meta`-adjacent fields (`ribbons`, `contestStats`); (f) test-vector strategy (§10 Q5) of "1 PKHeX-verified + 2 self-consistent" is circular insurance — the self-consistent vectors prove nothing. Amendment A8 mandates an **independent reimplementation in a Python/TS harness** as the test oracle.

Fix the amendments below and the Generator can proceed. No structural rewrite needed.

---

## Amendments (binding on the Generator)

The Generator reads PLAN.md plus this section. Where they conflict, this document wins. PLAN.md is **not** modified.

### A1. Add `UNEXPECTED_LITERAL_FIELD` to `DecodeErrorReason`

PLAN §3 defines six reasons. PLAN §4.7 step 9 then references a seventh,
`UNEXPECTED_LITERAL_FIELD`, which the Generator will emit when an on-wire
byte for a literally-typed `Gen3Intermediate` field (e.g. `isEgg`,
`abilitySlot`, `metLocation`, `fatefulEncounter`) disagrees with the S1
type-literal. **Add it to the union now** in `core/src/types/pk3.ts`:

```ts
export type DecodeErrorReason =
  | 'BAD_LENGTH'
  | 'CHECKSUM_MISMATCH'
  | 'SPECIES_OUT_OF_RANGE'
  | 'BAD_SUBSTRUCT_ORDER'
  | 'BAD_NICKNAME_BYTES'
  | 'BAD_OTNAME_BYTES'
  | 'UNEXPECTED_LITERAL_FIELD';
```

Add one negative test per reason (PLAN §8 unit test 6 already plans for
five; add the seventh).

### A2. Fix `ivsEggAbility` bit 31 naming: it is `abilityBit`, NOT `hasHiddenAbility`

PLAN §5.4 calls bit 31 of `ivsEggAbility` "hasHiddenAbility." **Wrong.**
Gen 3 has no hidden-ability concept — that was introduced in Gen 5. In
Gen 3 this bit selects between the species' Ability 1 (bit=0) and
Ability 2 (bit=1). PKHeX `PK3.cs` names it `AbilityBit` / the property
is derived as `AbilityNumber = 1 + (IV32 >> 31)`. See also Bulbapedia
"Pokemon data substructures (Generation III)" §Misc.

Correct naming in `substructM.ts`:

```ts
// bits 0..29: IVs (as PLAN)
// bit 30: isEgg (as PLAN)
// bit 31: abilityBit — 0 selects Ability 1 (slot 0), 1 selects Ability 2 (slot 1).
//         S1 `abilitySlot: 0` → this bit MUST be 0.
```

The written value (0) is unchanged, but the name must be correct —
otherwise a future reader will "fix" it based on the wrong mental model.

### A3. Resolve bit 31 of `ribbonsAndObedience`: **obedience**, with PKHeX alias documented

PLAN §5.4 and §10.8 waffle between `obedience` and `fatefulEncounter`
for bit 31 of the ribbons word. Resolve as follows. Per Bulbapedia
"Pokemon data substructures (Generation III)" §Ribbons and Obedience,
the bit is **obedience** in Gen 3 semantics (controls disobedience for
Mew/Deoxys when traded across generations). PKHeX's `PK3.cs` exposes it
as `FatefulEncounter` purely for cross-gen API uniformity (Gen 4+ has a
real fateful-encounter bit elsewhere).

Binding decision:

- In our code, name the field `obedience` in `substructM.ts` comments
  and local variable names — that's the Gen 3 semantic.
- The packer reads `intermediate.fatefulEncounter` (S1 literal `false`)
  and writes it into this bit. Keep the S1 interface unchanged —
  renaming `fatefulEncounter` in `Gen3Intermediate` would break S1's
  typed literal.
- Document the alias in a 3-line comment:

  ```ts
  // Gen 3 semantic: obedience bit (disobedience flag for Mew/Deoxys
  // when traded forward). PKHeX aliases this to `FatefulEncounter` for
  // cross-gen API uniformity, and S1's Gen3Intermediate follows that
  // naming. Our bred-egg cover story implies obedience=0 always.
  ```

- **S1's `fatefulEncounter: false` literal stays intact.** Do not
  rename the S1 field.

### A4. Use independent test oracle for byte-exact vectors (not PKHeX round-trip)

PLAN §10 Q5 proposes "one PKHeX-verified vector + two self-consistent."
Two self-consistent vectors against our own production packer prove
nothing — a packer with a systematic bug (swapped endianness, wrong
PID%24 row, ribbon bit off by one) will produce output its own decoder
accepts. The PKHeX vector is the only genuine oracle there, and
generating PKHeX output inside CI is not really feasible (Windows GUI).

Binding approach:

1. Write a second, deliberately-independent reference packer at
   `tests/harness/gen3Pack.ts` (pure TS, may copy PKHeX C# logic
   line-by-line, NOT the production packer). Keep it under
   `tests/harness/` so it is explicitly non-production and is exempt
   from the "no runtime deps" criterion.
2. `tests/integration/oracle-vectors.test.ts` packs 5 fixtures with
   both the production packer and the harness packer and asserts
   byte-for-byte equality.
3. *In addition*, commit at least **one** binary fixture generated
   out-of-band by PKHeX (or by a community tool like pk3-edit /
   pkhex-core headless) under `tests/fixtures/pkhex/bulbasaur-l5.bin`
   and assert byte-equality against that. This gate catches bugs that
   are replicated in both the production and harness packers (shared
   misunderstanding of the spec).

Call the "harness packer" explicitly "Oracle B" in test output so a
failure is diagnosable at a glance. One PKHeX binary vector + one
independent-implementation oracle is the minimum to call the packer
verified.

### A5. Pin `unpackBoxed` round-trip comparator

PLAN §8 unit test 7 and §9 criterion 7 both say "deep-equals x excluding
`_meta`" but don't specify the comparator or what "excluding" means for
readonly-tuple fields. Bind the helper at
`tests/integration/helpers/intermediateEquals.ts`:

```ts
export function intermediateDeepEqualExceptMeta(
  a: Gen3Intermediate,
  b: Gen3Intermediate,
): true | { path: string; a: unknown; b: unknown } {
  // Compare every field listed in target.ts. For `_meta`, assert only
  // that b._meta.warnings.includes('decoded-from-bytes:...'). Everything
  // else (nickname bytes, moves tuple, ivs object, evs object, ribbons
  // empty tuple, contestStats object with all-zero literals, metLocation
  // literal 146, etc.) compared with structural equality — Uint8Array
  // via byte-by-byte.
}
```

Without this, a regression where (say) `contestStats.sheen` decodes to
`5` instead of `0` silently passes because the test uses Node's shallow
deep-equal on nested readonly types.

### A6. Checksum computed on **decrypted** block, **post-shuffle**, explicitly

PLAN §4.3 says "over the 48 bytes of decrypted substructure data
(wire-ordered)" and notes the order-independence of `Σ u16`. Pin one
canonical sequence in `packBoxed.ts` so the Generator does not
accidentally checksum over the encrypted bytes:

```
1. build G, A, E, M plaintext (each 12 bytes, LE)
2. wire = shuffle(G, A, E, M, pid % 24)  // 48 bytes
3. checksum = sumU16LE(wire) & 0xFFFF    // <-- BEFORE encryption
4. encrypted = xorCrypt48(wire, key)
5. header[28..30] = u16LE(checksum)
6. output = header || encrypted
```

Addition order does not matter mathematically, but PKHeX canonicalises
this sequence and Oracle B (A4) must match it byte-for-byte including
the order of operations. Also: add an assertion test that verifies
`sumU16LE(decrypted) === readU16LE(header, 28)` for every packed
fixture — catches both checksum bugs and XOR-key bugs in one shot
(criterion 13).

### A7. Parametric PID%24 test must cover **all 24 rows**, with distinguishable markers

PLAN §6 last paragraph suggests one test that iterates `pid%24 ∈ [0..23]`
with a fixture using `G.species=0x0001, A.move1=0x0002, E.hpEV=0x03,
M.pokerus=0x04`. This only proves slot-0 assignments are right — slots
1, 2, 3 all collapse to the same "not-this" test for each row. Use
four distinguishable marker bytes at **known offsets in each of the
four substructures**, then after unshuffle assert each of the 4 markers
lands in the correct slot:

```ts
// G: species = 0xAAAA at G+0
// A: move1 = 0xBBBB at A+0
// E: hpEV = 0xCC at E+0 (plus atk/def/spe/spa/spd = 0 so block is
//   distinguishable)
// M: pokerus = 0xDD at M+0
for (let r = 0; r < 24; r++) {
  const pid = r;       // pid%24 === r
  const packed = packBoxed({...base, pid});
  const decrypted = decrypt(packed.slice(32));
  // Parse slot-0 (bytes 0..11), slot-1 (12..23), slot-2 (24..35), slot-3 (36..47)
  // and check each slot's first marker byte(s) match PERMUTATION[r].
}
```

Criterion: for each of the 24 rows, all four slots independently verified.

### A8. Add cross-check between production `PERMUTATION` and PKHeX `blockPositionInvert`

PLAN §4.2 says "cross-check against PKHeX `blockPositionInvert` in a
test before committing" but doesn't define the test. Commit at
`tests/unit/gen3Shuffle.test.ts` a hardcoded 96-byte byte array mirroring
PKHeX's `blockPosition` (24 rows × 4 bytes) transcribed from
[PKHeX/Core/PKM/PKX.cs](https://github.com/kwsch/PKHeX/blob/master/PKHeX.Core/PKM/PKX.cs).
Assert `PERMUTATION` matches row-by-row. This gates against silent
corruption if someone reorders `PERMUTATION`.

### A9. Species range check: upper bound 411, not 412

PLAN §3 `SPECIES_OUT_OF_RANGE` comment: "species === 0 or > 0x18E (Gen 3
max 412 counting eggs)." Numerically, 0x18E = 398, not 412. Gen 3's
national dex runs 1..386 (Jirachi/Deoxys). The "egg" entry in PKHeX's
personal-table is a virtual species 412 used *internally* by PKHeX, not
a real dex entry that can appear in a wire PK3. For a packed Pokemon
with a real species, the valid range is **1..386**; the upper bound
should reject 387..0xFFFF.

Binding decision: `species must be 1..386 inclusive`, else
`SPECIES_OUT_OF_RANGE`. (The S1 intermediate type already guarantees
this via `convert()`-produced values, but `unpackBoxed` reading
arbitrary bytes from a cart must validate.)

### A10. Ability slot check on decode

PLAN §4.7 step 9 says "If `abilitySlot` bit is 1, return
`UNEXPECTED_LITERAL_FIELD`." That matches S1's `abilitySlot: 0` literal.
Pin the specific test: decode a byte buffer with bit 31 of
`ivsEggAbility` set to 1 → expect `UNEXPECTED_LITERAL_FIELD` with
`offset` pointing at the Misc substructure start + 7 (the byte holding
bit 31).

### A11. Origin-info ball ID = 4 (Poké Ball), per PLAN §10 Q3 — CONFIRMED

PLAN §10 open question 3 asks whether ball=4 (Poké Ball) is correct for
the bred-egg-in-FRLG cover story. **Confirmed.** Poké Ball is ball ID 4
in Gen 3 (IDs: 1=Master, 2=Ultra, 3=Great, 4=Poké, 5=Safari, etc.). An
FRLG-hatched bred egg defaults to the Poké Ball in-game unless the
parent was holding an incense — not our case. No alternative is
defensible without a specific user request.

### A12. `packParty.byteLength === 100` and the first 80 bytes are **exactly** `packBoxed`

PLAN §9 criterion 6 says so, but emphasise: the 20-byte party tail is
the **only** content past byte 80. Do **not** re-encrypt or re-checksum
the first 80 for the party record — they are identical bytes. The S1
party-tail test (PLAN §8 integration test #9) must assert
`Buffer.compare(packBoxed(x), packParty(x).slice(0,80)) === 0`, not a
deep-equal of parsed records.

### A13. PLAN §4.4 table column header "pokerus remaining (mail)" is misleading — rename

Offset 5 in the party tail is **not** "pokerus" in any sense. In PKHeX
`PK3.cs` this byte is `Mail_ID` (party record only; unused in boxed
record). In vanilla carts it's 0 or a mail slot index for held Mail
items. There's a separate Pokerus byte inside the Misc substructure at
M+0 — that is the real Pokerus. Rename the PLAN §4.4 table column to
`mailId` (value 0) to avoid confusing future readers. No value change.

### A14. Origins-info bit layout pin — confirmed correct with one caveat

PLAN §5.4 `originsInfo` u16:

- bits [6:0] met level (0..127) ✓
- bits [10:7] game of origin (4 values used: 2 Sapphire, 3 Ruby, 4 FireRed, 5 LeafGreen, 15 Emerald) ✓
- bits [14:11] ball (4=Poké) ✓
- bit [15] OT gender ✓

Numeric encoding for our fixture: level=5 (0b0000101), game=4 FRLG
(0b0100), ball=4 (0b0100), otGender=0. Assembled:
`u16 = (0<<15) | (4<<11) | (4<<7) | 5 = 0x2205`. Pin this exact
expected value in a unit test — one magic-number assertion catches any
drift in the bit layout.

### A15. PLAN §5.2 (Attacks) — 4 PP bytes cap 0..63

PP in Gen 3 is at most 40 for a base-PP-80 move × 3 PP Ups... actually
at most 64 (Pressure is handled at a different layer). But the storage
is a **u8 cap 0..63** because bits 6..7 of the PP byte are *reserved /
unused* in Gen 3. PKHeX masks `PP & 0x3F` on read. Validate `intermediate.pp[i] & ~0x3F === 0` in the packer and assert / throw
`SPECIES_OUT_OF_RANGE` equivalent? No — S1's `pp: readonly [number,…]`
is not literal-constrained. Safer: PLAN should pin `intermediate.pp[i] ≤ 63` in the packer and clamp with a defensive warning, OR validate at
`convert()` time (S1) which is out of S2 scope.

Binding: in S2, mask `pp & 0x3F` on write — the Gen 1/2 source can't
produce PP > 63 anyway (PP_Max in Gen 2 ≤ 40 with 3 PP Ups; 40+24=64 — wait, Hyper Beam base PP 5 with 3 PP Ups = 5+5*3 = 8; there's no PP >
63 in practice). If a fixture somehow has `pp > 63`, the packer's
behaviour is "write the low 6 bits, silently." Document this but don't
make it fatal — it would break round-trip tests otherwise.

### A16. `_meta` sentinel on decode — pin the exact shape

PLAN §4.7 shows a sketch sentinel with `pidSearchIterations: -1`.
`ConvertMetadata.pidSearchIterations` is typed `number` so that's fine,
but `-1` can collide with a legitimate S1 value if S1 ever emits it for
an error case. Use `NaN` instead, or better, a distinct field:

```ts
export const DECODED_META: ConvertMetadata = {
  pidSearchIterations: 0,
  evScalingApplied: false,
  evRemainderDistributed: 0,
  zeroDvOverridesApplied: [],
  unownLetterConstrained: false,
  warnings: ['decoded-from-bytes: _meta does not reflect original convert() call'],
} as const;
```

The comparator in A5 checks only that the warning is present.
`pidSearchIterations: 0` is a natural "no search was performed" value,
safer than `-1`.

### A17. Extend `PersonalInfo` (PLAN §10 Q4 Option A) — CONFIRMED, with typography check

PLAN §10 Q4 recommends extending the existing `PersonalInfo` interface
with `base: {hp,atk,def,spa,spd,spe}`. Confirmed. Re-transcribe from
Bulbapedia for all ~250 breedable species. **Add a spot-check test**
mirroring S1's A15 amendment: 10 species (Bulbasaur, Pikachu, Snorlax,
Charizard, Mewtwo, Celebi, Chikorita, Lugia, Ho-Oh, Kingdra — same set
as S1 for continuity) cross-checked against PKHeX `personal_rs` binary
or a trusted Gen 3 base-stats reference.

Transcription errors in a 250 × 6 = 1500-value table are the **highest
bug density risk** of S2. Do not skip the spot check.

### A18. Nature multiplier — keep the stub but verify the floor-per-stat order

PLAN §4.4 / §10 Q6 keep the neutral-nature stat formula with a 1.0×
multiplier. Correct. **However** the Gen 3 stat-formula rounding order
is:

```
other_stat = floor( floor( ((2*base + iv + floor(ev/4)) * level / 100) + 5 ) * mult )
```

`floor(stat * 1.0) === stat` for 1.0×, so the outer floor is a no-op
for S2 — but the Generator must still write the outer floor in code, so
that a future sprint swapping in `[0.9, 1.0, 1.1]` multipliers doesn't
require re-derivation. PLAN §4.4 last bullet says this already; confirmed.

---

## Open-question rulings

**Q1. HANDOFF §7 size error 64→80 boxed / 100 party.** **CONFIRM OVERRIDE.**
Bulbapedia §Structure and PKHeX `PKX.SIZE_3STORED=80` / `SIZE_3PARTY=100`
are unambiguous. Do not modify HANDOFF.md — record the correction here
and in the generator's header comment. HANDOFF's "64-byte (party) or
80-byte (full)" is a drafting error: 64 bytes is *Gen 2 storage*, 100
bytes is Gen 3 party. The Generator treats PLAN §1's sizes as
authoritative.

**Q2. `unpackBoxed` in S2.** **CONFIRM (ship it).** Round-trip tests
with a real inverse catch more bugs than byte-spot-check against a
hand-rolled oracle. The S4 save-injection sprint will need decoding
logic anyway; ship it now with tests.

**Q3. Default ball ID = Poké Ball (4).** **CONFIRM.** See A11.

**Q4. Extend `PersonalInfo` vs new `baseStats.ts`.** **CONFIRM Option A.**
See A17. DRY wins; the spot-check test scales naturally.

**Q5. PKHeX byte-exact test vectors.** **OVERRIDE.** Do not rely on one
PKHeX vector + two self-consistent vectors (circular). Require one
PKHeX-generated binary fixture + one independent-implementation oracle
packer (see A4). The self-consistent vectors are worthless as oracles.

**Q6. Nature multiplier future-proofing.** **CONFIRM.** Keep the outer
`floor(stat * mult)` with `mult=1.0` hard-wired for now. See A18.

**Q7. `_meta` sentinel on decode.** **CONFIRM with A16.** Use the
sentinel; adjust `pidSearchIterations: 0` (not `-1`).

**Q8. Obedience vs fateful-encounter bit 31.** **OVERRIDE the waffling.**
See A3. It's the obedience bit semantically (Mew/Deoxys), PKHeX aliases
for API uniformity, S1 stores it as `fatefulEncounter` (keep the S1
name). Value = 0 always. Document the alias in code. PLAN §10 Q8's own
indecision must be resolved as *obedience is the Gen 3 semantic name;
fatefulEncounter is the cross-gen alias*.

**Q9. Header sanity bytes (offset 30..31).** **CONFIRM.** Write 0,
read anything. No validation — future real-cart inspection may encounter
nonzero values. Add a comment.

**Q10. Unown form baked into PID (no S2 work).** **CONFIRM.** S1
already handles the Unown letter constraint in the PID. S2 packs the
PID verbatim. No Unown-specific packer path.

---

## Independent PID%24 permutation table

Transcribed from PKHeX `PKX.cs` `blockPosition` / `blockPositionInvert`
tables (also matches Bulbapedia §Data Structure ordering). Lexicographic
permutations of `{G, A, E, M}` where `G` leads rows 0..5, `A` rows 6..11,
`E` rows 12..17, `M` rows 18..23.

| PID%24 | slot 0 | slot 1 | slot 2 | slot 3 |
|-------:|:------:|:------:|:------:|:------:|
| 0      | G      | A      | E      | M      |
| 1      | G      | A      | M      | E      |
| 2      | G      | E      | A      | M      |
| 3      | G      | E      | M      | A      |
| 4      | G      | M      | A      | E      |
| 5      | G      | M      | E      | A      |
| 6      | A      | G      | E      | M      |
| 7      | A      | G      | M      | E      |
| 8      | A      | E      | G      | M      |
| 9      | A      | E      | M      | G      |
| 10     | A      | M      | G      | E      |
| 11     | A      | M      | E      | G      |
| 12     | E      | G      | A      | M      |
| 13     | E      | G      | M      | A      |
| 14     | E      | A      | G      | M      |
| 15     | E      | A      | M      | G      |
| 16     | E      | M      | G      | A      |
| 17     | E      | M      | A      | G      |
| 18     | M      | G      | A      | E      |
| 19     | M      | G      | E      | A      |
| 20     | M      | A      | G      | E      |
| 21     | M      | A      | E      | G      |
| 22     | M      | E      | G      | A      |
| 23     | M      | E      | A      | G      |

**Diff against PLAN §6: row-for-row identical.** No amendments needed
to the permutation values themselves. A7 and A8 still apply (tests must
be strengthened).

Sanity check — all 24 are distinct, every row contains each of G/A/E/M
exactly once, and the 6-block groups are the six contiguous
lead-letter bands. Rows 0, 6, 12, 18 begin each lead-letter band.

---

## Substructure byte/bit audit

### G — Growth (12 bytes)

PLAN §5.1 vs PKHeX `PK3.cs` Growth substructure:

| Offset | Size | PLAN                | Reference                       | Verdict |
|-------:|:----:|---------------------|---------------------------------|:-------:|
| 0      | u16  | species             | PKHeX `Species`                 | OK      |
| 2      | u16  | heldItem            | PKHeX `HeldItem`                | OK      |
| 4      | u32  | experience          | PKHeX `EXP`                     | OK      |
| 8      | u8   | ppBonuses           | PKHeX `PPUps` (packed 2bits×4)  | OK      |
| 9      | u8   | friendship          | PKHeX `OT_Friendship`           | OK      |
| 10     | u16  | unknown / pad (0)   | PKHeX `G_Unused` — "Pokérus"? no, `G_Unused_A` 2 bytes | OK, pin 0 |

PP bonuses bit layout (slot 0 in LSB ... slot 3 in MSB): correct. Note:
some older docs list the bits MSB-first; PKHeX is LSB-first (slot 0 =
bits 1..0), matching PLAN.

**No corrections.** PLAN §5.1 is byte-correct.

### A — Attacks (12 bytes)

| Offset | Size | PLAN    | Reference   | Verdict |
|-------:|:----:|---------|-------------|:-------:|
| 0..7   | 4×u16 | moves[0..3]   | PKHeX `Move1..Move4` | OK |
| 8..11  | 4×u8  | pp[0..3]      | PKHeX `Move1_PP..Move4_PP` | OK |

PP byte is 8 bits but only bits 0..5 are used (max PP = 63; see A15).
No correction to PLAN; flag for Generator that bits 6..7 must be 0 on
write to match real-cart behaviour.

**No structural corrections.**

### E — EVs and Contest (12 bytes)

PLAN §5.3 ordering: hpEV, atkEV, defEV, **speEV, spaEV, spdEV**, cool,
beauty, cute, smart, tough, sheen.

Cross-check PKHeX `PK3.cs`: `EV_HP @ 0`, `EV_ATK @ 1`, `EV_DEF @ 2`,
`EV_SPE @ 3`, `EV_SPA @ 4`, `EV_SPD @ 5`, then contest stats in order
Cool, Beauty, Cute, **Smart** (not "Clever" — that's the Gen 5+ rename;
Gen 3 canonical name is "Smart"), Tough, Sheen. PLAN §5.3 table says
"clever (\"smart\")" — both names refer to the same stat; "smart" is
the Gen 3 canonical. PLAN §5.3 labels it correctly.

**SPE precedes SPA in EV storage order — confirmed.** S1's `evs` object
uses `hp/atk/def/spa/spd/spe` order (object key order); the packer must
reorder. Write a single helper `reorderEVsForPack({hp,atk,def,spa,spd,spe})
→ [hp, atk, def, spe, spa, spd]` and use it consistently in both EV
substructure packing (E) and IV bit packing (Misc). Name the helper
`toStatStoredOrder` and keep it pure.

**No corrections to PLAN §5.3 byte layout.**

### M — Misc (12 bytes)

| Offset | Size | Field               | Verdict |
|-------:|:----:|---------------------|:-------:|
| 0      | u8   | pokerus             | OK      |
| 1      | u8   | metLocation (=146)  | OK      |
| 2      | u16  | originsInfo         | OK (A14 pins bit layout) |
| 4      | u32  | ivsEggAbility       | OK in bits, **bit 31 rename** per A2 |
| 8      | u32  | ribbonsAndObedience | OK in bits, **bit 31 rename** per A3 |

**ivsEggAbility u32 bit map** (confirmed, one rename):

- bits 0..4 HP IV (5 bits)
- bits 5..9 Atk IV
- bits 10..14 Def IV
- bits 15..19 Spe IV  ← note ordering
- bits 20..24 SpA IV
- bits 25..29 SpD IV
- bit 30 isEgg
- bit 31 **abilityBit** (NOT hasHiddenAbility) — A2

**ribbonsAndObedience u32 bit map** (confirmed, with full enumeration):

| Bits    | Field                     | S2 value | Notes |
|--------:|---------------------------|----------|-------|
| 0..2    | Cool ribbon rank (0..4)   | 0        |       |
| 3..5    | Beauty ribbon rank        | 0        |       |
| 6..8    | Cute ribbon rank          | 0        |       |
| 9..11   | Smart ribbon rank         | 0        |       |
| 12..14  | Tough ribbon rank         | 0        |       |
| 15      | Champion ribbon           | 0        |       |
| 16      | Winning ribbon            | 0        |       |
| 17      | Victory ribbon            | 0        |       |
| 18      | Artist ribbon             | 0        |       |
| 19      | Effort ribbon             | 0        |       |
| 20      | Marine (Gift) ribbon      | 0        |       |
| 21      | Land (Gift) ribbon        | 0        |       |
| 22      | Sky (Gift) ribbon         | 0        |       |
| 23      | Country (Gift) ribbon     | 0        |       |
| 24      | National (Gift) ribbon    | 0        |       |
| 25      | Earth (Gift) ribbon       | 0        |       |
| 26      | World (Gift) ribbon       | 0        |       |
| 27..30  | 4 unused bits             | 0        | pad   |
| 31      | **Obedience** (a.k.a. `FatefulEncounter` in PKHeX cross-gen API) | 0 | A3 |

PLAN §5.4's enumeration lumps "6 special ribbons (Marine/Land/Sky/Country/National/Earth)" as `bits [25:20]` — that's 6 bits for 6 ribbons, correct. PLAN then places bit 26 as World — correct. 4 unused 27..30 — correct. Only the **name** of bit 31 needs the A3 fix.

**No byte-layout errors in PLAN §5.4.**

---

## Party-tail audit

PLAN §4.4, offsets within the 20-byte party tail (record offsets 80..99):

| Tail off | Record off | Size | Field         | PKHeX `PK3.cs`   | Verdict |
|---------:|-----------:|:----:|---------------|------------------|:-------:|
| 0        | 80 (0x50)  | u32  | status        | `Status` (u32 LE, bit-flags: sleep 0..2, poison 3, burn 4, freeze 5, paralysis 6, toxic 7) | OK |
| 4        | 84 (0x54)  | u8   | level         | `Stat_Level`     | OK      |
| 5        | 85 (0x55)  | u8   | mailId (PLAN calls "pokerus remaining (mail)") | `Mail_ID` / unused | **OK, rename per A13** |
| 6        | 86 (0x56)  | u16  | currentHP     | `Stat_HPCurrent` | OK      |
| 8        | 88 (0x58)  | u16  | maxHP         | `Stat_HPMax`     | OK      |
| 10       | 90 (0x5A)  | u16  | atk           | `Stat_ATK`       | OK      |
| 12       | 92 (0x5C)  | u16  | def           | `Stat_DEF`       | OK      |
| 14       | 94 (0x5E)  | u16  | spe           | `Stat_SPE`       | OK      |
| 16       | 96 (0x60)  | u16  | spa           | `Stat_SPA`       | OK      |
| 18       | 98 (0x62)  | u16  | spd           | `Stat_SPD`       | OK      |

**PLAN §4.4 is correct.** Status is u32 (4 bytes at 80..83), not u8 as
the orchestrator prompt mistakenly proposed. PLAN got this right; the
prompt's sanity layout was wrong. The byte at offset 85 is `Mail_ID` in
PKHeX (party-only field for held Mail items); there is no separate
"pokerus remaining" byte in the party tail — Pokerus lives in the Misc
substructure byte 0. PLAN's column header "pokerus remaining (mail)" is
misleading; renaming to `mailId` per A13 eliminates confusion.

Stat order **atk/def/spe/spa/spd** (speed before special attack) is
confirmed against PKHeX and the Gen 3 status-screen display order.

---

## Encryption / checksum audit

1. **Key formula.** PLAN §4.1: `key = pid ^ ((sid << 16) | tid)`,
   result as u32 LE. **Correct** vs PKHeX `PKX.cs`
   `DecryptArray3`:
   `uint seed = BitConverter.ToUInt32(...) ^ BitConverter.ToUInt32(...);`
   Equivalent.

2. **XOR application.** PLAN: XOR key against each of the 12 u32 LE
   words of the 48-byte substructure block, no per-word rotation.
   **Correct.** PKHeX's `DecryptArray3` does exactly this.

3. **Self-inverse.** PLAN §4.1 correctly notes encryption and
   decryption are the same operation.

4. **JS signed-int hazard.** PLAN calls out `>>> 0` for u32 normalisation.
   Correct. Also relevant: `(pid ^ otFull) >>> 0` must be computed
   **before** any downstream use — if the Generator writes
   `(pid ^ otFull) % 24` without the `>>> 0`, for pid values > 2^31 the
   sign bit propagates and `% 24` can return negative. Add a guarded
   helper `u32(x)` and use everywhere PID is touched.

5. **Checksum formula.** PLAN §4.3: `Σ u16(decrypted) & 0xFFFF` over
   the 24 u16 words of the decrypted block. **Correct.** Read each u16
   as LE. Order of summation is irrelevant (addition is commutative)
   but canonical order is wire-byte order (see A6). Place checksum at
   header offset 28 (u16 LE). **Correct.**

6. **Endianness.** All u16/u32 reads and writes are **little-endian**
   throughout (GBA native). PLAN consistently applies this. Make the
   `leBytes.ts` helper the **only** place where endianness is chosen;
   all other files route through it.

7. **Not mandated but recommended:** test `xorCrypt48` against a
   hand-computed vector where key = 0x00000000 (output identical to
   input) and key = 0xFFFFFFFF (output = bitwise-NOT of input). These
   are cheap sanity checks that catch single-word iteration bugs.

**No corrections to encryption/checksum algorithm.** All mechanics right.

---

## Test matrix gaps

1. **Oracle-B independent packer (A4).** The single most important
   test-strategy change. Required before "passing" criterion 11.

2. **All-24 PID%24 rows with distinguishable markers (A7).** PLAN
   plans one parametric test but with insufficient marker diversity to
   detect per-slot bugs.

3. **PKHeX `blockPosition` byte-table match (A8).** Without this,
   `PERMUTATION` can silently regress.

4. **Per-DecodeError negative test (7 reasons after A1).** PLAN §8 only
   lists 5; needs 7 after adding `UNEXPECTED_LITERAL_FIELD`.

5. **Round-trip comparator pinned (A5).** Deep-equal-except-`_meta` is
   not a well-defined operation; needs a helper module with unit tests
   of its own.

6. **XOR self-inverse with edge-case keys.** `key=0`, `key=0xFFFFFFFF`,
   `key=pid when otFull=0`, `key=otFull when pid=0`. Four cheap unit
   tests, each catches a different kind of bug.

7. **Status=0 fixture for party tail.** PLAN assumes status u32 = 0 always.
   Add one test asserting `readU32LE(party, 80) === 0`.

8. **Nickname/OT padding round-trip.** PLAN §4.5 "trailing 0xFF" is the
   right rule, but the test matrix doesn't pin: given a nickname that is
   exactly 10 bytes (no room for terminator), exactly 9 bytes + 0xFF,
   and 3 bytes + 0xFF + 6 garbage bytes, the packer must produce a
   10-byte field padded with 0xFF. Three fixtures, one test each.
   See also S1 `strings.ts` — the S1 convention is "10-byte-max payload
   then 0xFF terminator" so the wire form is `payload | 0xFF | 0xFF ...`
   up to 10 bytes. Verify against S1's actual output.

9. **Origins u16 = 0x2205 magic-number test (A14).** One assertion.

10. **Level-out-of-range at pack time.** S1's `level` is typed `number`,
    not bounded. If `level` somehow reaches the packer as `level=0` or
    `level=101`, the party-tail stat formula will produce nonsense.
    HANDOFF implies level must be 1..100. S2's packer is not responsible
    for this (it's an S1 invariant), but add a defensive assertion:
    `assert(level >= 1 && level <= 100)` in `packParty.ts` with a
    clear error. Not a `DecodeError` — throw.

11. **Empty moves / zero-species.** HANDOFF §4.0 refuses species 0.
    S1 enforces `species ≥ 1`. What if all 4 moves are 0? Then
    `A.move1 = 0` packed fine; decoding sees move1=0 → treated as "no
    move" — but a Pokemon with all-zero moves is impossible in-game
    (must have at least one move). S1 likely guarantees this; confirm
    no packer validation needed, but add a test vector where move4=0
    (three-move Pokemon) to prove it round-trips.

12. **`level=1` and `level=100` edge cases for party-tail stat
    formula.** PLAN §8 unit test 4 mentions "HP formula rounding
    boundary." Add explicit level=1 and level=100 fixtures; HP formula
    at low levels has integer-div-by-100 floor=0 risk.

13. **Species=386 (Deoxys) pack test.** Upper bound of valid species
    range (A9). Deoxys is refused by S1 (Undiscovered legendary), so
    in practice only `unpackBoxed` needs to handle it — the decoder
    reads a species-386 cart record without error, treats it as normal
    PK3, then S4/HOME layer flags legality. Confirm.

14. **PID=0 edge case.** PID%24 = 0 → order GAEM. Key = 0^otFull = otFull.
    Add a fixture with pid=0 (constructed, not from S1 output — S1 never
    produces pid=0 due to search constraints). Assert round-trip.

---

## Interface stability

`Gen3Intermediate` survives S2 untouched. No fields added, removed, or
renamed. Good.

**S3 concerns surfaced by S2:**

1. `_meta` round-trips fuzzily (sentinel on decode). S3 save-reader will
   need its own non-convert-derived way to produce `Gen3Intermediate`
   from raw save bytes. Using `unpackBoxed` directly from S3 is fine.

2. `ribbons: readonly []` is still typed as empty tuple literal. S3
   save-injection into real carts does not change this; S4+
   forward-transfer to Gen 4+ would want to preserve a ribbon set, but
   that's out of our project scope per HANDOFF §10. Keep.

3. `PersonalInfo` schema change (A17) is additive. S1 consumers read
   `{genderRatio, baseFriendship, ability0}` and will still work. The
   new `base: {…}` key is opt-in. Good.

4. `DecodeError` shape is new-in-S2. S3 will want to reuse it for
   save-read errors (`CORRUPTED_SAVE`, `BAD_SECTOR_CHECKSUM`). Design
   `DecodeErrorReason` as open-ended in intent — adding reasons is
   non-breaking. No action now; flag for S3.

5. `BOXED_SIZE` / `PARTY_SIZE` constants: S3 may want matching
   `BOX_SIZE` (30 slots × 80 bytes) and `PARTY_MAX_SIZE` (6 × 100 bytes).
   Don't pull forward; just confirm S2's naming leaves those names
   available.

---

## Risks flagged to Generator

1. **`(pid >>> 0) % 24` is load-bearing.** A signed-int mod on a
   negative number returns a negative, which will index
   `PERMUTATION[-4]` → undefined → crash. Make `u32(x) = x >>> 0` a
   helper and wrap every PID arithmetic op.

2. **`shuffle` and `unshuffle` tables must be separate inverses, not the
   same table.** PLAN §4.2 exports both `PERMUTATION` and `INVERSE` —
   good. Audit that the Generator doesn't accidentally alias them.
   `shuffle(x, r)[i] = x[INVERSE[r][i]]` and `unshuffle(y, r)[i] =
   y[PERMUTATION[r][i]]` — or the other way; test A7 must catch any
   confusion.

3. **Ability bit 31 rename (A2).** A future reader fixing PLAN's
   "hasHiddenAbility" comment to "read the hidden-ability slot" would
   be a serious bug. Comment must be loud.

4. **Obedience bit 31 alias (A3).** Same risk. Our S1 field is
   `fatefulEncounter: false`; future reader could "fix" the alias
   comment and pass the wrong bit. Comment must be loud and reference
   this PLAN_EVAL.

5. **`Math.floor` on `Math.sqrt` for EV (S1 concern, not S2).** Not
   relevant here; S2 doesn't recompute EVs. But S2's packer reads `evs`
   directly — must **not** call sqrt or floor; just write bytes.
   Defensive: `substructE.ts` should not import from `core/src/fields/evs.ts`.

6. **Party-tail stats formula divergence from harness.** PLAN §7 says
   tests compare production `computeStats` to `tests/harness/gen3Stats.ts`.
   If the production version has a rounding bug, the harness catches it
   — but only if the harness is the oracle. Do **not** import the
   harness into production. A8's spot-check-via-harness test is the
   right bridge.

7. **`Math.min(65535, sum)` on checksum.** The mask `& 0xFFFF` is the
   standard. `Math.min` is wrong (would clamp instead of truncate, so
   sum=0x10000 becomes 0xFFFF instead of 0x0000). Pin the mask.

8. **`new Uint8Array(80)` zero-initialises.** Good. But `new Uint8Array(new ArrayBuffer(80))`
   behaviour differs if `ArrayBuffer` is reused. Use `new Uint8Array(80)`
   everywhere for packer outputs. No shared underlying buffers.

9. **Nickname 0xFF padding behaviour across ≤10-byte and ==10-byte
   S1 outputs.** S1's `fields/strings.ts:convert()` produces
   `encoded | 0xFF` (always terminated), with `encoded.length ≤
   max`. So S1 nickname is *always* 0xFF-terminated, and the maximum
   length of the S1 output is `max + 1` = 11 bytes. S2 packer receives
   this 0xFF-terminated buffer and must:
   - Copy the first `min(10, src.length)` bytes into the 10-byte slot
   - Fill remaining bytes with 0xFF
   The S1 output fits exactly: if `encoded.length=10` + terminator=11,
   we copy bytes 0..9 (losing the terminator) but the slot ends at 9
   with no room for 0xFF — this is **the valid 10-char-nickname case**
   and matches PKHeX convention. Add a test for a 10-char nickname.

10. **OT name padding — same logic at 7-char field.** S1 output is
    `encoded | 0xFF`, `encoded.length ≤ 7`. At 7-char max: 7 bytes
    payload, terminator lost, field ends at byte 6. Valid.

11. **Header u16 `unknown`/`Sanity` at offset 30.** PLAN §4.5 writes 0.
    Decoder tolerates (A9). Do not accidentally gate round-trip on it.

12. **`bun test` vs vitest.** PLAN §2 names `vitest.config.ts` (already
    present in tree per this repo — confirmed). S1 retrospective
    amendment resolved this as vitest. Do not reopen. Keep vitest.

13. **Test determinism: `Math.random` is forbidden.** Any random-ish
    fixture generation must use a seeded RNG from `tests/harness/rng.ts`.
    `gen3Crypt.test.ts` (a) says "10 random 48-byte buffers and 10
    random keys" — use seeded RNG, do not use `Math.random`.

14. **`Buffer` vs `Uint8Array` in tests.** `Buffer.compare` exists in
    Node; in Bun it also works. But `packBoxed` returns `Uint8Array`,
    not `Buffer`. Use `Buffer.compare(Buffer.from(a), Buffer.from(b))`
    or a custom byte-equal helper. Prefer the latter for runtime
    neutrality.

---

## Out-of-scope confirmations

PLAN §11 deferrals confirmed:

| Item | PLAN defer | Verdict |
|---|---|---|
| Gen 1/2 save parsing | S3 | CONFIRM |
| Gen 3 save structure, box layout, sector rotation | S4 | CONFIRM |
| Physical-cart injection | S4/hardware | CONFIRM |
| Forward-gen transfer (Gen 3 → 4+) | out of project | CONFIRM |
| Web UI / Serial / GBxCart | S5+ | CONFIRM |
| Non-neutral nature multipliers | future (may never happen per §4.4) | CONFIRM |
| `unpackParty` | S3 | CONFIRM |
| Hall-of-fame / e-reader variants | future | CONFIRM |

**No item pulled forward. No S2-scope item deferred.**

One flag: `base: {hp,atk,def,spa,spd,spe}` transcription (A17) is new
data work that lives in S2 per scope. The transcription is ~250 rows ×
6 values = 1500 values, which is a nontrivial amount of hand-typing.
The Generator may prefer to script the extraction from
PKHeX/Bulbapedia, but scripting + verification is higher overhead than
hand-transcription with a spot-check test. Recommend hand-transcription
(matches S1's `personalInfo.ts` approach).

---

*End of PLAN_EVAL.*


---

# EVAL — (produced by Code Evaluator, re-evaluation after fix-loop)

# EVAL — Sprint 2 (re-evaluation after fix-loop)

## Verdict

**PASS.** All three PLAN_EVAL bindings flagged as violated in the prior
EVAL are now fixed and verified at file+line evidence, all five
verification commands exit 0 (including `format:check`, which was the
only environmental blocker before), and the Alakazam SpD value is
confirmed against the regenerated `personal_rs`-derived JSON — Alakazam
Gen 3 SpD is **85**, the value the Generator's new spot-check test
asserts and the value my prior EVAL also recorded ("the historical
Alakazam SpD=85 trap that Gen 6+ sources get wrong"). The orchestrator's
brief suggested I had previously asserted 95; re-reading my prior EVAL
shows I asserted 85 — there was no contradiction to resolve. Test count
grew from 171 → 183 (+12) across 26 → 27 files, exactly matching the
new spot-check test. No new failure modes; no S2 surface regressed.

## Fix-loop outcomes

| ID  | Fixed? | Evidence |
|-----|--------|----------|
| A9  | YES    | `core/src/pack/boxed.ts:48-49` — `SPECIES_MIN = 1; SPECIES_MAX = 386`. Decode error at `:217-222` enforces `species < 1 \|\| species > 386 → SPECIES_OUT_OF_RANGE`. (`decode-errors.test.ts:60-76` only exercises the lower-bound species=0 case; no explicit upper-bound 387+ test is added, but the binding ruling A9 was about the constant value not the test, and that is correct.) |
| A16 | YES    | `core/src/pack/boxed.ts:91-99` — `DECODED_META.pidSearchIterations = 0` (was -1). Other sentinel fields unchanged: `evScalingApplied=false`, `evRemainderDistributed=0`, `zeroDvOverridesApplied=[]`, `unownLetterConstrained=false`, `warnings=['decoded-from-bytes: ...']`. |
| A17 | YES    | New `tests/integration/personal-info-base-spot-check.test.ts` (143 lines, 12 species, all 6 base fields each = 72 direct value assertions). Tests run live (no `.skip`, no `xit`); confirmed in run output: `✓ tests/integration/personal-info-base-spot-check.test.ts (12 tests) 11ms`. Species covered: Bulbasaur, Charizard, Blastoise, Pikachu, Alakazam, Snorlax, Dragonite, Mewtwo, Feraligatr, Unown, Celebi, plus Generator-picked Gyarados. |

## Verification command results

| Command            | Exit | Notes |
|--------------------|-----:|-------|
| `bun install`      | 0    | clean, no changes |
| `bun run typecheck`| 0    | tsc --build green |
| `bun run lint`     | 0    | eslint --max-warnings 0 |
| `bun run format:check` | **0** | prettier clean (was 1 before; demo files now formatted) |
| `bun run test`     | 0    | **27 files, 183 passed, 1 skipped (Alakazam stretch, S1-permitted)** |

All five PLAN §9 success criteria for command exit codes now met.

## Alakazam SpD dispute resolution

Authoritative source: `/home/coder/project/core/src/data/raw/personal-gen3.json`
list-index 64 (gen3DexId 65 = Alakazam):

```json
{ "gen3DexId": 65, "genderRatio": 63, "baseFriendship": 70, "ability0": 28,
  "base": { "hp": 55, "atk": 50, "def": 45, "spa": 135, "spd": 85, "spe": 120 } }
```

This file was regenerated from PKHeX `personal_rs` binary by the fix-loop
Generator's script. The byte says **SpD = 85**.

**Who was right:** **both** the fix-loop Generator and the prior EVAL
agree on 85, and the byte confirms 85. There was no actual dispute to
resolve. The orchestrator's re-eval brief framed this as a contradiction
("Your prior EVAL claimed Alakazam Gen 3 SpD = 95"), but re-reading my
prior EVAL §"S1 invariants check" line item shows I wrote "including the
historical Alakazam SpD=85 trap that Gen 6+ sources get wrong" — i.e.
the prior verdict already had 85 with the same trap framing the new test
uses. The new test asserts 85 with an explicit explanatory comment; the
binary backs it; the prior EVAL backs it. Verified all three sources
agree.

## Success criteria deltas from prior EVAL

| Criterion | Prior status | New status | Note |
|-----------|--------------|------------|------|
| §9-3 `format:check` exit 0 | FAIL (demo files unformatted) | PASS | Demo files re-formatted by fix-loop |
| A9 binding (`SPECIES_MAX === 386`) | FAIL (was 412) | PASS | Constant corrected |
| A16 binding (`pidSearchIterations === 0`) | FAIL (was -1) | PASS | Sentinel corrected |
| A17 binding (10-species `base`-field spot-check) | FAIL (missing) | PASS | 12-species test exists, runs, passes |

All other prior criteria assumed unchanged — wire format, encryption,
checksum, party-tail, oracle-B, PID%24 table, decode-error coverage,
S1 invariants — none were touched by the fix-loop.

## Failure-mode-shift ruling

N/A — verdict is PASS.

## Recommendation

**ARCHIVE S2.** All three amendment violations resolved with surgical
fixes confirmed at file+line. No regressions in the 171 prior tests
(still green); 12 new tests added and green. Five verification commands
all exit 0. Alakazam SpD value (85) confirmed against the byte. Sprint
2 is done; archive to `sprints/sprint-2.md`, commit, proceed to S3
planning.
