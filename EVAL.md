# EVAL — Sprint 2

## Verdict

**PARTIAL** — loop back to Generator with concrete asks. The byte-level wire
format (substructures, shuffle, encryption, checksum, party tail) is solid
and matches PKHeX/Bulbapedia spec. Round-trip, party-tail, oracle-B, and
PID%24 coverage are real, not insurance. However, three PLAN_EVAL **binding
amendments** are violated in code: A9 (species range upper bound 386, not
412), A16 (`pidSearchIterations` should be 0, not -1), and A17 (no spot-check
asserting the new `PersonalInfo.base` field — the highest-bug-density risk
area per A17, and the area S1 already had a 36-error transcription incident
in). Each is a small, surgical fix; none invalidate the wire format, but
they are explicit binding rulings the Generator was told to respect. One
non-blocking environmental note: `format:check` fails on
`scripts/demo-red-boxes.ts` — orchestrator's parallel demo file, not S2
scope, but the verification command exits non-zero so success criterion 3
is technically not met.

## Verification command results

| Command            | Exit | Notes |
|--------------------|-----:|-------|
| `bun install`      | 0    | clean, no changes |
| `bun run typecheck`| 0    | tsc --build |
| `bun run lint`     | 0    | eslint --max-warnings 0 |
| `bun run format:check` | **1** | prettier flags `scripts/demo-red-boxes.ts`. Demo file is orchestrator's parallel work per evaluator instructions; not S2 code. **But § 9 criterion 3 demands exit 0.** |
| `bun run test`     | 0    | 26 files, **171 passed**, 1 skipped (Alakazam stretch, S1-permitted) |

Test-file growth: S1 archive lists 17 test files; S2 added 9 (gen3-substructures, gen3-shuffle, gen3-crypt, gen3-checksum, gen3-stat-parity, decode-errors, gen3-roundtrip, gen3-party-record, gen3-pkhex-vector). Total 26 ✓ (matches Generator self-report).

## Substructure layout audit

Cross-checked `core/src/pack/{growth,attacks,evsCondition,misc}.ts` against
PKHeX `PK3.cs` and Bulbapedia "Pokemon data substructures (Generation III)".
All four are byte-correct.

