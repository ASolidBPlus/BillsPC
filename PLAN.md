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
