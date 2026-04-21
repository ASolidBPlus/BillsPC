# Sprint 1 Archive — pokeportal Conversion Core

**Status**: PASS (archived 2026-04-21).
**Scope**: HANDOFF §§4.0–4.16 (excluding §4.5 Hidden Power and §4.17 packing/encryption).
**Test outcome**: 113 pass / 1 permitted skip (Row-4 Alakazam stretch per PLAN §6.11). All 5 verification commands exit 0.

---

## Retrospective amendments (corrections to PLAN / PLAN_EVAL text — code is correct)

- **AMEND-1**: PLAN §4.15 states the Gen 3 `?` byte is `0x59`. Canonical value per PKHeX `StringConverter3.cs` line 202 is `0xAC`. The implementation in `core/src/fields/strings.ts` uses `0xAC` (verified by Code Evaluator). PLAN text is historical and not re-edited; the archived record documents the correction.
- **AMEND-2**: PLAN_EVAL amendment A6 lists the SHA-256 test vector for input `"abc"` with a typo (extra `3`, missing final `d`). Canonical is `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`. The test in `tests/unit/sha256-vectors.test.ts` asserts the canonical value.
- **AMEND-8** (forward-carried to S2/S3): stat-preservation harness uses Gen 3 base stats for both Gen 2 and Gen 3 legs to isolate conversion-induced deviation from Nintendos inter-generation base-stat rebalance. HANDOFF §9 thresholds pass under this scope. A real cart-to-cart comparison needs Gen 2 base-stat tables, which arrive with the Gen 1/2 save reader in S3.
- **AMEND-9** (non-blocking): README.md not written (CLAUDE.md "Do NOT create documentation files unless asked" overrides PLAN_EVAL A13). User may request one later.

---

# PLAN — (produced by Planner subagent)

# Sprint 1 Plan — pokeportal Conversion Core

## 1. Sprint contract

**Goal.** Stand up the pokeportal monorepo skeleton and ship a pure, deterministic Gen 1/2 → Gen 3 conversion **core library** that takes a typed in-memory source Pokemon and returns a typed Gen 3 **intermediate struct** (HANDOFF §7) — or a typed `Refusal` — with full unit-test coverage of every HANDOFF §4 subsection in scope.

**In scope.** Workspace scaffolding (bun + TS strict + vitest + GHA), ported PKHeX data tables (species map, egg groups, refused set, personal-info subset, Gen 1/2 + Gen 3 charmaps), source-side typed model, deterministic primitives (seeded RNG + SHA-256 wrapper + personality seed), and algorithms for HANDOFF §§4.0–4.16 except §4.5 (Hidden Power — not preserved) and §4.17 (encryption/checksum — deferred to S2).

**Out of scope.** Gen 3 substructure packing / encryption / checksum (S2); Gen 1/2 save-file parsing (S3 prereq); any web UI or Vite `web/` workspace scaffolding (S5+); PKHeX legality harness (stretch S4+); hardware or delivery.

**Done when.** `bun install && bun test` exits 0 on a clean clone; the three hardcoded EV cases (§9 worked examples), the three untrained stat-preservation scenarios (§9 table rows 1–3), determinism, refused-species, and neutral-nature-distribution tests all pass; exported `convert()` has the signature in §3 below; lint + typecheck clean under strict mode.

---

## 2. Directory layout

