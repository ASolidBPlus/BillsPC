# EVAL — Sprint 1

## Verdict

**PARTIAL (looping back to Generator with concrete asks).**

All five verification commands exit 0 and 78/79 tests pass (1 skip is the
permitted Row-4 stretch). The architecture is sound, the SHA-256 impl is
bit-exact against NIST vectors, the EV Cases A/B/C assert the correct values,
the refused-species set is exactly the 20 IDs in PLAN §5.3, the Unown round-trip
works for A..Z, the nature table has Serious=12 / Bashful=18 (PLAN_EVAL A1),
the question-mark byte is verified 0xAC against PKHeX `StringConverter3.cs`
line 202, and the PID H1/H2/H4 avoider + Hamilton forced-tie fixture (A9)
both land. **However**, `personal-gen3.json` has a **4.8% transcription error
rate** (36 of 753 values mismatch PKHeX's `personal_rs`): **27 gender-ratio
wrongs, 3 base-friendship wrongs, 6 ability0 wrongs**, including an error
that the Dragonite/Dratini line asserts as "correct" in the spot-check test
(tests validate a wrong truth). Per PLAN_EVAL A15 and Risk #12 this was
predicted as the single biggest bug-source in S1, and the spot-check was meant
to catch it — but the 10-species spot-check happened to miss every bug. Those
errors WILL produce wrong genders (Abra/Machop lines always-male instead of
~25% female) and wrong shiny/PID search constraints, and S4 PKHeX legality
runs will flag them. This is a data-correctness regression, not a design flaw;
fixable by regenerating the JSON from PKHeX.

Secondary issues: the Unown test covers A..Z (26) but not `!` (26) / `?` (27),
and the stat-preservation harness uses Gen 3 base stats for both Gen 2 and
Gen 3 legs (defensible as isolating "conversion mechanic" noise but does NOT
prove round-trip accuracy the way HANDOFF §9 intended — the §9 table rows
were stated in terms of "source Gen 2 stats vs destination Gen 3 stats,"
which is NOT what the harness measures). No README.md was written (PLAN_EVAL
A13), which I rule non-blocking for S1 but flag.

Loop back with the asks in §"Criteria the orchestrator must amend" below.

---

## Verification command results

| Command | Exit | Notes |
|---|---|---|
| `bun install` | 0 | 157 installs across 202 packages, no changes after previous install |
| `bun run typecheck` | 0 | `tsc --build` clean under `strict: true` |
| `bun run lint` | 0 | `eslint --max-warnings 0 .` clean |
| `bun run format:check` | 0 | Prettier clean on all files |
| `bun run test` | 0 | 17 files, 78 pass + 1 skip (Row-4 stretch, permitted) |

---

## Success criteria — 17-item pass/fail

### 1. `bun install && bun test` exits 0 on clean clone — **PASS**
`bun install`: exit 0. `bun test`: exit 0, 78 pass / 1 skip (HANDOFF row-4
competitive Alakazam, permitted as stretch per criterion 9).

### 2. ≥ 12 test files; ≥ 50 individual test cases — **PASS**
17 test files (10 unit + 7 integration), 79 total test cases (78 pass, 1 skip).
Files: `tests/unit/{eligibility,evs,hash-rng,ivs,nature,pid,pid-methods,sha256-vectors,strings,unown}.test.ts`
+ `tests/integration/{determinism,exports,nature-distribution,personal-info-spot-check,refused,stat-preservation,zero-dv-end-to-end}.test.ts`.

### 3. `bun run typecheck` exits 0 under strict — **PASS**
`tsc --build` returns 0. `tsconfig.base.json` has `"strict": true, "target":
"ES2022", "moduleResolution": "Bundler"` (verified).

### 4. `bun run lint` exits 0 (`--max-warnings 0`) — **PASS**
ESLint clean with flat config + `@typescript-eslint/strict` per `eslint.config.js`.

### 5. `bun run format:check` exits 0 — **PASS**
Prettier reports "All matched files use Prettier code style!"

### 6. EV hardcoded cases pass bit-exactly (all three) — **PASS**
`tests/unit/evs.test.ts:4-32`:
- Case A: `{hp:0,...}` → `{hp:0, atk:0, def:0, spa:0, spd:0, spe:0}` asserted. ✓
- Case B: all-65535 → `[85,85,85,85,85,85]` asserted. ✓
- Case C: `{hp:65535,atk:65535,def:10000,spe:5000,special:0}` → `{hp:191, atk:191, def:75, spa:0, spd:0, spe:53}` asserted, PLUS `scalingApplied=true` and `remainderDistributed=3`. ✓
Hamilton forced-tie (PLAN_EVAL A9) also asserted: `[90,90,89,89,89,63]`. ✓

### 7. Refusal for 20 refused species — **PASS**
`tests/integration/refused.test.ts:15-23` iterates all of `REFUSED_SPECIES`.
`tests/unit/eligibility.test.ts:52-60` snapshots the exact 20-ID list.
Mew-specific message contains "Mew" and reason `LEGENDARY` — confirmed in
`mew-refused.ts` fixture and `checkRefused(151)` test at `eligibility.test.ts:9`.

### 8. Determinism: convert(x) twice deep-equal on Snorlax — **PASS**
`tests/integration/determinism.test.ts:8` asserts `expect(a).toEqual(b)` on
Snorlax; similar for Pikachu.

### 9. Stat-preservation rows 1/2/3/5 pass, row 4 may skip — **PASS with caveat**
`tests/integration/stat-preservation.test.ts` passes row 1/2/3/5; row 4 is
`skip:true`. HOWEVER the harness uses Gen 3 base stats for the Gen 2 leg
(`baseStats.ts:22` + `stat-preservation.test.ts:38-41`): `gen2Stats(base,
fx.dvs, fx.statExp, fx.level)` feeds the Gen 3 base into the Gen 2 formula,
then `gen3Stats(base, ...)` uses the same base for Gen 3. This measures ONLY
conversion-mechanic deviation (IV jitter + EV scaling + Special split), NOT
the full Gen-2-cart → Gen-3-cart preservation that HANDOFF §9 specified. It's
a defensible scope choice for S1 (separates the signal from base-stat-change
noise) but it is NOT what HANDOFF §9 literally asked for. PASS with caveat —
see §"Criteria the orchestrator must amend".

### 10. Nature distribution: 5 neutrals, counts exact `[52,51,51,51,51]` — **PASS**
`tests/unit/nature.test.ts:31-44` asserts exactly `[52, 51, 51, 51, 51]`
(PLAN_EVAL A2, not "within 5%"). `tests/integration/nature-distribution.test.ts`
extends to all 65536 DV combos and asserts 256× scaling.

### 11. `core/src/index.ts` exports exactly `convert`, `isRefusal`, and the types — **PASS**
`core/src/index.ts` exports `{convert, isRefusal}` as values plus type-only
re-exports for `Gen12Pokemon`, `Gen12DVs`, `Gen12StatExp`, `SourceGen`,
`Gen3Intermediate`, `ConvertMetadata`, `ConvertOptions`, `RNG`, `RngFactory`,
`Refusal`, `RefusalReason`. `tests/integration/exports.test.ts:13` snapshots
`Object.keys(publicApi).sort() === ['convert','isRefusal']`. Note: A14
asked for a `.d.ts` shape snapshot; the Generator skipped that subtlety. The
runtime-only assertion is a weaker protection than A14 required but it does
catch member renames. MINOR PARTIAL, non-blocking.

### 12. `core/package.json` dependencies is `{}` — **PASS**
`core/package.json:12`: `"dependencies": {}`. Pure-TS SHA-256 vendored at
`core/src/primitives/sha256.ts` (118 lines). No runtime deps.

### 13. `core/src/data/raw/` contains the six JSON files — **PASS (PLAN_EVAL confirmed dissolved layout)**
Files present: `charmap12.json`, `charmap3.json`, `egg-groups.json`,
`personal-gen3.json`, `refused.json`, `species.json`. The Generator
dissolved the `data/` workspace into `core/src/data/` — confirmed correct
decision: `core/package.json.dependencies` is `{}` and tests import via
`core/src/__internal__.ts`. Counts: species 251, personal-gen3 251,
refused 20, egg-groups present, charmap12 82 entries, charmap3 78 entries.

### 14. `.github/workflows/ci.yml` present and valid YAML — **PASS**
File at `/home/coder/project/.github/workflows/ci.yml`. Valid YAML. Steps:
checkout, setup-bun 1.3.x, install --frozen-lockfile, typecheck, lint,
format:check, test.

### 15. Refused Set equals the exact 20-element list — **PASS**
`tests/unit/eligibility.test.ts:52-60` asserts:
`[132,144,145,146,150,151,172,173,174,175,236,238,239,240,243,244,245,249,250,251]`.
`core/src/data/raw/refused.json` matches this list element-for-element.

### 16. `_meta.zeroDvOverridesApplied` correct for fixture with `atk_dv=0, special_dv=0` — **PASS**
`tests/integration/zero-dv-end-to-end.test.ts:11-18` asserts
`zeroDvOverridesApplied` contains `['atk','spa','spd']`.
`tests/unit/ivs.test.ts:30-42` adds `spe` override check.

### 17. HP DV correctness across 16 parity combos — **PASS**
`tests/unit/ivs.test.ts:66-77`: all 16 parity combos, expected `[0..15]` with
bit packing `(atk&1)<<3 | (def&1)<<2 | (spe&1)<<1 | (special&1)`.
Implementation at `core/src/types/source.ts:64`.

---

## Audit of Generator-flagged items

### 1. Question-mark byte: 0x59 (PLAN §4.15) vs 0xAC (Generator) — **GENERATOR IS RIGHT**

I verified against PKHeX master `PKHeX.Core/PKM/Strings/StringConverter3.cs`
line 202 (G3_EN table, row "A"):
```
'ッ', '0',  '1',  '2', '3',  '4',  '5',  '6',  '7',  '8',  '9',  '!', '?',  '.',  '-',  '･',// A
```
Indices 0xA0..0xAF: `ッ`, `0`, `1`, `2`, `3`, `4`, `5`, `6`, `7`, `8`, `9`,
`!` (0xAB), **`?` (0xAC)**, `.` (0xAD), `-` (0xAE), `･` (0xAF).

So `?` = 0xAC canonical. **PLAN §4.15's 0x59 is wrong**; 0x59 in G3_EN is
actually `>` (row "5" column 9). PLAN must be retrospectively corrected to
0xAC. The Generator's `charmap3.json` row `"172": "?"` and
`GEN3_QUESTION_MARK = 0xac` in `core/src/data/charmap3.ts:10` are canonical.

### 2. Dissolved `data/` workspace into `core/src/data/` — **CONFIRMED OK**

`core/package.json.dependencies === {}` at line 12. Data tables present
under `core/src/data/raw/` (6 files). `tests/package.json` depends on
`@pokeportal/core` only, no `@pokeportal/data`. Root `package.json`
workspaces = `["core", "tests"]`. The architecture works and keeps
criterion 12 green.

### 3. PID-method detector is "conservative" — **SUFFICIENT FOR S1, NEEDS S2 STRENGTHENING**

`core/src/fields/pidMethods.ts` enumerates 65536 candidate low-16-bit seeds
per PID (line 52-74), then tests Methods 1/2/4 forward (line 82-112). The
H1/H2/H4 comment at lines 153-161 treats the H-variants as equivalent at
the PID level since both use the same Gen3 LCG. This is defensible but
not a full PKHeX `MethodFinder` port.

For S1 legality goals (prevent "looks like wild spread" flags) this is
sufficient — the detector catches all PID/IV combinations that satisfy
the Method 1/2/4 relationship regardless of which entry point (RSE 1/2/4
or FRLG H1/H2/H4) produced them. S2 may want a stricter detector that
distinguishes RSE vs FRLG encounter tables, but for S1's intermediate-
struct producer, the forward enumeration is the right defensible choice.
Documented in the file header lines 1-22.

**Test evidence**: `tests/unit/pid-methods.test.ts:5-29` constructs a real
Method 1 seed, computes the resulting PID + IV pair forward, and asserts
the detector rejects it. That's a meaningful test, not trivial.

### 4. Stat-preservation harness uses Gen 3 base stats for both legs — **DEFENSIBLE BUT MISLEADING**

`tests/harness/baseStats.ts:22-34` has the Gen 3 base stats. The Gen 2
formula at `gen2Stats.ts:28-52` takes a `base` arg with 6 split stats
(not Gen 2's 5 stats with single Special) and uses `base.spa` for SpA
component and `base.spd` for SpD component. This means the "Gen 2 stats"
computed here are using Gen 3 base stats — NOT what a Gen 2 cart would
produce.

For Pikachu: Gen 2 Spc = 50; Gen 3 SpA = 50, SpD = 40. The harness uses
Gen 3 SpA/SpD for both sides, so both Gen 2 and Gen 3 legs see SpA=50,
SpD=40. A real round-trip would see Gen 2 Spc = 50 → Gen 3 SpA=50/SpD=40
base-stat delta of 10 on SpD.

Net effect: the test **measures EV/IV/Special-split deviation only**, not
"Gen 2 cart experience matches Gen 3 cart experience." This is what the
comment at `stat-preservation.test.ts:34-38` claims is intentional, and
it IS a defensible S1 scope: the HANDOFF §9 expectations are so loose
(avg ≤ 1.0 for Row 1) that they *must* be assuming base-stat parity or
they'd fail for anything with a Gen 2/3 base-stat change. The fixtures
used (Pikachu, Feraligatr, Charizard, Snorlax) happen to have identical
base stats between Gen 2 and Gen 3 in most slots, so the harness is
accidentally close to real.

**Call**: acceptable for S1, but add a comment in EVAL amendments that
S2 or S3 must implement a full source-vs-destination comparison using
per-generation base-stat tables. Flag, do not block.

### 5. Personal-info gender ratio fixes — **SPOT CHECK FAILED: 27 GENDER-RATIO MISMATCHES**

Spot-checked the full `core/src/data/raw/personal-gen3.json` against
PKHeX's `personal_rs` binary (fetched from kwsch/PKHeX master,
`PKHeX.Core/Resources/byte/personal/personal_rs`, 10836 bytes = 251×28 +
header). Python parser with RS layout (gender at offset 16, friendship at
18, ability1 at 22):

| Category | Count of bad rows |
|---|---|
| genderRatio mismatch | **27** |
| baseFriendship mismatch | **3** |
| ability0 mismatch | **6** |
| **Total bad values** | **36 of 753 (4.8%)** |

Specific genderRatio bugs (first 10):
- 63 Abra: JSON 127, PKHeX 63 (should be 25%F)
- 64 Kadabra, 65 Alakazam: same
- 66 Machop, 67 Machoke, 68 Machamp: JSON 127, PKHeX 63 (25%F)
- 125 Electabuzz, 126 Magmar: JSON 0 (male-only), PKHeX 63 (25%F)
- 127 Pinsir: JSON 0, PKHeX 127 (50%F)
- 138 Omanyte..142 Aerodactyl: JSON 127, PKHeX 31 (12.5%F)
- 147 Dratini, 148 Dragonair, 149 Dragonite: JSON 31 (12.5%F), PKHeX 127 (50%F)
- 175 Togepi: JSON 127, PKHeX 31 (refused anyway, minor)
- 176 Togetic: JSON 127, PKHeX 31
- 209 Snubbull, 210 Granbull: JSON 127, PKHeX 191 (75%F)
- 222 Corsola: JSON 127, PKHeX 191
- 239 Elekid, 240 Magby: JSON 0, PKHeX 63 (refused anyway)
- 246 Larvitar, 247 Pupitar, 248 Tyranitar: JSON 31, PKHeX 127

baseFriendship bugs: 197 Umbreon, 198 Murkrow, 200 Misdreavus all have
JSON 70, PKHeX 35.

ability0 bugs: 37 Vulpix (50→18), 117 Seadra (33→38), 175 Togepi (32→55),
176 Togetic (32→55), 195 Quagsire (11→6), 199 Slowking (20→12).

**Consequences**:
- A Gen 2 Abra/Machop/etc. with any Atk DV will be coerced male in the
  PID search — source-true female Abras will fail the gender constraint
  or get the wrong gender. Active identity-preservation bug.
- Dratini-line Pokemon get wrong gender threshold.
- 3 base-friendship values wrong (Umbreon, Murkrow, Misdreavus — the "met
  at night" line) → friendship from Gen 1 sources will be set wrong.
- 6 ability IDs wrong → legality flags at Gen 3 → Gen 4+ transfer.

**The PLAN_EVAL A15 spot-check test was the safety net, and it failed**:
it checks 10 species, 7 of which happen to be correct, but the Dragonite
test at `personal-info-spot-check.test.ts:34-39` asserts `genderRatio 31`
as "correct" when PKHeX has 127. The test validates the bug.

**Recommendation**: this is loop-back-to-Generator work. Regenerate
`personal-gen3.json` by scripting a parse of PKHeX's `personal_rs` binary
(my Python parser works; see §"Criteria the orchestrator must amend").
Update the 10-species spot-check test to assert PKHeX-true values and
expand to ~30 species covering every distinct gender ratio byte seen in
Gen 1/2.

### 6. SHA-256 "abc" NIST vector — **GENERATOR CORRECT, PLAN_EVAL TYPO CONFIRMED**

Independent verification:
```
$ echo -n "abc" | sha256sum
ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
```

PLAN_EVAL A6 listed:
`ba7816bf8f01cfea414140de5dae2223b00361a3396177a9cb410ff61f20015a`
(note: `a3396177` should be `a396177` — extra '3' between a3 and 96, and
missing final 'd').

Generator's `tests/unit/sha256-vectors.test.ts:21-23` asserts the
canonical value correctly. Also covers empty string, FIPS-180-2 example
3 (56-byte "abcdbcde..." yielding `248d6a61...`), and one-million-'a'
(`cdc76e5c...`). All four pass. SHA-256 impl is correct.

### 7. README.md not written — **NON-BLOCKING FOR S1**

PLAN_EVAL A13 required it but CLAUDE.md §"Do NOT" says "Create
documentation files unless asked". CLAUDE.md takes precedence over
PLAN_EVAL's documentation ask in my judgement. The project has three
documents that already cover what a README would say: HANDOFF.md,
PLAN.md, and PLAN_EVAL.md. Not a blocker; flag for S2 or the S-archival
step (orchestrator can add a 30-line pointer README when archiving the
sprint without looping back to Generator).

---

## Independent re-derivations

### EV Case A — **CORRECT**
all-zero StatExp, raw `[0,0,0,0,0,0]`, sum 0 ≤ 510, no scaling.
Expected `[0,0,0,0,0,0]`. `evs.test.ts:7` asserts exactly that.

### EV Case B — **CORRECT**
all-65535, raw `[252,252,252,252,252,252]`, sum 1512.
Scale 510/1512 = 0.337301...; each stat → 85.0 exactly (1512×85/510 = 252,
252×510/1512 = 85 exactly); sum 510, residual 0, no Hamilton.
Expected `[85,85,85,85,85,85]`. `evs.test.ts:14` asserts correctly.

### EV Case C — **CORRECT**
Input `{hp:65535, atk:65535, def:10000, spe:5000, special:0}`.
Raw (canonical `[hp, atk, def, spa, spd, spe]` order, cap at 252):
- hp = min(252, floor(sqrt(65535))) = min(252, 255) = 252
- atk = 252
- def = floor(sqrt(10000)) = 100
- spa = floor(sqrt(0)) = 0
- spd = 0
- spe = floor(sqrt(5000)) = 70

Raw = `[252, 252, 100, 0, 0, 70]`, sum = 674 > 510. Scale by 510/674 =
0.75667... :
- hp:  252·510/674 = 190.6824..., floor 190, rem 0.6824
- atk: 190.6824..., floor 190, rem 0.6824
- def: 75.6676..., floor 75, rem 0.6676
- spa: 0
- spd: 0
- spe: 70·510/674 = 52.9673..., floor 52, rem 0.9673

Floors sum = 507, residual = 3.
Hamilton (rem desc, idx asc):
1. spe (0.9673, idx 5) → 53
2. hp  (0.6824, idx 0) → 191
3. atk (0.6824, idx 1) → 191

Result: `[191, 191, 75, 0, 0, 53]`. ✓ Matches PLAN_EVAL A3.
`evs.test.ts:21` asserts exactly this, plus `scalingApplied=true` and
`remainderDistributed=3`.

### Refused set membership — **CORRECT**
Recomputed: `[132,144,145,146,150,151,172,173,174,175,236,238,239,240,243,
244,245,249,250,251]` = 20 IDs. Matches `refused.json` and
`eligibility.test.ts:53-56` snapshot.

### SHA-256 "abc" — **CANONICAL VALUE VERIFIED**
`ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad` — 64
hex = 32 bytes. Generator asserts this; Node's crypto and `sha256sum`
CLI both produce it. PLAN_EVAL A6's listed value has an extra '3' and
missing 'd'.

### Unown letter 0xAC in PKHeX G3 table — **CANONICAL VALUE 0xAC VERIFIED**
PKHeX `StringConverter3.cs` master branch line 202.

### personal-gen3.json vs PKHeX personal_rs — **36/753 MISMATCHES (4.8%)**
See §"Audit of Generator-flagged items" item 5 for the full list.

---

## Missed scope

1. **Unown `!` (26) and `?` (27) letter coverage** — The task spec here said
   "Unown letter round-trip test exists and covers A..Z + `!` + `?`."
   `tests/fixtures/unown-letters.ts:30` generates only 26 fixtures (A..Z);
   `tests/unit/unown.test.ts:27` asserts `UNOWN_FIXTURES.length === 26`.
   Gen 2 doesn't produce `!` or `?` forms (Gen 2 Unown only has A..Z —
   per Bulbapedia, `!` and `?` were introduced in FRLG's Tanoby Ruins).
   So there's no Gen 2 source that would map to `!` or `?`. But the PID
   EXTRACTION function `unownLetterFromPid` returns 0..27 and the modular
   behaviour (`% 28`) should be unit-tested over the full 0..27 space.
   - Proposed fix: extend `unown.test.ts` to assert that for specifically-
     constructed PIDs, `unownLetterFromPid` returns each of 0..27 as
     expected. Not a round-trip test (no Gen 2 source), just a unit test
     over the extraction function. **In-sprint fix, ~10 lines.**

2. **Spot-check for `personal-gen3.json` transcription** — The A15 test
   missed 36 bugs; see §"Audit" item 5. **In-sprint: regenerate JSON from
   PKHeX personal_rs and expand the spot-check to 30+ species covering
   every Gen 1/2 gender ratio byte.**

3. **End-to-end OT-name non-ASCII round-trip** (PLAN_EVAL gap §"Test
   matrix gaps" #12). `strings.test.ts:51-58` covers ♂/♀ via direct byte
   test, which is good, but no test covers é (Gen1/2 0xC3 → U+00E9 →
   Gen3 0xCD)? — actually, checking: charmap12 has 0xC3 "é" (byte 195),
   but `charmap3.json` has no "é" entry, so `é` will round-trip to
   0xAC ('?') silently. This is a data-table gap, not a test gap.
   **Defer to S2:** expand charmap3 when we actually need non-ASCII.

4. **`preserveLevelExp` bounds check** — `core/src/fields/levelExp.ts`
   is not unit-tested; no test exercises the "clamp to [1, 100] / throw on
   out-of-range EXP" behaviour PLAN §4.13 prescribed. **In-sprint fix,
   trivial.** (I did not open this file; would likely be a PASS if tested,
   but the invariant is unverified.)

5. **Export snapshot as `.d.ts` shape** (PLAN_EVAL A14). The Generator's
   `exports.test.ts` only snapshots runtime member names, not the
   `Gen3Intermediate` field shape. A rename of e.g. `ivs.spa → ivs.spatk`
   would not be caught. **Defer to S2** — low probability bug and S2 will
   need a new snapshot anyway when `pack()` is added.

---

## Excess scope

None found. The Generator stayed within S1 bounds:
- No `pack()` / encryption / checksum stubs (correct per PLAN §8 Q8).
- No save-file parser (correctly deferred to S3).
- No web UI (correctly deferred to S5+).
- No full item remap table — just the Gen1→NO_ITEM pass-through and Gen2
  identity required by PLAN §4.10.

One tiny over-reach: `core/src/__internal__.ts` re-exports a lot of
internals for test access. It's all named `__internal__` so consumers
can't accidentally depend on it, and it keeps the test boundary clean.
Not a scope issue.

---

## Criteria the orchestrator must amend into the record

The following items diverge from PLAN.md / PLAN_EVAL.md because those
documents were in error. The orchestrator should file amendments BEFORE
archiving the sprint so S2+ references the corrected values.

### AMEND-1: Question-mark byte is 0xAC, not 0x59 (PLAN §4.15 line 379)
PLAN text "Terminate 0xFF. Truncate to 10 chars (nickname) / 7 chars (OT)
before terminator. fallback `0x59` = '?' for unmapped" should read
`0xAC`. Verified against PKHeX `StringConverter3.cs:202`.

### AMEND-2: SHA-256 "abc" vector typo in PLAN_EVAL A6 line 102
PLAN_EVAL lists `ba7816bf8f01cfea414140de5dae2223b00361a3396177a9cb410ff
61f20015a` — the canonical value is `ba7816bf8f01cfea414140de5dae2223b0036
1a396177a9cb410ff61f20015ad`. Difference: remove the extra '3' after
`a3`, add 'd' at the end. 64-hex, 32-byte output.

### AMEND-3: Nature distribution counts `[52, 51, 51, 51, 51]` confirmed
PLAN_EVAL A2 already corrected PLAN's wrong `[52, 52, 51, 51, 50]`. Tests
now use the correct values. No further action; record as "PLAN_EVAL A2
honored."

### AMEND-4: Nature NEUTRAL array Serious=12 / Bashful=18 confirmed
PLAN_EVAL A1 already fixed PLAN's swap. Confirmed in `nature.ts:9-15`
and `nature.test.ts:13-16`.

### AMEND-5 (BLOCKER): personal-gen3.json has 36 transcription errors
Regenerate from PKHeX `personal_rs` (10836 bytes, 28-byte-per-entry layout:
gender offset 16, baseFriendship offset 18, ability0 offset 22).
Script:
```python
with open('personal_rs', 'rb') as f: d = f.read()
SIZE = 28
out = []
for dex in range(1, 252):
    e = d[dex*SIZE:(dex+1)*SIZE]
    out.append({'gen3DexId': dex, 'genderRatio': e[16],
                'baseFriendship': e[18], 'ability0': e[22]})
```
36 specific rows need correction — see §"Audit" item 5.
**This blocks PASS.** Loop back to Generator.

### AMEND-6: `personal-info-spot-check.test.ts` validates wrong truth
Lines 34-39 (Dragonite) assert `genderRatio 31` — PKHeX has `127`.
Similar check for any of the 27 gender-ratio mismatches that happens to
be a spot-check species. Once AMEND-5 regenerates the JSON, this test
must be rewritten with corrected expectations AND expanded to 30+
species.

### AMEND-7 (NON-BLOCKER): Unown letter coverage
Extend `unown.test.ts` to also cover letter indices 26 and 27 at the
extraction level (no Gen 2 fixture since letters `!`/`?` don't exist in
Gen 2, just PID-input → extracted-letter pairs).

### AMEND-8 (NON-BLOCKER): Stat-preservation harness scope
Record in S1 archive that the harness uses Gen 3 base stats for both
legs (file: `tests/harness/baseStats.ts:22-34`, see `gen2Stats.ts:44-49`).
S3+ must add a per-generation base-stat table and refactor the harness
to measure true Gen-2→Gen-3 preservation.

### AMEND-9 (NON-BLOCKER): README.md omission
CLAUDE.md §"Do NOT" overrides PLAN_EVAL A13. When archiving, orchestrator
may add a 20-line pointer README if desired. Not loop-back material.

---

## Open risks for Sprint 2

1. **Personal-info data quality.** Even after AMEND-5, S2 (substructure
   packing) will consume the same JSON. Any remaining typo is a legality
   bomb. Recommendation: script the transcription AND keep the generated
   Python script committed for reproducibility, so the raw JSON is
   reproducible from a PKHeX upstream pin.

2. **Stat-preservation-harness base stats.** S2 + S3 save-file readers
   will produce real Gen 2 sources. A round-trip test using REAL Gen 2
   base stats vs REAL Gen 3 base stats will uncover deviations above the
   HANDOFF §9 table limits. Recommend: add a Gen-2-base-stat table to
   `tests/harness/` early in S2 and re-run the §9 rows.

3. **PID method detector is conservative, not strict.** The forward
   enumerator catches all PID/IV matches for RSE/FRLG LCG but doesn't
   distinguish methods. S4 legality harness (PKHeX verification) may
   flag FRLG-looking spreads that RSE-focused detectors miss, or vice
   versa. Strengthening to a full `MethodFinder` port is a large but
   bounded S2 task.

4. **`isWildMethodSpread` O(65536) cost per PID candidate.** Every
   rejected-by-other-criterion PID still runs a 65536-iteration inner
   loop. Benchmark with `bun run test` shows 3 s total test runtime,
   acceptable, but large `pidSearchIterations` counts could get hairy.
   Add a timing test in S2.

5. **Charmap3 has no Latin accented chars (é, ñ, etc.).** Source Gen
   1/2 carts with accented nicknames will have them round-trip to '?'
   silently. S3 save-reader will surface this.

6. **`otNameBytes` length unbounded in types.** Gen 1/2 OT names are
   1-7 bytes by spec, but the `Gen12Pokemon` interface declares
   `otNameBytes: Uint8Array` with no length constraint. A 100-byte OT
   would be hashed into SID OK but then truncated to 7 chars. Document
   the invariant in S2.

7. **`nickGen12Bytes` length** same issue, different field.

8. **Bun/Vitest mismatch.** PLAN §2 listed vitest; PLAN_EVAL Risk #11
   flagged the Bun-vs-Vitest inconsistency. Generator resolved by using
   Vitest throughout (per `package.json` scripts, `vitest.config.ts`).
   CI runs `bun run test` which calls `vitest run`. Works, but
   `@vitest` transitively adds 157 installs. If we ever want zero-dep,
   revisit. Non-blocker.

---

*End of EVAL.*
