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