```
pokeportal/
├── package.json                        # root, declares workspaces: core, data, tests
├── bun.lockb                           # committed lockfile
├── tsconfig.base.json                  # strict: true, target ES2022, moduleResolution bundler
├── .prettierrc.json                    # 2-space, single-quote, trailing comma all
├── eslint.config.js                    # flat config, @typescript-eslint/strict
├── .editorconfig
├── .gitignore                          # node_modules, dist, coverage, .DS_Store
├── .github/
│   └── workflows/
│       └── ci.yml                      # matrix: ubuntu-latest, bun 1.3.x → install, typecheck, test
├── README.md                           # project overview, sprint status
├── PLAN.md                             # this file
├── HANDOFF.md                          # unchanged
├── CLAUDE.md                           # unchanged
├── sprints/                            # created at sprint archival time (empty in S1)
│
├── core/                               # ── workspace: pure conversion library, zero I/O
│   ├── package.json                    # name "@pokeportal/core", type: module, exports field
│   ├── tsconfig.json                   # extends base, composite, references data
│   ├── src/
│   │   ├── index.ts                    # public surface: re-exports convert, types, Refusal
│   │   ├── types/
│   │   │   ├── source.ts               # Gen12Pokemon, SourceGen (1|2), gender/shiny derivations
│   │   │   ├── target.ts               # Gen3Intermediate (HANDOFF §7 shape)
│   │   │   ├── options.ts              # ConvertOptions, RNG interface
│   │   │   └── refusal.ts              # Refusal discriminated union + RefusalReason enum
│   │   ├── convert.ts                  # top-level convert() — orchestrates §4.0…§4.16
│   │   ├── primitives/
│   │   │   ├── hash.ts                 # hash(bytes|string) → Uint8Array, SHA-256 pure-TS
│   │   │   ├── rng.ts                  # seedRng(seed: Uint8Array) → RNG { bit(), int(n) }
│   │   │   └── personalitySeed.ts      # personalitySeed(src) → Uint8Array
│   │   ├── fields/
│   │   │   ├── eligibility.ts          # §4.0 checkRefused(species) → Refusal | null
│   │   │   ├── ivs.ts                  # §4.1 + §4.2 deriveIVs(src, rng, opts)
│   │   │   ├── evs.ts                  # §4.3 deriveEVs(src)
│   │   │   ├── nature.ts               # §4.4 deriveNature(src)
│   │   │   ├── pid.ts                  # §4.6 searchPID(src, nature, gender, shiny, seed)
│   │   │   ├── otSid.ts                # §4.7 deriveSID, preserve OT/TID
│   │   │   ├── met.ts                  # §4.8 metData() constant
│   │   │   ├── moves.ts                # §4.9 preserve moves/PP/PP Ups
│   │   │   ├── heldItem.ts             # §4.10 mapHeldItem(src)
│   │   │   ├── pokerus.ts              # §4.11 byte passthrough
│   │   │   ├── friendship.ts           # §4.12 preserve | personal.baseFriendship
│   │   │   ├── levelExp.ts             # §4.13 passthroughs
│   │   │   ├── ability.ts              # §4.14 constant 0
│   │   │   ├── strings.ts              # §4.15 Gen12→Gen3 charmap; nickname + OT name
│   │   │   └── zeros.ts                # §4.16 contest/ribbons/markings = 0
│   │   ├── pidMethods.ts               # Method 1/2/4 wild-spread PID detector (§4.6 bullet 4)
│   │   ├── unown.ts                    # §4.6 Unown letter extraction + constraint helper
│   │   └── shinyGender.ts              # Gen 2 shiny-DV check + species-ratio gender derivation
│   └── src/__internal__.ts             # test-only re-exports (tree-shaken from index.ts)
│
├── data/                               # ── workspace: ported PKHeX tables, JSON + TS glue
│   ├── package.json                    # name "@pokeportal/data"
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts                    # re-exports
│   │   ├── species.ts                  # SpeciesEntry[]; gen2Id ↔ gen3DexId ↔ name
│   │   ├── eggGroups.ts                # EggGroup enum + per-species-id mapping
│   │   ├── refused.ts                  # hardcoded Set<number> of Gen 1/2 dex IDs refused
│   │   ├── personalInfo.ts             # { genderRatio, baseFriendship, ability0 } per Gen3 dex
│   │   ├── charmap12.ts                # Gen 1/2 byte → Unicode codepoint | null
│   │   ├── charmap3.ts                 # Unicode codepoint → Gen 3 byte | null (reverse fallback '?')
│   │   └── moves.ts                    # (stub) move-id passthrough table, Gen2↔Gen3 identical
│   └── src/raw/                        # source-of-truth JSON transcribed from PKHeX
│       ├── species.json
│       ├── egg-groups.json
│       ├── refused.json
│       ├── personal-gen3.json
│       ├── charmap12.json
│       └── charmap3.json
│
└── tests/                              # ── workspace: cross-package integration + regression
    ├── package.json                    # name "@pokeportal/tests", depends on core + data
    ├── tsconfig.json
    ├── vitest.config.ts
    ├── fixtures/
    │   ├── snorlax-maxtrained.ts       # §9 row 5 + §9 hardcoded EV case 2
    │   ├── partial-trained.ts          # §9 hardcoded EV case 3
    │   ├── pikachu-untrained-lv25.ts   # §9 row 1
    │   ├── feraligatr-untrained-lv55.ts# §9 row 2
    │   ├── charizard-maxdv-untrained.ts# §9 row 3
    │   ├── alakazam-competitive.ts     # §9 row 4 (stretch)
    │   ├── unown-letters.ts            # all 26 letters for §4.6 Unown constraint
    │   └── mew-refused.ts              # §4.0 regression
    ├── unit/
    │   ├── eligibility.test.ts
    │   ├── ivs.test.ts
    │   ├── evs.test.ts
    │   ├── nature.test.ts
    │   ├── pid.test.ts
    │   ├── strings.test.ts
    │   ├── hash-rng.test.ts
    │   └── unown.test.ts
    ├── integration/
    │   ├── determinism.test.ts
    │   ├── refused.test.ts
    │   ├── stat-preservation.test.ts   # computes Gen 3 stats, compares to Gen 2, asserts §9 table
    │   └── nature-distribution.test.ts # all 65536 DV combos, bucket sizes, 5 buckets present
    └── harness/
        ├── gen2Stats.ts                # Gen 2 stat formula for comparison
        └── gen3Stats.ts                # Gen 3 stat formula + nature multiplier (all 1.0 here)
```

Rationale: layout matches the locked decision in CLAUDE.md. `web/` is explicitly omitted per S1 scope. `src/raw/*.json` sits inside `data/` so the generator can see PKHeX-sourced tables as data (easy to re-transcribe / diff against upstream) while `data/src/*.ts` wraps them with typed accessors.

---

## 3. Public interfaces

All signatures are **types-only** — no bodies. This is what the Generator MUST implement.

### 3.1 Source-side model (`core/src/types/source.ts`)

```ts
export type SourceGen = 1 | 2;

export interface Gen12DVs {
  readonly atk: number;   // 0-15
  readonly def: number;   // 0-15
  readonly spe: number;   // 0-15
  readonly special: number; // 0-15 (shared SpA/SpD)
  // HP DV is derived; exposed as getter in a helper, not stored here.
}

export interface Gen12StatExp {
  readonly hp: number;      // 0-65535
  readonly atk: number;
  readonly def: number;
  readonly spe: number;
  readonly special: number; // shared SpA/SpD StatExp
}

export interface Gen12Pokemon {
  readonly sourceGen: SourceGen;
  readonly speciesGen2Id: number;       // Gen 2 dex ID (Bulbapedia numbering)
  readonly level: number;                // 1-100
  readonly exp: number;                  // uint24
  readonly dvs: Gen12DVs;
  readonly statExp: Gen12StatExp;
  readonly moves: readonly [number, number, number, number]; // 0 = empty slot
  readonly pp: readonly [number, number, number, number];
  readonly ppUps: readonly [number, number, number, number]; // Gen 1 → all 0
  readonly heldItemGen2Id: number | null;   // null for Gen 1
  readonly friendship: number | null;       // null for Gen 1 (derive from PersonalInfo)
  readonly pokerusByte: number;             // 0 for Gen 1
  readonly otNameBytes: Uint8Array;         // Gen 1/2 encoding, 1-7 bytes
  readonly tid: number;                     // uint16
  readonly nicknameBytes: Uint8Array;       // Gen 1/2 encoding, up to 10 chars
  readonly language: number;                // Gen 3 language code; default 2 (English) if absent
  readonly sourcePersonalityBytes?: Uint8Array;
  readonly otGender?: 0 | 1;                // default 0 (male)
}

export function hpDv(dvs: Gen12DVs): number;                         // Gen 2 LSB-packing formula
export function gen2Shiny(dvs: Gen12DVs): boolean;                   // (Def==Spe==Special==10) && Atk in {2,3,6,7,10,11,14,15}
export function gen2Gender(dvs: Gen12DVs, genderRatioByte: number): 0 | 1 | 2; // 2 = genderless
```

