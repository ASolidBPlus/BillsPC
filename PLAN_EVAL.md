# PLAN_EVAL — Sprint 1

## Verdict

**APPROVE_WITH_AMENDMENTS.**

The plan is structurally sound: scope boundaries are correct, directory layout is reasonable, interface shapes for `Gen12Pokemon` / `Gen3Intermediate` will survive into S2, and the test matrix tracks the HANDOFF §9 rows. However there are **three concrete correctness bugs** in the plan as written that would silently produce wrong output if the Generator copies them verbatim: (a) §4.4 NEUTRAL-array has Serious and Bashful swapped, (b) §4.4 and §6.5 state the nature distribution as `[52, 52, 51, 51, 50]` which is arithmetically impossible for `x % 5` over `0..255` — the true distribution is `[52, 51, 51, 51, 51]`, (c) §8.5 gives a correct canonical EV answer but §4-EVs / §6.4 never pin it as a binding assertion. There are also two semantic drifts from HANDOFF that must be fixed: PID-method avoidance needs H1/H2/H4 added (the cover story is FRLG, whose wild spreads are Method H*), and the §4.6 Unown "refuse vs keep" contradiction in HANDOFF must be resolved explicitly (it is: §4.6 wins, keep Unown, which the Planner inferred but the Generator needs stated as binding). Finally there are a handful of missing or vague success criteria (SHA-256 NIST vector assertion, PID bounded-depth test, SID stability across conversions, Hamilton forced-tie fixture) that must be added or the Code Evaluator won't catch the right regressions.

None of these are structural. Fix the amendments below, then the Generator can proceed.

---

## Amendments (binding on the Generator)

The Generator reads PLAN.md **plus this amendments section**. Where they conflict, this document wins. PLAN.md is not modified.

### A1. Fix the NEUTRAL array ordering (PLAN §4.4)

PLAN says:
```ts
const NEUTRAL = [0 /*Hardy*/, 6 /*Docile*/, 18 /*Serious*/, 12 /*Bashful*/, 24 /*Quirky*/];
```

This is **wrong**. In the canonical PKHeX Nature enum, Serious = 12 and Bashful = 18. The Planner swapped them. HANDOFF §4.4 explicitly maps bucket 2 → Serious and bucket 3 → Bashful. Correct code:

```ts
const NEUTRAL = [0 /*Hardy*/, 6 /*Docile*/, 12 /*Serious*/, 18 /*Bashful*/, 24 /*Quirky*/];
```

Add a unit-test constant `NATURE_NAMES[12] === 'Serious'` and `NATURE_NAMES[18] === 'Bashful'` to catch any re-swapping.

### A2. Correct the nature-distribution counts (PLAN §4.4 and §6.5)

PLAN §4.4 claims distribution `[52, 52, 51, 51, 50]` over the 256 `(atk,def)` pairs. PLAN §6.5 repeats it. Both are wrong. The value `(atk << 4) | def` spans exactly the integers `0..255`. Residue counts for `x % 5` over `0..255`:

- residue 0: `{0, 5, 10, …, 255}` → 52 elements
- residue 1: `{1, 6, …, 251}` → 51
- residue 2: `{2, 7, …, 252}` → 51
- residue 3: `{3, 8, …, 253}` → 51
- residue 4: `{4, 9, …, 254}` → 51

**Correct distribution: `[52, 51, 51, 51, 51]`, total 256.** The `nature-distribution.test.ts` assertion must be `[52, 51, 51, 51, 51]` exactly, not "within 5% of uniform" — the distribution is deterministic, not stochastic, so pin it bit-exactly.

### A3. Pin the EV Case C expected output (PLAN §4-EVs, §6.4, §8.5)

PLAN §6.4 says "hand-compute with tiebreak, assert exactly" and defers the answer to §8.5. Bind the answer here.

Re-derivation in canonical `[hp, atk, def, spa, spd, spe]` order. Input StatExp `{hp:65535, atk:65535, def:10000, spe:5000, special:0}` (Special fed to both spa and spd):