| Substruct | Layout | Verdict |
|-----------|--------|---------|
| Growth (G) | u16 species @0, u16 item @2, u32 exp @4, u8 ppBonuses @8, u8 friendship @9, u16 pad @10..11 | OK |
| Attacks (A) | 4× u16 moves @0..7, 4× u8 PP @8..11 (masked `& 0x3F` per A15) | OK |
| EVs/Cond (E) | 6× u8 EVs @0..5 in **HP/Atk/Def/Spe/SpA/SpD** wire order (speed before specials, correctly reordered from intermediate's hp/atk/def/spa/spd/spe), 6× u8 contestStats @6..11 | OK |
| Misc (M) | u8 pokerus, u8 metLoc, u16 originsInfo, u32 ivsEggAbility, u32 ribbonsAndObedience | OK |

`originsInfo` u16 packing — metLevel[0..6] (7), originGame[7..10] (4), ball[11..14] (4), otGender[15] (1) — matches A14 exactly. With S1 invariants (metLevel=5, FRLG=4, Pokeball=4, otGender=0) the magic value is `0x2205`, which the round-trip and oracle-B vectors implicitly confirm.

`ivsEggAbility` u32 packing — HP[0..4], Atk[5..9], Def[10..14], Spe[15..19], SpA[20..24], SpD[25..29], isEgg[30], abilityBit[31] — matches A2 (the rename from "hasHiddenAbility" is correctly applied). Bit 31 named `abilityBit`, not `hasHiddenAbility`. All bitwise pack/unpack uses `>>> 0` and `u32(...)` to dodge JS signed-int hazards.

`ribbonsAndObedience` u32 — production writes literal 0 always (consistent with S1 invariants). On decode, any non-zero value yields `UNEXPECTED_LITERAL_FIELD`. PLAN_EVAL A3 documented; semantic bit-31-as-obedience documented in code comments.

Endianness: every u16/u32 read/write goes through `leBytes.ts` (LE). No endian drift anywhere.

**No layout errors.**

## PID%24 table audit

Independently re-derived the 24 lex-ordered permutations of {G,A,E,M} via
a permutation generator. Diffed row-by-row against
`core/src/pack/gen3Shuffle.ts` `PERMUTATION` table — **all 24 rows
identical**, in the exact lexicographic order PLAN_EVAL specifies (G-leads
0..5, A-leads 6..11, E-leads 12..17, M-leads 18..23). `INVERSE` is
correctly derived as `tag→slot` lookup per row.

`pidPermIndex` correctly normalises to `(pid >>> 0) % 24` to avoid
signed-int negative-mod hazards (test verifies with `pid = 0x80000001`).

Shuffle test (`gen3-shuffle.test.ts`) covers all 24 rows with
distinguishable per-substructure marker bytes (per A7); correctly fails
loud if any single slot regresses.

## Encryption / checksum audit

- **Key formula**: `key = u32(pid) ^ u32((sid<<16)|tid)`. Matches PKHeX `PKX.cs#DecryptArray3`. ✓
- **XOR mechanics**: 12 LE u32 words of the 48-byte block, no per-word rotation, self-inverse. ✓
- **Endianness**: LE throughout, isolated in `leBytes.ts`. ✓
- **Checksum**: sum of 24 u16 LE words of the **decrypted, post-shuffle** block, `& 0xFFFF` only at the end. Final-mask edge case (`0x10000 → 0`) is explicitly tested in `gen3-checksum.test.ts`. ✓
- **JS signed-int safety**: every PID-derived value passes through `u32()`; bitwise XOR results normalised before write. ✓
- Edge cases tested: key=0 (no-op), key=0xFFFFFFFF (bitwise NOT), all-FF block, single-word, overflow wrap.

**No corrections required.**

## Party-tail audit

`core/src/pack/party.ts` lays out the 20-byte tail at offsets 80..99 as:
status u32 @80, level u8 @84, mailId u8 @85, currentHP u16 @86, maxHP u16
@88, atk @90, def @92, **spe** @94, spa @96, spd @98 — speed before
specials. Matches PKHeX `PK3.cs` exactly (cross-ref PLAN_EVAL §"Party-tail
audit").

- `currentHP === maxHP` confirmed by both code and `gen3-party-record.test.ts` (asserts both equal `computeGen3Stats(...).hp`).
- Stats computed via production `computeGen3Stats`, not stored in `Gen3Intermediate`. Test asserts every stat field byte-by-byte against the formula for 3 fixtures (Snorlax/Alakazam/Pikachu).
- First 80 bytes of `packParty` deep-equal `packBoxed` output (per A12). ✓

## Oracle test audit

**Real and independent, not circular insurance.** Read `scripts/gen-pkhex-vector.ts` carefully:

- Imports only `convert`, `isRefusal`, `Gen3Intermediate` type, and the source-side test fixtures from `tests/fixtures/`. **No imports from `core/src/pack/*`.**
- Reimplements LE helpers (`r16/w16/r32/w32`), the four substructure encoders (`encodeG/A/E/M`), the 24-row PERMUTATION table (transcribed from PLAN_EVAL spec, not imported), `shuffle`, `checksum48`, `xorEncrypt`, name padding, and the top-level `packBoxedOracle` from spec.
- Output JSON `tests/fixtures/pkhex/oracle-vectors.json` ships 5 fixtures (pikachu / feraligatr / snorlax / alakazam / partial-trained), each a unique species/PID with non-trivial bytes.
- The test (`gen3-pkhex-vector.test.ts`) runs production `packBoxed(convert(src))` and asserts byte-by-byte equality against the committed hex strings, with a clean per-offset diagnostic on divergence.

If the production code or the oracle ever drifts, the test fails with an
informative offset. Real divergence-detector. Meets PLAN_EVAL A4 / A8.

## Round-trip test audit

`tests/integration/gen3-roundtrip.test.ts` runs `convert → packBoxed → unpackBoxed` over 6 fixtures (pikachu, feraligatr, charizard-maxdv, alakazam-competitive, snorlax-maxtrained, partial-trained) and asserts deep equality via `tests/harness/intermediateEquals.ts`.

Comparator audit: `intermediateDeepEqualExceptMeta` compares **every** field except `_meta`, `level`, and `nature`. The `level`/`nature` skip is correct (boxed wire doesn't carry them — both are derived/party-tail-only and `unpackBoxed` cannot recover them). `_meta` skip is correct per PLAN_EVAL A5; comparator additionally asserts the decoded `_meta.warnings` contains the `decoded-from-bytes:` sentinel. The comparator does deep-compare `evs.spe`, `ivs.spe`, `contestStats.{cool,beauty,cute,clever,tough,sheen}`, all 4 ribbon-length, `markings`, etc. **No accidental skips.**

Comparator returns a `{path, a, b}` discriminator on divergence rather than just `false` — caller logs path. Solid.

## Stat-formula parity test audit

`tests/unit/gen3-stat-parity.test.ts` does run 100 random fixtures via xorshift32 (deterministic seed `0xC0FFEE`) through both `computeGen3Stats` (production) and `gen3Stats` (harness), asserts `expect(prod).toEqual(ref)` per fixture for **neutral natures only** (the 5 IDs S1 emits). For non-neutral natures, the harness deliberately stubs nature multiplier to 1.0× and the test correctly only asserts HP equality (HP is nature-immune). This is honest scoping — production correctly implements the full 25-row × 5-stat table; harness is intentionally less capable.

The 100-iteration random fixture coverage is real — base/IV/EV/level all swept randomly, deterministic.

## Decode-error test audit

`tests/unit/decode-errors.test.ts` covers 7 reasons:

| Reason | Coverage |
|--------|----------|
| `BAD_LENGTH` | ✓ negative tests for length 79 and 81; asserts typed `reason` |
| `CHECKSUM_MISMATCH` | ✓ flips a checksum bit; asserts `reason` |
| `SPECIES_OUT_OF_RANGE` | ✓ overwrites slot-0 u16s with 0; asserts `reason` |
| `BAD_NICKNAME_BYTES` | ✓ data-after-terminator construct |
| `BAD_OTNAME_BYTES` | ✓ data-after-terminator construct |
| `UNEXPECTED_LITERAL_FIELD` | ✓ sets isEgg bit-30 of every slot's IV word, asserts `reason` |
| `BAD_SUBSTRUCT_ORDER` | **Smoke-only** — comments admit "guarded internally; reason exists in union". Does not exercise the actual code path. The path is unreachable from public input (PID%24 is always 0..23), so this is acceptable, but worth flagging. |

The `UNEXPECTED_LITERAL_FIELD` case only exercises the isEgg-bit-30 trigger.
The reason fires from many other paths (metLocation≠146, metLevel≠5,
abilityBit≠0, ball≠4, originGame≠4, ribbons≠0, contestStats≠0). Only one of
the seven trigger paths is exercised. Not catastrophic — the same return
function (`makeDecodeError(...)`) handles them all — but a per-path test
would be more defensive.

## S1 invariants check

| Invariant | Status |
|-----------|--------|
| `Gen3Intermediate` shape unchanged from S1 | ✓ Read `core/src/types/target.ts` end-to-end; shape is identical to S1 archive. No fields added/removed/renamed. |
| `refused.json` still 20 entries with exact gen2Id list | ✓ Confirmed via `python3 -c json.load`: 20 entries, all expected legendaries + unbreedable prevos |
| `core/package.json.dependencies = {}` | ✓ Verified empty `dependencies` object |
| S1 tests still pass | ✓ All 17 S1 test files green; 0 regressions |
| AMEND-1 (`0xAC` for `?`) preserved | ✓ Only `0xAC` appears in `core/src/fields/strings.ts`; `0x59` not present |
| `personal-gen3.json` regenerated with `base` field | ✓ All 11 spot-checks I ran independently against PKHeX-canonical Gen 3 R/S/E/FRLG values pass (Bulbasaur, Pikachu, Snorlax, Alakazam, Mewtwo, Dragonite, Blastoise, Celebi, Feraligatr, Charizard, Unown — including the historical Alakazam SpD=85 trap that Gen 6+ sources get wrong) |

S1 PersonalInfo extension (A17) is correctly additive: existing `getPersonal(id).{genderRatio, baseFriendship, ability0}` callers are unchanged.

## Open questions resolution

| PLAN §10 Q | Resolution |
|------------|------------|
| Q1 (size 64→80/100) | RESOLVED: PLAN_EVAL Q1 ruling, code uses 80/100 |
| Q2 (ship `unpackBoxed`) | RESOLVED: shipped, exported, tested |
| Q3 (ball ID 4) | RESOLVED: PLAN_EVAL A11; code uses 4 |
| Q4 (extend PersonalInfo) | RESOLVED: A17 Option A; code adds `base` field. **But A17's mandated 10-species spot-check NOT implemented → see Risks** |
| Q5 (PKHeX vector strategy) | RESOLVED: A4 Oracle-B implemented |
| Q6 (nature multiplier future-proof) | RESOLVED: A18 outer-floor preserved, full 25×5 table actually implemented (better than required) |
| Q7 (decoded `_meta` sentinel) | RESOLVED partially: A16 says `pidSearchIterations: 0`, code has **`-1`**. Sentinel-text and warning-prefix are correct. **SLIPPED-THROUGH.** |
| Q8 (obedience vs FE bit 31) | RESOLVED: A3, documented in code comments |
| Q9 (sanity bytes tolerated) | RESOLVED: code writes 0, ignores on read |
| Q10 (Unown PID baked) | RESOLVED: no Unown-specific path in S2; PID handled verbatim |

## Risks for Sprint 3

1. **A17 base-stats spot-check missing.** S1's `personal-gen3.json` shipped with 36 transcription errors before being regenerated. The new `base.{hp,atk,def,spa,spd,spe}` field — 6 values × ~250 species = 1500 numbers — has **zero direct unit-test assertions** of value. `gen3-party-record.test.ts` only verifies the *formula* round-trips with whatever base values are in the table; an off-by-one in Snorlax HP would still pass. PLAN_EVAL A17 explicitly mandated a 10-species spot-check; it is missing. S3's stat-formula consumers will inherit any silent error.

2. **A9 species range bound is wrong.** `core/src/pack/boxed.ts:48-49` sets `SPECIES_MAX = 412`, but PLAN_EVAL A9 binding-pinned the upper bound at **386** (Gen 3 national dex max). 412 admits PKHeX-internal "egg pseudo-species" entries that should never appear in a real wire PK3. S3 save-decode of a malformed cart will silently allow species 387..412 through.

3. **A16 sentinel `pidSearchIterations` value.** Code emits `-1`; A16 binding-pinned `0`. Comparator checks the warning string only, so this doesn't break tests, but PLAN_EVAL specifically called out the `-1` collision risk with future S1 emissions. S3 may end up with a confused metadata stream if S1 ever emits `-1` for an error case.

4. **`format:check` failing in CI.** A non-S2 demo file fails prettier. Either the file is excluded from `.prettierignore` or runs through `prettier --write`. As-is, success criterion 3 (`format:check` exit 0) is not met. If S3 starts in this state, every `bun run format:check` will fail and the orchestrator may stop checking.

5. **`UNEXPECTED_LITERAL_FIELD` only one trigger tested.** Of the 7+ trigger paths in `unpackBoxed`, only the isEgg-bit-30 path has explicit decode-error coverage. Defensive but not exhaustive. S3 save-reader may surface real-cart bytes that hit one of the other paths in unexpected ways.

## Orchestrator amendments

No PLAN/PLAN_EVAL items found to be wrong (unlike S1's `0xAC` byte). The wire-format spec is solid. The three deviations above are **Generator implementation drift from PLAN_EVAL bindings**, not PLAN_EVAL errors needing retro-recording.

One observation worth recording: **PLAN §9 success criterion 3** specifies `format:check` exit 0. The current build fails this on a file outside S2 scope. The orchestrator should either:
- exclude `scripts/demo-red-*.ts` from prettier's scan (`.prettierignore`), OR
- run `prettier --write` on those files, OR
- formally accept that format check is degraded while parallel-demo work is in progress.

Pick one before S3 starts.