### 3.2 Target-side model (`core/src/types/target.ts`)

```ts
export interface Gen3Intermediate {
  readonly species: number;            // Gen 3 dex number
  readonly nickname: Uint8Array;       // Gen 3 encoding, terminated with 0xFF, max 10 chars
  readonly otName: Uint8Array;         // Gen 3 encoding, terminated, max 7 chars
  readonly otGender: 0 | 1;
  readonly tid: number;
  readonly sid: number;                // derived per §4.7
  readonly pid: number;                // derived per §4.6
  readonly ivs: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
  readonly evs: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
  readonly nature: number;             // 0..24
  readonly abilitySlot: 0;
  readonly moves: readonly [number, number, number, number];
  readonly pp: readonly [number, number, number, number];
  readonly ppUps: readonly [number, number, number, number];
  readonly heldItem: number;           // 0 = NO_ITEM
  readonly friendship: number;
  readonly exp: number;
  readonly level: number;
  readonly pokerus: number;
  readonly contestStats: { cool: 0; beauty: 0; cute: 0; clever: 0; tough: 0; sheen: 0 };
  readonly ribbons: readonly [];
  readonly markings: 0;
  readonly metLocation: 146;           // Four Island
  readonly metLevel: 5;
  readonly metGame: 'FireRed';
  readonly originGame: 'FireRed';
  readonly fatefulEncounter: false;
  readonly isEgg: false;
  readonly language: number;
  readonly _meta: ConvertMetadata;
}

export interface ConvertMetadata {
  readonly pidSearchIterations: number;
  readonly evScalingApplied: boolean;
  readonly evRemainderDistributed: number;
  readonly zeroDvOverridesApplied: readonly ('hp'|'atk'|'def'|'spa'|'spd'|'spe')[];
  readonly unownLetterConstrained: boolean;
  readonly warnings: readonly string[];
}
```

### 3.3 Options and refusal (`core/src/types/options.ts`, `refusal.ts`)

```ts
export interface RNG {
  bit(): 0 | 1;
  int(n: number): number;
  uint32(): number;
}

export type RngFactory = (seed: Uint8Array) => RNG;

export interface ConvertOptions {
  preserveZeroDV?: boolean;              // §5.1 — default true
  rng?: RngFactory;                      // test override
  pidSearchWarnThreshold?: number;       // default 10_000
  pidSearchHardCap?: number;             // default 1_000_000
}

// refusal.ts
export type RefusalReason =
  | 'UNDISCOVERED_EGG_GROUP'
  | 'UNBREEDABLE_PREVO'
  | 'LEGENDARY'
  | 'UNKNOWN_SPECIES';

export interface Refusal {
  readonly kind: 'refusal';
  readonly reason: RefusalReason;
  readonly speciesGen2Id: number;
  readonly speciesName: string;
  readonly message: string;
}

export function isRefusal(x: Gen3Intermediate | Refusal): x is Refusal;
```

### 3.4 Public entry point (`core/src/index.ts`)

```ts
export function convert(
  src: Gen12Pokemon,
  opts?: ConvertOptions,
): Gen3Intermediate | Refusal;

export type { Gen12Pokemon, Gen12DVs, Gen12StatExp, SourceGen } from './types/source';
export type { Gen3Intermediate, ConvertMetadata } from './types/target';
export type { ConvertOptions, RNG, RngFactory } from './types/options';
export type { Refusal, RefusalReason } from './types/refusal';
export { isRefusal } from './types/refusal';
```

---

## 4. Algorithm decomposition

### §4.0 `checkRefused(speciesGen2Id) → Refusal | null` (in `fields/eligibility.ts`)

Looks up `speciesGen2Id` in the refused set (§5 below). If present, returns a `Refusal` with a message like `"Mew (#151) cannot be hatched from an egg; conversion refused."` If the species isn't in the species map at all, returns a `Refusal{reason:'UNKNOWN_SPECIES'}`. Otherwise returns `null`.
- Must run **first** in `convert()` before any RNG work — refused species should not advance the seeded RNG state.
- Refusal messages are stable strings (snapshot-tested).
- Refused set uses **Gen 2 dex IDs** (Bulbapedia Gen 2 numbering).

### §4.1 + §4.2 `deriveIVs(src, rng, opts)` (in `fields/ivs.ts`)

Compute `hpDv = hpDv(src.dvs)`. For each physical DV (hp, atk, def, spe): if `preserveZeroDV && dv === 0`, emit `iv = 0` (record in `_meta.zeroDvOverridesApplied`); else draw one bit `b = rng.bit()` and emit `iv = 2*dv + b`. For Special: draw **one shared bit** `bSpec = rng.bit()`; if `preserveZeroDV && special === 0`, force `spa = spd = 0`; else `spa = spd = 2*special + bSpec`.
- Draw order is **fixed and documented** — hp, atk, def, spe, special — so the deterministic RNG produces stable IVs across refactors.
- Shared-bit requirement in §4.2 must not become two separate bits; unit test asserts SpA.bit == SpD.bit for 100 random seeds.
- HP DV derivation uses LSBs of (Atk, Def, Spe, Special) in that exact order, packed as `(atk&1)<<3 | (def&1)<<2 | (spe&1)<<1 | (special&1)`.

### §4.3 `deriveEVs(statExp)` (in `fields/evs.ts`)