| Stat | raw = min(252, floor(√StatExp)) |
|---|---|
| hp  | floor(√65535)=255 → cap 252 |
| atk | 252 |
| def | floor(√10000)=100 |
| spa | floor(√0)=0 |
| spd | 0 |
| spe | floor(√5000)=70 |

Raw `[252, 252, 100, 0, 0, 70]`, sum = 674 > 510 → scale by 510/674.

| Stat | scaled = raw·510/674 | floor | rem |
|---|---|---|---|
| hp  | 190.6824...  | 190 | 0.68249... |
| atk | 190.6824...  | 190 | 0.68249... |
| def | 75.66765...  | 75  | 0.66765... |
| spa | 0            | 0   | 0          |
| spd | 0            | 0   | 0          |
| spe | 52.96735...  | 52  | 0.96735... |

Sum of floors = 507. Residual = 510 − 507 = 3. Hamilton (rem desc, index asc on ties):

1. spe (0.96735, idx 5) → +1 → 53
2. hp  (0.68249, idx 0) → +1 → 191
3. atk (0.68249, idx 1) → +1 → 191

**Binding expected result: `[191, 191, 75, 0, 0, 53]`, sum 510.**

`evs.test.ts` Case C must assert exactly this. Also assert `_meta.evScalingApplied === true` and `_meta.evRemainderDistributed === 3`.

### A4. Resolve the HANDOFF Unown contradiction explicitly

HANDOFF §4.0 refuses the Undiscovered egg group wholesale; Unown is in Undiscovered. HANDOFF §4.6 specifies a detailed PID search for Unown. These contradict. **§4.6 wins: Unown is KEPT, not refused.** Rationale: §4.6 is the more specific and later-authored rule, and the §4.0 list's parenthetical "plus all baby-pre-evos that cannot themselves be bred" tacitly admits the Undiscovered blanket is over-inclusive. Unown is in fact breedable in Gen 3 (field egg group in Gen 3, despite being Undiscovered in Gen 2 — PKHeX personal_rs confirms). So keeping Unown is also factually correct under the cover story.

The Generator must:
- Keep Unown (dex 201) out of the refused set.
- Implement the `unownLetter()` bit-extraction and PID-constraint in `pid.ts`.
- Add a comment in `refused.ts` citing this amendment so a future editor doesn't "fix" the inconsistency.

### A5. Extend the PID wild-method avoidance to Methods H1/H2/H4

HANDOFF §4.6 bullet 4 says "Method 1/2/4." The cover story is **FRLG bred egg** (HANDOFF §4.8). FRLG wild encounters use Methods H1, H2, H4 (the "hidden" FRLG RNG variants), not the RSE 1/2/4. PKHeX's `MethodFinder` flags H1/H2/H4 matches the same way it flags 1/2/4 for RSE-origin Pokemon. Leaving those out risks PKHeX flagging a converted Pokemon as a wild FRLG spread.

**Generator must implement the full set: reject PIDs that match Method 1, 2, 4, H1, H2, or H4 wild spreads.** Colo/XD (shadow), Channel (Jirachi), roamers, and Method 3 are not needed (Method 3 doesn't exist as a distinct valid PID/IV relationship; it's a deprecated placeholder). Reference: PKHeX `PIDType` enum members `Method_1`, `Method_2`, `Method_4`, `Method_1_Unown`, `Method_H1`, `Method_H2`, `Method_H4`.

Add a `pidMethods.test.ts` case that constructs a PID/IV pair known to satisfy Method H1 and asserts the PID search rejects it.

### A6. SHA-256 implementation — pure-TS, sync, with NIST vectors

Per PLAN §8.6 and criterion 12 (`core/package.json` dependencies = `{}`). Vendor a pure-TS SHA-256 implementation. **Required**: the test suite must include the three NIST FIPS 180-2 test vectors:

- empty string: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
- `"abc"`: `ba7816bf8f01cfea414140de5dae2223b00361a3396177a9cb410ff61f20015a`
- 448-bit: `"abcdefbcdefcdefgdefghiefghijfghijkghijklhijklmijklmnjklmnoklmnopqrsnopqrstopqrstu"` (FIPS 180-2 example 3) → `cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1`

