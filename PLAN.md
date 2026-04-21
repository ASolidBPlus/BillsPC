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