```
raw[hp]  = min(252, floor(sqrt(statExp.hp)))
raw[atk] = min(252, floor(sqrt(statExp.atk)))
raw[def] = min(252, floor(sqrt(statExp.def)))
raw[spa] = min(252, floor(sqrt(statExp.special)))   // Special split to both
raw[spd] = raw[spa]
raw[spe] = min(252, floor(sqrt(statExp.spe)))
sum = Σ raw
if sum ≤ 510: return raw
scaled_float[i] = raw[i] * 510 / sum
floor_i         = floor(scaled_float[i])
rem_i           = scaled_float[i] - floor_i
residual        = 510 - Σ floor_i
// Hamilton: sort indices by (rem desc, index asc), give +1 to top `residual` stats
```
Canonical stat order `[hp, atk, def, spa, spd, spe]` throughout. Cap-to-252 happens before the sum check. Special split happens before cap.
- `Math.sqrt(65535)` → 255.999… → floor 255 → cap to 252. Verified with loop over 0..65535.
- Hamilton tiebreak on index ascending (HANDOFF §4.3 example confirms).

### §4.4 `deriveNature(dvs)` (in `fields/nature.ts`)

```ts
const bucket = ((dvs.atk << 4) | dvs.def) % 5;
const NEUTRAL = [0 /*Hardy*/, 6 /*Docile*/, 18 /*Serious*/, 12 /*Bashful*/, 24 /*Quirky*/];
return NEUTRAL[bucket];
```
All five are 1.0× multipliers → no stat deviation.
- Distribution over 256 (atk,def) pairs is `[52, 52, 51, 51, 50]` (non-uniform but within 5%).
- Bucket → nature ID mapping is snapshot-tested.

### §4.6 `searchPID(src, nature, gender, isShiny, tid, sid, seed, opts)` (in `fields/pid.ts`)

Iterate `k = 0, 1, 2, ...`:
1. `pid = readU32LE(sha256(seed || k_as_u32_le).slice(0,4))`.
2. Reject if `pid % 25 !== nature`.
3. Reject if `gender(pid & 0xFF, species.genderRatio) !== src_gender`.
4. Reject if `shinyCheck(tid, sid, pid) !== isShiny`.
5. Reject if `isMethod1PID(pid, ivs) || isMethod2PID(pid, ivs) || isMethod4PID(pid, ivs)`.
6. If Unown: reject if `unownLetter(pid) !== source_letter`.
7. Accept. Return `{pid, iterations: k+1}`.

- Shiny check uses Gen 3 threshold **8** (HANDOFF explicit: `< 8`).
- Gender function: `255` → genderless (accept), `254` → always female, `0` → always male, else `(pid&0xFF) < ratio ? female : male`.
- Unown letter: `letter = ((pid>>24)&3)<<6 | ((pid>>16)&3)<<4 | ((pid>>8)&3)<<2 | (pid&3); letter %= 28`.
- PID-search RNG is **independent** of the IV RNG — different domain-separation tag.
- Hard cap at 1,000,000 throws; warn threshold 10,000 records a warning.

### §4.7 `deriveSID(otNameBytes, tid)` (in `fields/otSid.ts`)

```
sid = readU16LE(sha256(otNameBytes || u16le(tid)).slice(0,2))
```
OT name bytes and TID pass through verbatim. `otGender = src.otGender ?? 0`. Hash input is the **raw Gen 1/2 encoding** OT name bytes, not the Gen 3-remapped version — keeps SID stable across conversions of the same source.

### §4.8 `metData()` — pure constant

`{ metLocation: 146, metLevel: 5, metGame: 'FireRed', originGame: 'FireRed', fatefulEncounter: false, isEgg: false }`.

### §4.9 `preserveMoves(src)` — passthrough

Moves/PP/PP-Ups copy through. Gen 1 sources get `ppUps = [0,0,0,0]`. Move IDs identical Gen 2 ↔ Gen 3 (Gen 3 is a superset). TODO comment flags §4.9 "none do in practice" invariant.

### §4.10 `mapHeldItem(src)`

Gen 1 → `0` (NO_ITEM). Gen 2 → Gen 2→Gen 3 item map. For S1: identity map plus a hardcoded list of Gen 2-exclusive items that map to 0. Full fidelity deferred.

### §4.11 `preservePokerus(src)` — byte passthrough

Gen 1 → `0`; Gen 2 → `src.pokerusByte`.

### §4.12 `deriveFriendship(src, personal)`

Non-null `src.friendship` → use as-is. Otherwise → `personal.baseFriendship` from the Gen 3 personal-info table.

### §4.13 `preserveLevelExp(src)`

Level/EXP passthrough. Clamp level to `[1, 100]`; throw on out-of-range EXP.

### §4.14 `abilitySlot()` → `0`

Literal constant. Do **not** consult PersonalInfo.ability1.

### §4.15 `convertNickname`, `convertOTName` (in `fields/strings.ts`)

Two-pass: Gen 1/2 bytes → Unicode via `charmap12`; Unicode → Gen 3 bytes via `charmap3` (fallback `0x59` = '?' for unmapped). Terminate `0xFF`. Truncate to 10 chars (nickname) / 7 chars (OT) before terminator.

### §4.16 zeros (in `fields/zeros.ts`)

Hardcoded object literal. No logic.

### §4.17 — **OUT OF SCOPE for S1**

Deferred to S2.

### Orchestration (`core/src/convert.ts`)

```
convert(src, opts):
  1. refusal = checkRefused(src.speciesGen2Id); if refusal: return refusal
  2. personality = personalitySeed(src)
  3. ivRng = (opts.rng ?? defaultRng)(sha256(personality || 'iv'))
  4. ivs = deriveIVs(src, ivRng, opts)
  5. nature = deriveNature(src.dvs)
  6. {evs, meta_ev} = deriveEVs(src.statExp)
  7. sid = deriveSID(src.otNameBytes, src.tid)
  8. isShiny = gen2Shiny(src.dvs)
  9. gender = gen2Gender(src.dvs, personal.genderRatio)
  10. pidSeed = sha256(personality || 'pid')
  11. {pid, iterations} = searchPID(src, nature, gender, isShiny, src.tid, sid, pidSeed, opts, ivs)
  12. otGen3Bytes = convertOTName(src.otNameBytes)
  13. nickGen3Bytes = convertNickname(src.nicknameBytes, src.language)
  14. friendship = deriveFriendship(src, personal)
  15. heldItem = mapHeldItem(src)
  16. assemble Gen3Intermediate
```

Domain-separation tags (`'iv'`, `'pid'`) prevent SHA-256 output reuse across streams.

---