If the impl doesn't round-trip these bit-exactly, every downstream PID and SID test is meaningless. Add this as a top-priority gate in `hash-rng.test.ts` before any RNG tests run.

### A7. Pin SID stability as an explicit test

HANDOFF §4.7 guarantees SID is stable per `(OT_name_bytes, TID)`. PLAN test matrix does not test this. Add a test case:

```ts
// Two Snorlaxes with different species but same OT/TID → identical SID
const a = convert({...fixtureSnorlax, speciesGen2Id: 143});
const b = convert({...fixtureSnorlax, speciesGen2Id: 25});
expect(a.sid).toEqual(b.sid);
```

And a negative case: differing OT bytes → different SID.

### A8. Pin PID bounded-depth test

HANDOFF §4.6: "worst case search depth should be small (a few hundred iterations). If exceeds ~10,000, log a warning." PLAN has a hard-cap throw test but no bounded-depth test. Add:

```ts
// Across all §9 fixtures, pidSearchIterations < 1000.
for (const fx of ALL_NONSTRETCH_FIXTURES) {
  const out = convert(fx);
  expect(out._meta.pidSearchIterations).toBeLessThan(1000);
}
```

If any fixture exceeds 1000, the constraint stack is wrong — better to find that in CI than in the hardware.

### A9. Pin Hamilton forced-tie fixture

PLAN §6.4 says "Hamilton tiebreak with constructed tied-remainder input" but doesn't specify the fixture. Provide one. Simplest forced tie:

Input StatExp that yields raw `[a, a, a, a, a, a]` with `6a > 510` and `510 % 6 ≠ 0`. E.g. StatExp all = 10201 → floor(√10201)=101 for all six → sum 606 → scale 510/606. Each scaled = 101·510/606 = 85. Exact integer; sum 510; no Hamilton pass needed. Bad fixture.

Use instead: StatExp `{hp:10000, atk:10000, def:10000, spe:10000, special:10000}` → raw `[100,100,100,100,100,100]`, sum 600, scale 510/600 = 0.85. Each scaled = 85.0 exactly; sum 510; still no residual. Also bad.

Better: StatExp `{hp:9801, atk:9801, def:9801, spe:9801, special:9801}` → raw `[99,99,99,99,99,99]`, sum 594, scale 510/594 = 0.858585…; scaled each = 85.0001… wait, 99·510/594 = 50490/594 = 85.0 exactly. Still no residual.

A cleaner forced tie: pick raw `[100, 100, 100, 100, 100, 70]` via StatExp `{hp:10000, atk:10000, def:10000, special:10000 (→spa=spd=100), spe:4900}`. Sum = 570 → scale 510/570 = 0.89473…. Scaled: hp=89.473, atk=89.473, def=89.473, spa=89.473, spd=89.473, spe=62.631. Floors `[89,89,89,89,89,62]` sum 507. Rems: hp=atk=def=spa=spd=0.47368… (5-way tie), spe=0.63157. Residual = 3. Hamilton: spe takes one (highest rem), then tied remainder → lowest index first → hp, then atk. Final `[90, 90, 89, 89, 89, 63]` sum 510.

**Binding fixture**: StatExp `{hp:10000, atk:10000, def:10000, spe:4900, special:10000}`, expected EV `[90, 90, 89, 89, 89, 63]`. This exercises the 5-way tie and the lowest-index-first tiebreak.

### A10. Remove nature-distribution "within 5% of uniform" language

PLAN §6.5 and §7 criterion 10 say "counts within 5% of uniform." The distribution is deterministic. Replace with "counts exactly `[52, 51, 51, 51, 51]`."

### A11. Document the "babies are kept per spec" design tension

HANDOFF §4.0's literal wording is contradictory (refuses Undiscovered + baby-prevos, but babies come from eggs in Gen 3). PLAN §5.3 correctly lists the 8 babies as refused per the literal spec. **Keep them refused** — the spec is authoritative — but the Generator must include a comment in `refused.ts` noting the tension and citing this amendment. A future sprint may revisit (it would be an S6+ change, not S1).

### A12. `sourcePersonalityBytes?: Uint8Array` — clarify semantics