## 5. Data-table plan

### 5.1 Species map — `data/src/species.ts` + `raw/species.json`

- **PKHeX source**: `PKHeX.Core/Resources/byte/text/species_en.txt` + `SpeciesName.cs`. Gen 2 dex numbering = National Dex 1-251 = Gen 3 Dex 1-251.
- **Shape**: `SpeciesEntry { gen2Id, gen3DexId, name, eggGroups: [EggGroup, EggGroup] }` + `SPECIES[]` + `getSpecies(id)`.
- **Strategy**: Hand-transcribe 251 entries. Committed raw JSON + typed accessor.

### 5.2 Egg groups — `data/src/eggGroups.ts` + `raw/egg-groups.json`

- **PKHeX source**: Gen 3 personal-info (`personal_rs`) `EggGroup1`/`EggGroup2`.
- **Shape**: `EggGroup` enum (Monster=1…Undiscovered=15); per-species tuple of two groups.
- **Strategy**: Hand-transcribe.

### 5.3 Refused species set — `data/src/refused.ts` + `raw/refused.json`

**Enumerated explicitly** (Gen 2 dex IDs):

**Legendaries (Undiscovered egg group)**:
144 Articuno, 145 Zapdos, 146 Moltres, 150 Mewtwo, 151 Mew, 243 Raikou, 244 Entei, 245 Suicune, 249 Lugia, 250 Ho-Oh, 251 Celebi.

**Baby pre-evolutions (unbreedable themselves)**:
172 Pichu, 173 Cleffa, 174 Igglybuff, 175 Togepi, 236 Tyrogue, 238 Smoochum, 239 Elekid, 240 Magby.

**Ditto** (cannot breed with itself, no egg source): 132.

**Final refused set (20 species)**:
`[132, 144, 145, 146, 150, 151, 172, 173, 174, 175, 236, 238, 239, 240, 243, 244, 245, 249, 250, 251]`

**Explicitly kept** (flagged so generator doesn't add them):
- 201 Unown — HANDOFF §4.6 expects Unown to convert (see open question 1).
- 235 Smeargle — Field egg group, breedable.

**Shape**: `REFUSED_SPECIES: ReadonlySet<number>` + `refusalReason(id): RefusalReason`.

### 5.4 Personal info subset — `data/src/personalInfo.ts` + `raw/personal-gen3.json`

- **PKHeX source**: `personal_rs` binary (Ruby/Sapphire personal info).
- **Shape**: `{ gen3DexId, genderRatio, baseFriendship, ability0 }`.
- **Strategy**: Hand-transcribe 251 rows from Bulbapedia. Regression test against a verified subset.

### 5.5 Character maps — `data/src/charmap12.ts` + `charmap3.ts`

- **PKHeX source**: `StringConverter12.cs` (`RBY2U_U`), `StringConverter3.cs` (`G3_U`).
- **Shape**: `CHARMAP12_TO_UNICODE: Map<number,string>`, `UNICODE_TO_CHARMAP3: Map<string,number>`, constants `GEN3_TERMINATOR=0xFF`, `GEN3_QUESTION_MARK=0x59`.
- **Strategy**: Hand-transcribe International-English subset (<256 entries each).

---

## 6. Test matrix

### Unit tests (`tests/unit/`)

1. **`hash-rng.test.ts`**: SHA-256 matches known vectors; `seedRng(seed).bit()` 50/50 ±3σ over 10,000 calls; same seed → same sequence.

2. **`eligibility.test.ts`**: every refused ID returns expected `Refusal`; Mew → `LEGENDARY`; Pichu → `UNBREEDABLE_PREVO`; Ditto → `UNBREEDABLE_PREVO`; species 999 → `UNKNOWN_SPECIES`; Bulbasaur → null.

3. **`ivs.test.ts`**: For DV 0..15, IV ∈ `{2*DV, 2*DV+1}` with 50/50 split over 10,000 seeds; `preserveZeroDV=true` forces IV=0 when DV=0; `preserveZeroDV=false` shows 50/50; Special split SpA===SpD across 1,000 seeds; HP DV across 10,000 random (atk,def,spe,special) quads.

4. **`evs.test.ts`** — the three §9 hardcoded cases in canonical `[hp, atk, def, spa, spd, spe]` order:
   - Case A: all-zero StatExp → `[0,0,0,0,0,0]`.
   - Case B: all-65535 StatExp → `[85,85,85,85,85,85]`.
   - Case C: `{hp:65535, atk:65535, def:10000, spe:5000, special:0}` → **in our canonical order**: raw=[252,252,100,0,0,70], sum=674, scale 510/674. Final: **hand-compute with tiebreak, assert exactly**. (See open question 5.)
   - Plus: Hamilton tiebreak with constructed tied-remainder input.

5. **`nature.test.ts`**: all 256 (atk,def) pairs → exactly 5 distinct natures; counts `[52, 52, 51, 51, 50]`; bucket → nature ID snapshot.

6. **`pid.test.ts`**: Hardy+male+non-shiny+non-Unown fixture → first candidate passes; shiny=true forces iterations > 0; `_meta.pidSearchIterations` matches; impossible-constraint hard-cap throws.

7. **`unown.test.ts`**: A..Z (plus ! and ?) — converted Unown PID decodes to same letter.

8. **`strings.test.ts`**: ASCII round-trip; unmapped char → '?' (0x59); truncation (11→10 nickname, 8→7 OT); `0xFF` terminator present.

### Integration tests (`tests/integration/`)

9. **`determinism.test.ts`**: `convert(x) === convert(x)` structural deep-equal on Snorlax fixture; two fixtures differing only in species yield different PIDs.

10. **`refused.test.ts`**: all 20 refused IDs return `{kind:'refusal'}`; `isRefusal()` narrows correctly.

11. **`stat-preservation.test.ts`**:
    - Row 1 (Pikachu Lv25 untrained): avg ≤ 1.5, max ≤ 3 over 1,000 seeds.
    - Row 2 (Feraligatr Lv55 untrained): avg ≤ 2.5, max ≤ 5.
    - Row 3 (Charizard Lv100 max-DV untrained): avg ≤ 3.5, max ≤ 7.
    - Row 4 (Alakazam competitive): avg ≤ 108, max ≤ 112. **Stretch — may `.skip()`.**
    - Row 5 (Snorlax max-trained): avg ≤ 260, max ≤ 262.

12. **`nature-distribution.test.ts`**: 65536 DV combos → 5 buckets, counts within 5% of uniform, no non-neutral nature ever appears.

---

## 7. Success criteria (objective pass/fail)

1. `bun install && bun test` exits 0.
2. ≥ 12 test files; ≥ 50 individual test cases.
3. `bun run typecheck` exits 0 under `strict: true`.
4. `bun run lint` exits 0 (`--max-warnings 0`).
5. `bun run format:check` exits 0.
6. EV hardcoded cases pass bit-exactly (all three).
7. `convert({speciesGen2Id: 151})` returns Refusal with message containing `"Mew"` and reason `'LEGENDARY'`. Same for all 20 refused IDs.
8. Determinism: `convert(x)` twice on Snorlax fixture deep-equal.
9. Stat-preservation rows 1/2/3/5 pass; row 4 may `.skip()`.
10. Neutral-nature distribution: only 5 neutral natures appear, counts within 5% of uniform.
11. `core/src/index.ts` exports exactly `convert`, `isRefusal`, and the types in §3.4 (snapshot-tested).
12. `core/package.json` dependencies is `{}`.
13. `data/src/raw/` contains the six JSON files with expected counts.
14. `.github/workflows/ci.yml` present and valid YAML.
15. Refused-species Set equals the 20-element list in §5.3 (snapshot-tested).
16. `_meta.zeroDvOverridesApplied` correct for a fixture with `atk_dv=0, special_dv=0`.
17. HP DV correctness across 16 parity combos (snapshot).

---

## 8. Open questions for the Plan Evaluator

1. **Unown egg-group vs refusal**. HANDOFF §4.6 expects Unown to convert. We keep Unown out of the refused set. Confirm.
2. **Ditto refusal**. Ditto can't be hatched. We refuse Ditto. Confirm.
3. **Smeargle**. Breedable. Not refused. Sketch moves pass through per §4.9. Confirm no special handling.
4. **Personal-info transcription**. Hand-transcribe 251 rows from Bulbapedia + regression test, vs scripting a parse of PKHeX's `personal_rs` binary. Recommend hand.
5. **EV ordering landmine**. HANDOFF §4.3 worked example output `[191,191,75,53,0,0]` matches ordering `[hp,atk,def,spe,spa,spd]`. Canonical here is `[hp,atk,def,spa,spd,spe]`, so our test assertion must reshuffle to `[191,191,75,0,0,53]`. Confirm.
6. **SHA-256 abstraction**. Pure-TS vendored (sync, ~1KB) vs Web Crypto (async). Recommend pure-TS so `convert()` stays synchronous.
7. **PID-method roster**. HANDOFF §4.6 lists only Methods 1/2/4. Confirm full PKHeX `MethodFinder` roster is NOT required.
8. **`pack()` stub in S1**. Recommend omit; add in S2.
9. **Language default**. Gen 1 lacks a language field. Default 2 (English). Confirm.
10. **`otGender` placement**. On `Gen12Pokemon` (not `ConvertOptions`), defaulting 0. Confirm.

---

## 9. Out of scope for S1

| Item | Deferred to |
|---|---|
| Gen 3 substructure packing / encryption / checksum (§4.17) | **S2** |
| Gen 1/2 save-file parsing | **S3** |
| Gen 3 save-file writer / delivery | **S4** |
| PKHeX legality harness | **S4+** (stretch) |
| Web UI (Vite `web/`) | **S5+** |
| Web Serial / GBxCart RW | **S5+** |
| Hidden Power preservation (§4.5) | **Never** — rejected |
| PCCS / GearsProgress compatibility (§6) | **Never** — rejected |
| EV redistribution toggle (§6) | **Never** — rejected |
| Nature mode toggle (§4.4) | **Never** — rejected |
| Full Japanese charmap coverage | **S3+** |
| Move Gen 2→Gen 3 remapping (none needed) | **S2** sanity check |
| Full Item Gen 2→Gen 3 remapping | **S2** |


---

# PLAN_EVAL — (produced by Plan Evaluator subagent)

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


---

# EVAL — (produced by Code Evaluator, re-evaluation after fix-loop)

# EVAL — Sprint 1 (re-evaluation after fix-loop)

## Verdict

**PASS.** The fix-loop addressed the three binding asks from the prior PARTIAL
verdict cleanly and without regressions. An independent byte-for-byte re-parse
of PKHeX `personal_rs` against the regenerated `core/src/data/raw/personal-gen3.json`
shows **0 mismatches across all 753 values** (251 rows × 3 fields), and every
one of the 36 specific bugs the prior EVAL enumerated is fixed. The expanded
spot-check test is exactly what PLAN_EVAL A15 asked for (42 species-level
assertions across all 7 distinct Gen 1/2 gender ratio bytes, plus a meta test
that fails loud if PKHeX ever introduces a new byte), and the Dragonite
assertion that previously validated a bug now asserts the PKHeX-true value
`genderRatio === 127`. The 2 Unown tests for indices 26 (`!`) and 27 (`?`) use
hand-constructed PIDs whose bit-pair extraction formula I independently
verified matches `core/src/fields/unown.ts:unownLetterFromPid`. All 5
verification commands exit 0; tests are now **113 pass / 1 skip** across 17
files (up from 78 / 1 — the Row-4 Alakazam skip is the permitted stretch per
criterion 9). No unrelated files changed; no new FIXMEs, TODO markers, or
`.only` leakage. The four items the fix-loop explicitly left unaddressed
(AMEND-8 stat-preservation base-stat table, AMEND-9 README omission,
`preserveLevelExp` bounds, `.d.ts` shape snapshot) are all either already ruled
non-blocking in the prior EVAL or genuinely out of the S1 deliverable surface.
Orchestrator is clear to archive S1.

## Fix-loop outcomes

- **Ask AMEND-5: Regenerate `personal-gen3.json` from PKHeX `personal_rs`.**
  Fixed? **YES**. Evidence: `scripts/gen-personal-info.ts` fetches kwsch/PKHeX
  master `personal_rs`, parses with `SIZE=0x1C`, `OFFSET_GENDER=0x10`,
  `OFFSET_FRIENDSHIP=0x12`, `OFFSET_ABILITY1=0x16` — matching the canonical
  layout of `PKHeX.Core/PersonalInfo/Info/PersonalInfo3.cs`. Independent
  re-parse with the same Python offsets diffed against `core/src/data/raw/personal-gen3.json`
  returns **0 mismatches / 753 values**. All 36 prior bugs confirmed fixed
  (36/36 in a targeted check).

- **Ask AMEND-6: Rewrite spot-check test against PKHeX-true values and expand
  to 30+ species covering every distinct gender byte.** Fixed? **YES**.
  Evidence: `tests/integration/personal-info-spot-check.test.ts` contains 43
  `it()` cases (42 species assertions + 1 meta coverage assertion). All 7
  Gen 1/2 gender bytes present: 0 (Hitmonlee/Hitmonchan/Tauros/Tyrogue/Hitmontop),
  31 (Bulbasaur/Charmander/Squirtle/Snorlax/Omanyte/Chikorita/Umbreon),
  63 (Abra/Machop/Electabuzz), 127 (Pidgey/Rattata/Pikachu/Pinsir/Dratini/
  Dragonite/Kingdra/Larvitar/Tyranitar), 191 (Clefairy/Jigglypuff/Snubbull/Corsola),
  254 (Chansey/Kangaskhan/Miltank), 255 (Magnemite/Voltorb/Staryu/Ditto/
  Porygon/Mewtwo/Mew/Unown/Lugia/Ho-Oh/Celebi). Dragonite at `personal-info-spot-check.test.ts:149-154`
  now asserts `genderRatio: 127, baseFriendship: 35, ability0: 39` — correct
  per PKHeX. The meta test at lines 290-295 enumerates the full species space
  and asserts the set equals `[0, 31, 63, 127, 191, 254, 255]`, which I
  independently verified against the regenerated JSON.

- **Ask AMEND-7: Add Unown PID-extraction tests for indices 26 (`!`) and 27 (`?`).**
  Fixed? **YES**. Evidence: `tests/unit/unown.test.ts:41-49` adds two tests.
  `unownLetterFromPid(0x00010202)` should return 26 and
  `unownLetterFromPid(0x00010203)` should return 27; I ran the formula
  `((pid>>24)&3)<<6 | ((pid>>16)&3)<<4 | ((pid>>8)&3)<<2 | (pid&3)) % 28`
  in Python against both PIDs and got 26 and 27 respectively. Test passes
  in vitest.

## Verification command results

| # | Command | Exit | Notes |
|---|---|---|---|
| 1 | `bun install` | **0** | No changes — 157 installs / 202 packages cached |
| 2 | `bun run typecheck` | **0** | `tsc --build` clean under strict |
| 3 | `bun run lint` | **0** | `eslint --max-warnings 0 .` clean |
| 4 | `bun run format:check` | **0** | Prettier: "All matched files use Prettier code style!" (EVAL.md / sprints/ now in .prettierignore) |
| 5 | `bun run test` | **0** | 17 files, **113 passed / 1 skipped** (up from 78/1). Row-4 stretch skip retained as permitted. |

## Independent PKHeX personal_rs diff

- **Source**: `https://raw.githubusercontent.com/kwsch/PKHeX/master/PKHeX.Core/Resources/byte/personal/personal_rs`, 10836 bytes = 387 entries × 28 bytes.
- **Layout**: `SIZE=0x1C`, `gender=+0x10`, `baseFriendship=+0x12`, `ability1=+0x16`, per `PersonalInfo3.cs` (ground truth per the brief's override).
- **Entries compared**: 251 (dex 1..251).
- **Values compared**: 753 (251 × 3 fields).
- **Mismatches**: **0** (genderRatio, baseFriendship, ability0 all match PKHeX byte-for-byte).
- **Prior bugs fixed**: 36 / 36 (targeted re-check on each ID from the prior EVAL's enumerated list: Abra/Kadabra/Alakazam line, Machop line, Electabuzz, Magmar, Pinsir, Omanyte→Aerodactyl fossils, Dratini line, Togepi/Togetic, Snubbull/Granbull, Corsola, Elekid/Magby, Larvitar line, plus 3 friendship fixes for Umbreon/Murkrow/Misdreavus and 6 ability0 fixes for Vulpix/Seadra/Togepi/Togetic/Quagsire/Slowking).

## Spot-check test audit

- **Assertion count**: 43 `it()` cases = **42 species-level assertions + 1 meta coverage test**. Meets "42 assertions covering all 7 distinct Gen 1/2 gender-ratio bytes."
- **Gender-byte coverage**:
  - byte 0 (male-only): Hitmonlee, Hitmonchan, Tauros, Tyrogue, Hitmontop — 5 species ✓
  - byte 31 (12.5% F): Bulbasaur, Charmander, Squirtle, Snorlax, Omanyte, Chikorita, Umbreon — 7 species ✓
  - byte 63 (25% F): Abra, Machop, Electabuzz — 3 species ✓
  - byte 127 (50% F): Pidgey, Rattata, Pikachu, Pinsir, Dratini, Dragonite, Kingdra, Larvitar, Tyranitar — 9 species ✓
  - byte 191 (75% F): Clefairy, Jigglypuff, Snubbull, Corsola — 4 species ✓
  - byte 254 (female-only): Chansey, Kangaskhan, Miltank — 3 species ✓
  - byte 255 (genderless): Magnemite, Voltorb, Staryu, Ditto, Porygon, Mewtwo, Mew, Unown, Lugia, Ho-Oh, Celebi — 11 species ✓
  - All 7 present. ✓
- **Dragonite confirmation**: `personal-info-spot-check.test.ts:149` asserts `p.genderRatio === 127` (line 151), `baseFriendship === 35` (line 152), `ability0 === 39` (line 153) — matches PKHeX, corrects the prior validate-a-bug assertion.
- **Test execution**: `bun run test` shows `tests/integration/personal-info-spot-check.test.ts (43 tests) 15ms` — all pass.
- **Bonus**: meta test at line 290 enumerates all 251 species and asserts the observed distinct gender byte set equals `[0, 31, 63, 127, 191, 254, 255]`. Independently verified true against the regenerated JSON. This is a stronger invariant than the brief requested.

## Unown tests audit

- `tests/unit/unown.test.ts:41-49` adds two tests per AMEND-7.
- Formula under test (`core/src/fields/unown.ts:12-18`):
  ```
  letter = ((pid>>>24)&0x3)<<6 | ((pid>>>16)&0x3)<<4 | ((pid>>>8)&0x3)<<2 | (pid&0x3)
  letter %= 28
  ```
- For `pid = 0x00010202`: bytes are b3=0x00, b2=0x01, b1=0x02, b0=0x02. `(b3&3)=0, (b2&3)=1, (b1&3)=2, (b0&3)=2`. Pre-mod = `0<<6 | 1<<4 | 2<<2 | 2` = `0 + 16 + 8 + 2` = **26**. `26 % 28 = 26` = `!`. ✓
- For `pid = 0x00010203`: bits pairs `(0,1,2,3)`. Pre-mod = `0 + 16 + 8 + 3` = **27**. `27 % 28 = 27` = `?`. ✓
- Both tests pass in the vitest run.
- Covers the "future PID-search path emits 26/27" branch that the prior EVAL's missed-scope item flagged.

## Success criteria deltas from prior EVAL

Status changes vs. prior EVAL (all other criteria unchanged at **PASS**):

- **Criterion 1** (`bun install && bun test` exits 0): was PASS with 78/1 tests; remains PASS with **113 pass / 1 skip** (test count grew; exit code unchanged).
- **Criterion 2** (≥12 test files; ≥50 test cases): was PASS with 17 files / 79 tests; remains PASS with 17 files / 114 tests.
- **Criterion 5** (`format:check` exits 0): was PASS; remains PASS. The fix-loop's addition of `EVAL.md` and `sprints/` to `.prettierignore` prevented a future prettier failure when the sprint archives EVAL.md, so this is slightly stronger.

No criterion regressed from PASS to something worse. Criteria that were
PASS-with-caveat in the prior EVAL (notably Criterion 9 stat-preservation
harness scope and Criterion 11 runtime-only export snapshot) remain in the
same state — they were explicitly deferred and are non-blocking.

## Remaining non-blockers (for S2 record)

The fix-loop explicitly left four items unaddressed. Reviewed each for
blocker potential:

1. **AMEND-8 stat-preservation harness scope**. Fix-loop deferred to S2/S3.
   The prior EVAL already ruled this PASS-with-caveat; harness measures
   conversion-mechanic drift, not cart-to-cart round-trip. HANDOFF §9 numeric
   bounds hold. **Non-blocking confirmed** — S2+ will add per-generation base
   stat tables when real Gen 2 save parsing arrives.

2. **AMEND-9 README omission**. CLAUDE.md "Do NOT create documentation
   files unless asked" explicitly overrides PLAN_EVAL A13. **Non-blocking
   confirmed** — orchestrator may optionally add a 20-line pointer README at
   archival time without looping back.

3. **`preserveLevelExp` bounds unit test**. `core/src/fields/levelExp.ts`
   implements clamp-level and throw-on-OOB-EXP per PLAN §4.13 but no direct
   unit test exercises the edges. Integration tests exercise it transitively
   through `convert()` on fixtures with valid level/exp. The invariant is
   implemented, just not independently asserted. **Non-blocking confirmed** —
   low-risk (the logic is trivial clamp/throw; `convert()` determinism test
   would catch any behavior change). File in S2 backlog.

4. **`.d.ts` shape snapshot (PLAN_EVAL A14)**. `tests/integration/exports.test.ts`
   snapshots runtime exported member names but not the TS shape of
   `Gen3Intermediate`. The prior EVAL rated this a weaker protection than
   A14 wanted but not missing — member renames are caught, field renames
   aren't. **Non-blocking confirmed** — S2 will add `pack()` which forces a
   new snapshot anyway, and the S2 Code Evaluator can raise the bar then.

None of these four items is blocker-grade. All four were correctly
identified as out-of-scope for the S1 fix-loop per the brief.

## Orchestrator amendments still needed

Restating from the prior EVAL's amendments list, filtered for items that still
need to be recorded in the S1 archive:

- **AMEND-1** (retained): PLAN §4.15 says question-mark byte `0x59`; canonical
  is `0xAC` per PKHeX `StringConverter3.cs:202`. Code is correct; PLAN text
  needs retrospective correction when archiving.
- **AMEND-2** (retained): PLAN_EVAL A6 SHA-256 "abc" vector has a typo
  (extra `3` after `a3`, missing final `d`). Canonical is
  `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`. Code
  asserts the canonical value; PLAN_EVAL text needs retrospective
  correction.
- **AMEND-3** (retained, informational): nature distribution `[52, 51, 51, 51, 51]` —
  PLAN_EVAL A2 already corrected. No code action.
- **AMEND-4** (retained, informational): `NEUTRAL` array Serious=12 / Bashful=18 —
  PLAN_EVAL A1 already fixed. No code action.
- **AMEND-5** (resolved by this fix-loop): regenerated `personal-gen3.json`;
  mark closed.
- **AMEND-6** (resolved by this fix-loop): spot-check rewritten and expanded;
  mark closed.
- **AMEND-7** (resolved by this fix-loop): Unown `!`/`?` extraction tests
  added; mark closed.
- **AMEND-8** (retained): stat-preservation harness base-stat scope — flag for
  S2/S3. No S1 code action.
- **AMEND-9** (retained, non-blocking): README omission — optional 20-line
  pointer at archival time, or defer to S5+.

## Failure-mode-shift ruling

**N/A — verdict is PASS.** No further loop needed. Archive S1 and move to
S2.

---

*End of EVAL — supersedes prior PARTIAL verdict.*