PLAN §3.1 declares `sourcePersonalityBytes?: Uint8Array` on `Gen12Pokemon` with zero explanation. Gen 1/2 has no "personality" field. The Generator should treat this as: optional caller-supplied entropy bytes that, if present, get mixed into the `personalitySeed()` computation; if absent, `personalitySeed()` uses only `(otNameBytes || tid || speciesGen2Id || stable_dv_bytes)`. Document this in the doc-comment on the interface. Tests must cover both the undefined and supplied paths.

### A13. Add `README.md` content requirement

PLAN §2 lists `README.md` but §5 / §7 don't say what goes in it. Minimal contents required (the Code Evaluator will check):
- Project one-liner
- Sprint status (S1 complete: core conversion library)
- `bun install && bun test` instructions
- Link to HANDOFF.md
- No API docs (that's S4+)

### A14. Tighten criterion 11 snapshot surface

PLAN §7 criterion 11 says "exports exactly `convert`, `isRefusal`, and the types in §3.4 (snapshot-tested)." Snapshot the exported members *including* their TS shape via a `.d.ts` extract, not just the named members — otherwise renaming a field in `Gen3Intermediate` silently passes. Use `typescript` compiler API or just check the generated `dist/index.d.ts` contents against a committed snapshot.

### A15. `personal-gen3.json` transcription needs a cross-check

PLAN §5.4 relies on hand-transcribed Bulbapedia rows. Add a unit test that spot-checks 10 species (Bulbasaur, Pikachu, Mewtwo, Snorlax, Dragonite, Chikorita, Lugia, Ho-Oh, Celebi, Kingdra) against known values for `genderRatio`, `baseFriendship`, `ability0`. Hand-transcription of 251 rows is the #1 place typos will creep in.

---

## Open-question rulings

**1. Unown kept, not refused.** CONFIRM (with amendment A4 binding the rationale). HANDOFF §4.6 wins over §4.0's over-inclusive blanket.

**2. Ditto refused.** CONFIRM. Ditto × Ditto doesn't produce eggs; a bred-egg cover story is physically impossible. Planner's inclusion is defensible.

**3. Smeargle no special handling.** CONFIRM. Smeargle is Field egg group in Gen 3, breeds normally. Sketch moves pass through per §4.9. If a Sketched move is out-of-generation, that's a PKHeX legality flag for the player to resolve with the Move Deleter, exactly as §4.9 intends.

**4. Hand-transcribe personal info.** CONFIRM with amendment A15's spot-check test. Hand transcription is faster to review for this size (251 rows × 3 fields ≈ 753 values); scripted parsing of PKHeX's `personal_rs` binary is a distraction in S1. The spot-check test protects against typos.

**5. EV Case C canonical-order answer.** OVERRIDE / clarify. The Planner's reshuffled answer `[191, 191, 75, 0, 0, 53]` is **correct** (verified independently above in A3). But the plan text at §6.4 defers the assertion to "hand-compute" — A3 pins it as a binding expected value. CONFIRM the value, OVERRIDE the "hand-compute" language to "assert exactly `[191, 191, 75, 0, 0, 53]`."

**6. SHA-256 pure-TS sync.** CONFIRM with amendment A6 (NIST vector gate). Sync SHA-256 is the right call — `convert()` stays synchronous, the entire pipeline stays pure, and deterministic tests don't need `await`. Pure-TS is ~200 lines vendored; `@noble/hashes` would be the library choice if dependencies were permitted, but criterion 12 forbids that.

**7. PID-method roster.** OVERRIDE. See A5. HANDOFF says "Method 1/2/4" but the cover story is FRLG; the Generator must also reject H1/H2/H4. Three additional method detectors to implement.

**8. `pack()` stub in S1.** CONFIRM — omit. S2 will introduce it. Premature stubs will constrain S2 interfaces unnecessarily.

**9. Language default 2 (English).** CONFIRM. Gen 3 language IDs: 1 Japanese, 2 English, 3 French, 4 Italian, 5 German, 7 Spanish. Most Gen 2 International carts are English. For Japanese Gen 2 carts (future S3+ concern), the save-file reader will set the correct value. Default 2 is the right S1 choice. Add a comment in `types/source.ts` noting that S3 save reader may override.

**10. `otGender` on `Gen12Pokemon`.** CONFIRM — Gen 2 has OT gender on the Pokemon (byte 0x1F of the party struct), so it belongs with the source. Gen 1 lacks it; default 0 (male) is HANDOFF §7 convention. If the user wants to override per-conversion, they should edit the source model before calling `convert()`. Keeping it off `ConvertOptions` is correct.

---

## Refused-species audit

20 species enumerated in PLAN §5.3. Verifying each against Bulbapedia's "List of Pokemon by egg group" and "Baby Pokemon" articles:

| Gen2 ID | Species | Planner status | Verdict | Notes |
|---|---|---|---|---|
| 132 | Ditto | refused | **OK** | Ditto egg group; cannot produce Ditto eggs. |
| 144 | Articuno | refused | **OK** | Undiscovered, legendary. |
| 145 | Zapdos | refused | **OK** | Undiscovered, legendary. |
| 146 | Moltres | refused | **OK** | Undiscovered, legendary. |
| 150 | Mewtwo | refused | **OK** | Undiscovered, legendary. |
| 151 | Mew | refused | **OK** | Undiscovered, mythical. |
| 172 | Pichu | refused | **OK per spec** | Babies are Undiscovered in Gen 2; spec (§4.0) refuses. See A11. |
| 173 | Cleffa | refused | **OK per spec** | Same. |
| 174 | Igglybuff | refused | **OK per spec** | Same. |
| 175 | Togepi | refused | **OK per spec** | Same. |
| 236 | Tyrogue | refused | **OK per spec** | Same. |
| 238 | Smoochum | refused | **OK per spec** | Same. |
| 239 | Elekid | refused | **OK per spec** | Same. |
| 240 | Magby | refused | **OK per spec** | Same. |
| 243 | Raikou | refused | **OK** | Undiscovered, legendary beast. |
| 244 | Entei | refused | **OK** | Same. |
| 245 | Suicune | refused | **OK** | Same. |
| 249 | Lugia | refused | **OK** | Undiscovered, legendary. |
| 250 | Ho-Oh | refused | **OK** | Undiscovered, legendary. |
| 251 | Celebi | refused | **OK** | Undiscovered, mythical. |

**Contested — Unown (201):** NOT in refused list. **Correct** per amendment A4. Unown is Undiscovered egg group in Gen 2 PersonalInfo, but HANDOFF §4.6 explicitly requires Unown to convert. The Generator implements the §4.6 Unown letter constraint.

**Missing candidates checked and cleared:**
- 235 Smeargle — Field egg group, breeds normally. NOT refused. Correct.
- 202 Wobbuffet — Amorphous egg group in Gen 3 (Gen 2 Undiscovered pre-evo handling — pre-Wynaut, the Wynaut baby form doesn't exist until Gen 3). In Gen 2, Wobbuffet is breedable via Ditto. Not refused. Correct.
- 213 Shuckle — Bug egg group, breeds. Not refused. Correct.
- 234 Stantler — Field egg group. Not refused. Correct.
- 233 Porygon2 — Mineral egg group, breeds. Not refused. Correct.

**One gotcha flagged:** Nidorina (30) and Nidoqueen (31) are Undiscovered in Gen 2 but in Gen 3 their baby form Nidoran♀ is in Monster/Field egg groups. This means a Gen 2 Nidorina/Nidoqueen is not breedable IN GEN 2 but the Nidoran♀ that would hatch the egg IS breedable in Gen 3. The cover story "bred in FRLG" would have the egg come from a Nidorina mother → Nidoran♀ baby, but since the Gen 2 source IS Nidorina, the cover story breaks. **HANDOFF is silent on this.**

Recommendation: **do not add to refused set in S1.** The HANDOFF's refused list was curated deliberately; Nidorina/Nidoqueen pass the literal test ("can be hatched from an egg" — yes, as Nidoran♀, which then evolves). The legality question here is whether PKHeX flags a Gen 3 Nidorina with OT-hatched cover story as illegal. It shouldn't — the game lets you hatch a Nidoran♀, level it up, evolve to Nidorina → Nidoqueen. The hatched cover story works. KEEP both.

Same logic applies to Kangaskhan (115, Monster/Undiscovered), Tauros (128, Field), and ~15 other non-baby Undiscovered-in-Gen-2 species. All breedable in Gen 3 either directly or via Ditto. Planner correctly left them off the refused list.

---

## Test matrix gaps

1. **SHA-256 NIST vectors (A6)**. Without these the pure-TS impl can be subtly broken (e.g., endian mistake in final length field) and every downstream PID test passes against the broken hash.

2. **PID bounded search depth (A8)**. No test currently guards the "~10,000 max iterations" invariant. Add one.

3. **Hamilton forced tie (A9)**. Tied remainders + lowest-index-first tiebreak currently not exercised.

4. **SID stability across species (A7)**. `SID = SHA256(ot_bytes || tid_le).slice(0,2)` stability not tested.

5. **H1/H2/H4 rejection (A5)**. No test for FRLG wild-method avoidance.

6. **Unown PID search with constraint (PLAN §8.1/A4)**. `unown.test.ts` tests letter extraction but not that the full `searchPID()` path honours the constraint. Add an end-to-end Unown fixture (say, letter 'Q' via specific DVs) asserting `convert()` output decodes back to 'Q'.

7. **`preserveZeroDV=false` path**. PLAN §3.3 exposes the option; §6.3 tests it but not via `convert()` — just via `deriveIVs()`. Add an end-to-end `convert({..., dvs:{atk:0,...}}, {preserveZeroDV:false})` asserting `_meta.zeroDvOverridesApplied === []` and the emitted IVs span `{0,1}` over many seeds.

8. **§9 deviation row 3 (Charizard max-DV untrained)**. Max-DV means DV=15, so IV ∈ `{30,31}`. The stat-preservation harness must use the Gen 3 stat formula with level 100 and iterate over all 64 possible IV bit draws (2^6), not just "1000 seeds" — 1000 random seeds will likely miss corner cases. Pin to deterministic enumeration.

9. **§9 deviation row 5 (Snorlax max-trained) max ≤ 262**. Verify the 258→262 pad is defensible. HANDOFF says "max total dev 258." PLAN allows up to 262. Tighten to `max ≤ 260` unless the generator produces evidence that 260 is unreachable.

10. **Determinism — IV draw, not just PID**. PLAN §6.9 tests `convert(x) === convert(x)` deep-equal, which covers everything, but add a narrower test: `deriveIVs(src, seedRng(fixed_seed))` twice → identical — so an IV-RNG bug is caught even if PID/SID/etc. change.

11. **`hpDv(dvs)` 16 parity combos** (criterion 17). Already listed, good. Ensure the assertion snapshots all 16 results, not just passes/fails.

12. **OT-name round-trip stability for non-ASCII**. `strings.test.ts` tests ASCII and unmapped-char. Add a test for the é/ñ/♂/♀ cases that do have Gen 3 mappings (Gen 1/2 accented Latin map to Gen 3 bytes per `StringConverter3.cs` tables). Without this, the charmap tables will have unnoticed holes.

---

## Interface stability notes

**Gen3Intermediate (§3.2).** Will survive into S2. The packing encoder reads every field listed. Minor concern: `ribbons: readonly []` is strongly typed as empty tuple — S3+ (Gen 3→4 forward-transfer downstream) may want to preserve a "converted" ribbon. Keep as-is for S1 but expect to relax to `readonly number[]` later. **Flag, don't change.**

**ConvertOptions (§3.3).** Will grow in S2 (encryption-time options) and S3 (save-reader options). Currently stable.

**Refusal (§3.3).** S3 save reader will want additional `RefusalReason` values (`CORRUPTED_SAVE`, `CHECKSUM_MISMATCH`). The enum is open-ended in intent; just add values. **Flag, no action.**

**`Gen12Pokemon.sourcePersonalityBytes` (§3.1).** Undocumented per A12. Clarify and keep.

**Missing now, needed in S2:** a packed-struct interface like `Gen3PK3 extends Gen3Intermediate { packed: Uint8Array }` or a separate `PK3Packed` type. Don't add in S1 — wait for S2 design — but the Generator should not inline the "packed" concept into `Gen3Intermediate`.

**Missing now, needed in S3:** a `sourceSaveOffset?: number` or similar trace field on `Gen12Pokemon`. Not S1's concern.

**Draw-order stability (PLAN §4.1).** The documented order `hp, atk, def, spe, special` is load-bearing — ANY change invalidates all determinism tests. Add a code comment at `deriveIVs()` entry: `// Draw order is part of the public contract. Do not reorder.`

---

## Directory layout concerns

Mostly OK. Two notes:

- **`core/src/shinyGender.ts`** (outside `fields/`) vs. `core/src/fields/pid.ts` (inside) — inconsistent placement. Move `shinyGender.ts` into `fields/` or rename it to `helpers/shinyGender.ts`. Pick one convention.

- **`core/src/pidMethods.ts`** and **`core/src/unown.ts`** live at the top of `src/` rather than `fields/`. Same inconsistency. Recommendation: move both into `fields/` (they are implementation details of §4.6's PID derivation, not separate concerns).

- **`src/__internal__.ts`** — fine, but don't re-export it from `index.ts`. Test files should `import from '../../core/src/__internal__'` directly.

- **Missing `tests/harness/rng.ts`** (or similar) — a deterministic test-RNG factory for reproducing bug reports. Add.

- **`bun.lockb` committed** — correct per CLAUDE.md.

- **`web/` omitted** — correct, S5+ scope.

- **Workspace deps**: `tests` depends on `core` + `data`; `core` depends on `data`. Declare via `"dependencies": {"@pokeportal/data": "workspace:*"}` in each `package.json`. Flag this because Bun workspace syntax differs from npm/pnpm — verify `workspace:*` is the right resolver syntax for Bun 1.3.x. If not, fall back to relative file: paths.

---

## Risks flagged to Generator

1. **SHA-256 vendored impl is load-bearing.** Every PID, SID, and personality-seed test depends on it. If the Generator writes a SHA-256 impl from scratch and gets any step wrong (padding, bit-rotation direction, endian-ness in length encoding), every downstream test still "passes" because it's asserting against the same broken hash. Mitigation: A6 mandates NIST FIPS 180-2 test vectors as the gate. Run those FIRST before any other test.

2. **`floor(sqrt(65535))` in JavaScript.** `Math.sqrt(65535)` is `255.99803...` → `Math.floor` → `255`. Safe. But if the Generator uses `Math.round` or `|0` or anything else they may get `256`, which violates the "capped at 252" step if not clamped. Explicit: `Math.min(252, Math.floor(Math.sqrt(x)))`, never anything else.

3. **Hamilton tiebreak direction.** HANDOFF §4.3 step 5 says "tiebreak by lowest stat index." Generator must sort stable or use a secondary key. A naive `.sort((a,b) => b.rem - a.rem)` is NOT stable in all JS engines historically, but V8/Bun current = Timsort = stable. Still, use an explicit secondary key: `.sort((a,b) => b.rem - a.rem || a.idx - b.idx)` to be bulletproof.

4. **PID Method 1/2/4/H1/H2/H4 detection subtlety.** The method detectors compute RNG-backwards-search from the PID to see if any RNG seed produces the PID AND matches the Pokemon's IVs. This is the non-trivial part of PKHeX. DO NOT write this from scratch without porting PKHeX's `MethodFinder.cs` logic. Vendor the algorithm, or if that's too much S1 scope, reduce the ambition: implement a **conservative** detector that rejects PIDs where `rand_from_pid_via_method_1()[:ivs_expected] == actual_ivs`. Document the choice. For S1 we probably want conservative-and-documented over full-fidelity; the stretch is S2/S4.

5. **`Math.sqrt` precision.** IEEE 754 double precision is exact for `sqrt(n)` where `n` is a perfect square up to ~2^52. For `n = 65535`, `sqrt` is irrational, so `Math.sqrt(65535) === 255.99803...` is fine. But for `n = 10000`, `Math.sqrt(10000) === 100` exactly — verify the Generator tests confirm this rather than assuming.

6. **RNG bit-draw 50/50 fairness test.** `seedRng(seed).bit()` over 10,000 calls with 50/50 ±3σ — 3σ on 10,000 is ~150, so tolerance is 4850–5150. Write the test with that tolerance, not tighter. Don't expect exactly 5000.

7. **Unown letter extraction bit positions.** HANDOFF §4.6 Unown note gives the formula. PLAN §4.6 encodes it as `((pid>>24)&3)<<6 | ((pid>>16)&3)<<4 | ((pid>>8)&3)<<2 | (pid&3); letter %= 28`. Verify against PKHeX's `PKX.GetUnownForm(uint PID)` — that's the canonical. If the Generator gets the bit-extraction wrong, the Unown fixture test should catch it; the test must enumerate all 28 forms.

8. **`tid.to_bytes(2, 'little')` for SID derivation.** TID is uint16 little-endian. Write `new Uint8Array([tid & 0xFF, (tid >> 8) & 0xFF])`. A big-endian accident breaks SID stability across machines or test-runs differently, and the test in A7 will catch it.

9. **SHA-256 output endianness for PID.** `readU32LE(sha256(…).slice(0,4))` — the PLAN specifies LE. PID is stored as a u32 value in Gen 3 (it's conceptually a number, not bytes). As long as the same endianness is used consistently (both in the search and in the Gen 3 encoding layer, which is S2), it doesn't matter — but LE is the convention. Document.

10. **`readonly` tuple types.** TS strict mode is picky about `readonly [number, number, number, number]`. If any consumer does `moves.push(...)`, TS errors. Make sure the types are truly read-only everywhere including metadata mutators (`warnings` array etc.).

11. **Bun vs Node runtime.** `bun test` uses Bun's test runner, not vitest, despite PLAN §2 listing `vitest.config.ts`. Pick ONE: either Bun's built-in test runner (simpler, no dep) or vitest (more mature). If vitest, add `vitest` to root `devDependencies` and update CI. If Bun test, drop `vitest.config.ts`. **This is an inconsistency in PLAN §2 that must be resolved before coding starts.** Recommend: use Bun's built-in test runner (matches the `bun install && bun test` success criterion 1 literally, and keeps dep count at zero).

12. **`personal-gen3.json` schema typos.** See A15. The #1 bug-source in this sprint.

---

## Out-of-scope confirmations

Confirming PLAN §9 items really belong outside S1:

| Item | PLAN defer | Verdict |
|---|---|---|
| Gen 3 packing/encryption/checksum (§4.17) | S2 | **CONFIRM.** Correct boundary. The intermediate struct is the S1 deliverable; packing is a focused S2 task. |
| Gen 1/2 save parsing | S3 | **CONFIRM.** S1 accepts a typed source object, caller's responsibility. |
| Gen 3 save writer / delivery | S4 | **CONFIRM.** |
| PKHeX legality harness | S4+ stretch | **CONFIRM.** Requires a built Gen 3 save to feed PKHeX; can't run until S4. |
| Web UI / Web Serial / GBxCart | S5+ | **CONFIRM.** |
| Hidden Power preservation | Never | **CONFIRM.** Explicitly rejected in HANDOFF §4.5. |
| PCCS | Never | **CONFIRM.** HANDOFF §6. |
| EV redistribution toggle | Never | **CONFIRM.** HANDOFF §6. |
| Nature mode toggle | Never | **CONFIRM.** HANDOFF §4.4 ("No mode toggle"). |
| Japanese charmap | S3+ | **CONFIRM.** International English is S1; full I18N including Hiragana/Katakana ranges waits for when Japanese save parsing is in scope. |
| Moves Gen 2→Gen 3 remap | S2 sanity check | **CONFIRM.** HANDOFF §4.9 says "none do in practice" — a sanity check in S2 is appropriate. |
| Full item Gen 2→Gen 3 remap | S2 | **CONFIRM.** S1 does Gen-1-always-0 and Gen-2-identity-plus-known-invalid-mapped-to-0; that's enough to not block S1. |

No item pulled forward. No item deferred that should be in scope.

---

*End of PLAN_EVAL.*
