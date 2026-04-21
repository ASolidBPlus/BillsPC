# HANDOFF: Pokemon Gen 1/2 → Gen 3 Conversion Tool

## Purpose of this document

This is a handoff to a Claude Code instance that will be implementing the **conversion** side of a Pokemon Gen 1/2 → Gen 3 hardware "box" project. This document covers ONLY the conversion algorithms and the conversion tool itself. Delivery mechanism (how the converted Pokemon ends up in a Gen 3 save) is **out of scope here** and will be handled separately. Hardware design is also out of scope.

The reader should treat this as a design specification, not a tutorial. It encodes design decisions made deliberately after surveying community prior art, and the rationale matters because some choices are non-obvious and look wrong if you only know the surface-level transfer mechanics.

---

## 1. Project context

The user is building a hardware device that:
1. Reads a Gen 1 (Red/Blue/Yellow) or Gen 2 (Gold/Silver/Crystal) save off a physical cart via GBxCart RW
2. Converts each selected Pokemon to a Gen 3 data structure using the algorithms in this document
3. Hands the converted Pokemon off to a delivery mechanism (separate concern) that places it into a Gen 3 save

The conversion targets **HOME-strict legality**. That means the resulting Pokemon, after being delivered into a Gen 3 cart and then forward-transferred up the chain (Gen 3 → 4 → 5 → Bank → HOME), must pass HOME's legality checks.

The user is a CCNP-level networking academic, not a Pokemon ROM hacking specialist. Treat them as technically competent but assume they may push back hard on choices that look hand-wavy. They want to be challenged. They have explicitly rejected GearsProgress's `Poke_Transporter_GB` as a reference for conversion logic because it's incomplete, though its delivery mechanism (ACE) is independently interesting.

## 2. Design philosophy

The user's project is anchored in what's called the "essence preservation" philosophy, aligned with VGMoose's blog post (https://vgmoose.dev/blog/on-the-pokemon-bank-transfer-algorithm-6446734174/). The five principles, paraphrased:

1. **Determinism** — every output value is a pure function of source data
2. **Conservation of information** — preserve every preservable bit, don't invent
3. **Identity preservation** — clones in produce clones out
4. **Defensibility** — every mapping is justifiable as "the natural thing to do"
5. **Reversibility where format allows** — source recoverable from destination as much as possible

A specific corollary: **stat preservation is the primary signal of essence**. The numerical stats the player saw on the Gen 2 status screen are the most concrete representation of "what this Pokemon is." Conversion choices that produce closer Gen 3 stats are preferred over choices that preserve abstract notions of "training style" or "trainer intent."

This philosophy is the user's; do not argue with it unless you find a concrete contradiction.

## 3. Why this is hard, briefly

Gen 1 stores 4 DVs (0-15 each) for Atk/Def/Spe/Special, with HP DV derived from the others' parities. Stat Experience (StatExp) is a per-stat 16-bit accumulator (0-65535), with one shared Special StatExp value. No nature, no PID, no Sp.Atk/Sp.Def split, no abilities, no held items in Gen 1.

Gen 2 adds: held items, gender (derived from Atk DV vs species ratio), shininess (derived from specific DV combinations), Pokerus, and the data-format split between Sp.Atk and Sp.Def **stats** while keeping a **single shared Special DV and StatExp**. This is for backwards compatibility with Gen 1 via the Time Capsule.

Gen 3 changes everything: 6 independent IVs (0-31), 6 independent EVs (0-255 each, sum capped at 510), explicit nature (1 of 25), explicit PID (32-bit), explicit ability slot, abilities, held items, OT gender, met location, met level, fateful encounter flag, encryption, substructure ordering, and a checksum. The data structure is fundamentally larger and richer.

Nintendo's official solution (PKHeX's `PK1.ConvertToPK7()` codifies the VC → Bank approach) is to **discard almost everything**: random IVs with 3 forced 31s, zeroed EVs, nature derived from current EXP (non-deterministic across plays), random PID. The user's project deliberately rejects this approach.

## 4. Per-field conversion specification

### 4.0 Pre-flight: species eligibility

**Refuse to convert species that cannot be hatched from an egg.** The cover story (per 4.8) is "bred egg hatched in FireRed by the original trainer." Species that are not breedable in Gen 3 break this immediately.

Refused species (Egg Group: Undiscovered, plus all baby-pre-evos that cannot themselves be bred):
- All legendaries: Articuno, Zapdos, Moltres, Mewtwo, Mew, Raikou, Entei, Suicune, Lugia, Ho-Oh, Celebi
- Unbreedable evolutions (no eggs produced, even though the evolved form exists)

Implementation: maintain a hardcoded set of refused species IDs. Before conversion, check the source species against this set. If matched, refuse with a clear error message naming the species and reason ("Mew cannot be hatched from an egg; conversion refused").

Do not attempt clever workarounds (parent species, alternate cover story, etc.). Hard refuse.

### 4.1 IVs (from Gen 1/2 DVs)

**Formula: `IV = 2 * DV + randint(0, 1)` for every stat.**

The Gen 2 DV (0-15) maps to a Gen 3 IV (0-31). The naive doubling produces only even values; adding a random 0 or 1 covers both even and odd IVs at each rung. The resulting IV is always within ±1 of the source DV doubled.

Use a deterministic seed so the same source Pokemon always produces the same IVs: seed the RNG with `hash(ot_name || tid || species || personality_seed)` before drawing the six IV bits. This preserves "clones in produce clones out" while keeping the per-IV distribution Sidnoea uses.

**HP IV**: Calculate the Gen 2 HP DV first using the Gen 2 formula (LSB of Atk, Def, Spe, Special bits, in that order), then apply `2 * DV + randint(0, 1)`.

### 4.2 Special DV split (Sp.Atk / Sp.Def)

**Formula: `SpA_IV = SpD_IV = 2 * Special_DV + randint(0, 1)` (mirror split, single random draw used for both).**

The Gen 2 Special DV maps to both Sp.Atk and Sp.Def in Gen 3. Use a single random bit so SpA and SpD IVs match — this matches the vanilla Gen 2 cart's internal behaviour where Sp.Def is calculated from the same Special DV that drives Sp.Atk.

### 4.3 EVs (from Gen 1/2 StatExp)

**EVs are derived from source StatExp via direct conversion, with proportional scaling only when forced by the Gen 3 cap.**

**Algorithm**:

1. **Direct conversion**: `EV[i] = floor(sqrt(StatExp[i]))` for each stat, capped at 252.
2. **Special StatExp split**: feed the same `floor(sqrt(Special_StatExp))` value to both SpA and SpD before the cap check.
3. **Cap check**: if `sum(EV) ≤ 510`, the values from step 1 are used directly. No further changes.
4. **Proportional scaling**: if `sum(EV) > 510`, scale all stats by `510 / sum(EV)` and floor: `EV[i] = floor(EV[i] * 510 / sum_original)`.
5. **Remainder distribution**: rounding in step 4 typically leaves the new sum a few EVs short of 510. Distribute the residual using **Hamilton's method** — assign one EV at a time to the stat with the largest fractional remainder from step 4 (i.e., the largest value of `(EV[i] * 510 / sum_original) - floor(EV[i] * 510 / sum_original)`) until sum = 510. Tiebreak by lowest stat index for determinism.

Direct conversion is the canonical pret/pokecrystal mapping. Proportional scaling on overflow preserves the shape of training rather than picking winners and losers; uniform decrement is an alternative that produces similar aggregate stat preservation but flattens the training distribution, so we prefer proportional.

**Worked examples** (use as hardcoded test cases):

- *Untrained, all StatExp = 0*: → `[0, 0, 0, 0, 0, 0]`. Sum 0, no scaling.
- *Fully trained, all StatExp = 65535*: step 1 gives `[252, 252, 252, 252, 252, 252]` (sum 1512); step 4 scales to `[85, 85, 85, 85, 85, 85]` (sum 510, no remainder).
- *Partially trained, StatExp `[65535, 65535, 10000, 5000, 0, 0]`*: step 1 gives `[252, 252, 100, 70, 0, 0]` (sum 674); step 4 scales to `[190, 190, 75, 52, 0, 0]` (sum 507); step 5 distributes residual 3 to SpA (largest remainder 0.97), HP and Atk (tied at 0.68, lowest index first) → `[191, 191, 75, 53, 0, 0]` (sum 510).

### 4.4 Nature

**Always use neutral-bucketed derivation. No mode toggle. No alternatives.**

```
nature_bucket = ((Atk_DV << 4) | Def_DV) % 5
0 → Hardy   (Atk-themed neutral)
1 → Docile  (Def-themed neutral)
2 → Serious (Spe-themed neutral)
3 → Bashful (SpA-themed neutral)
4 → Quirky  (SpD-themed neutral)
```

Source-deterministic. All five natures are neutral 1.0× multipliers, so no stat deviation is introduced. The bucketing preserves 5 buckets of identity signal in the choice of which neutral nature.

### 4.5 Hidden Power

**Don't preserve. Don't try.** Hidden Power was removed from competitive play in Gen 8, and the IV randomisation in 4.1 means whatever HP type the converted Pokemon ends up with is whatever it ends up with. Don't constrain the IV draws to produce a specific HP type.

### 4.6 PID

**Search algorithm seeded from stable Gen 2 identity.** Iterate offset `k = 0, 1, 2, ...` and compute candidate `PID = SHA256(ot_name || tid || species || personality_seed || k)[:4]` until the PID satisfies all of:

1. `PID % 25 == nature` (matches the nature from 4.4)
2. **Gender matches**: `PID & 0xFF` compared against species gender ratio yields the same gender that Gen 2 derived from `Atk_DV`
3. **Shininess matches** the Gen 2 shiny status: `(TID ^ SID ^ (PID >> 16) ^ (PID & 0xFFFF)) < 8` if shiny in Gen 2, ≥8 if not
4. **Doesn't accidentally match a Method 1/2/4 wild encounter spread** (this prevents PKHeX from flagging the Pokemon as "looks like a caught wild Pokemon" when it claims to be from a bred egg). Validate by checking the PID doesn't satisfy any of the wild encounter generation methods for the Gen 3 RNG.

The bred-egg path (per 4.8) is more permissive than wild encounters — eggs use a separate breeding RNG that doesn't have to satisfy the Method 1/2/4 PID/IV relationships. As long as the PID doesn't accidentally look like a wild spread, it's valid for an egg-hatched Pokemon.

Worst case search depth should be small (a few hundred iterations) given the constraint stack. If it ever exceeds ~10,000, log a warning because something is wrong with the constraints.

**Note on hash choice**: SHA256 is overkill for determinism but slow on embedded hardware. If the conversion ever runs on the device itself rather than a host PC, consider a faster hash (xxHash, FNV, or even CRC32). Document whichever choice is made.

**Note on characteristic (Gen 4+)**: The Gen 4+ characteristic flavour text is derived at display time from `(highest_iv_stat, highest_iv_value % 5)`. It is not stored anywhere in the data structure. The characteristic falls out automatically from whatever IVs the conversion produces. **No PID constraint or special handling needed.**

**Note on Unown**: Unown's letter form in Gen 3 is encoded in specific bits of the PID (bits 0-1 of each PID byte, combined and modulo 28). The source Gen 2 Unown's letter is determined by DVs. For Unown specifically, the PID search must additionally constrain the resulting letter to match the source Gen 2 letter. Sidnoea/pokeBridge handles this by iterating PIDs that produce the desired letter (stepping by 28) and checking against other constraints. Reference that implementation for the bit-extraction logic. Other species don't need this handling.

### 4.7 OT name and TID

**Always preserved verbatim from the source Gen 1/2 cart.** Hard rule. This is the strongest essence-preservation anchor — the original trainer who caught this Pokemon retains ownership.

**SID derivation**: Gen 1/2 don't have a Secret ID. Derive it deterministically: `SID = SHA256(ot_name_bytes || tid.to_bytes(2, 'little'))[:2]`. This makes the SID stable per (OT, TID) pair, so the same source trainer always produces the same SID, which means shiny-by-construction is consistent across multiple converted mons from the same trainer. Document this clearly — some users will want to know their Gen 3 SID for shiny-checking purposes.

### 4.8 Met data

Bred egg hatched in FireRed by the original Gen 1/2 trainer (the OT preserved per 4.7), then traded to the current Gen 3 cart.

- **Origin game**: FireRed
- **Met game**: FireRed
- **Met location**: Four Island (location ID 146 / 0x92, the FRLG breeding daycare town). Hard-pinned, do not vary per Pokemon. Verified against Bulbapedia's Gen 3 location index list.
- **Met level**: 5
- **Egg flag**: FALSE
- **Fateful encounter flag**: FALSE
- **OT/TID**: preserved per 4.7

**OT name handling**: Gen 1/2 OT names fit within Gen 3's 7-character field. Apply the character mapping from 4.15. If a character has no Gen 3 equivalent, substitute a question mark; do not reject the Pokemon.

### 4.9 Moves

**Keep as-is from the Gen 1/2 source**, regardless of Gen 3 legality. The Gen 3 cart accepts any move IDs in a Pokemon's moveset; the legality check happens at the simulator/HOME layer. PKHeX may flag illegal movesets, but the player can use the in-game Move Deleter to fix them. **Do not silently rewrite movesets** — that's invisible essence destruction.

If a Gen 1/2 move doesn't exist in Gen 3 at all (none do, as far as I know — Gen 3 was a superset), then and only then substitute. There should be no such case in practice.

**PP and PP Ups**: preserve from source. These are properties of the Pokemon (the moves it knows and has practised), not the trainer relationship.

### 4.10 Held item

Preserve from Gen 2. Gen 1 mons get no item (they didn't have items). If the Gen 2 item doesn't exist in Gen 3, set to NO_ITEM rather than substituting. Held items are properties of the Pokemon, not the trainer relationship.

### 4.11 Pokerus

**Preserve opportunistically.** Both Gen 2 and Gen 3 use the same byte format for Pokerus state (upper 4 bits = strain, lower 4 bits = days remaining). Just copy the byte. Pokerus is a virus state attached to the Pokemon itself, independent of any trainer relationship.

### 4.12 Friendship / happiness

**Preserve from source.** Copy the Gen 2 friendship byte directly. For Gen 1 sources (no friendship field), set to species base from PersonalInfo. The OT is preserved (per 4.7) so the bond it represents is preserved with it.

### 4.13 Level and EXP

Preserve verbatim. The Gen 3 EXP formula uses the same growth groups as Gen 2 for all species that exist in both, so EXP values transfer 1:1.

### 4.14 Ability

Gen 3 introduced abilities. Source Gen 1/2 mons don't have one. Set to **ability slot 0** (the species' first ability) for all species. Do NOT use Hidden Abilities even though Nintendo's VC → Bank does — those weren't a concept in Gen 3, and giving a Gen 3-target Pokemon a Hidden Ability flag will break legality at every check downstream of Gen 3.

### 4.15 Nickname

Preserve from source. Gen 3 stores nicknames differently (different character encoding — Gen 1/2 use a custom encoding, Gen 3 uses a different custom encoding). Implement the character mapping table — most ASCII letters/digits map cleanly; some special characters (apostrophes, accented characters) need explicit mapping. Reference PKHeX's `StringConverter12.cs` and `StringConverter3.cs` for the canonical conversion tables.

### 4.16 Contest stats, ribbons, markings

All Gen 3+ concepts that don't exist in Gen 1/2. Set all to zero / none.

- **Contest stats** (cool/beauty/cute/clever/tough/sheen): 0
- **Ribbons**: none
- **Markings**: none

### 4.17 Checksum and encryption

The Gen 3 Pokemon data structure is **encrypted** (XOR with a key derived from PID and OT) and **checksummed**. Generate the checksum after all other fields are populated. Encrypt before writing to the Gen 3 save format. PKHeX's source has reference implementations; the algorithm is documented on Bulbapedia under "Pokemon data substructures (Generation III)."

## 5. Open issues that the implementer must decide

### 5.1 The 0-IV optimisation problem

A subset of Gen 2 competitive players deliberately catch/breed mons with **0 Attack DV** (for low confusion damage on special attackers like Alakazam) or **0 Speed DV** (for Trick Room teams, though Trick Room is Gen 4+). With the `2 * DV + randint(0, 1)` formula in 4.1, DV 0 maps to IV 0 or IV 1 with 50/50 probability. So half the time, 0-IV preservation happens for free.

If the implementer wants to guarantee preservation: add a per-stat check before the random draw — if `DV == 0`, force IV to 0 instead of drawing. Document the override in the conversion log so the player knows it was applied. Recommend this as the default behaviour, since the player who explicitly bred a 0-DV mon almost certainly wanted the 0 IV.

## 6. Non-goals and explicit rejections

Things the conversion tool should NOT do:

- **Don't validate moves against Gen 3 legality.** Keep them as-is. Legality is a downstream concern.
- **Don't present the Pokemon as an event/fateful-encounter Pokemon.** Bred egg only, per 4.8.
- **Don't deliver as an egg.** Already-hatched only, per 4.8.
- **Don't reroll IVs or EVs randomly to "look more natural."**
- **Don't implement the PCCS (Pokemon Community Conversion Standard)** from GearsProgress's Poke_Transporter_GB.
- **Don't implement Hidden Power preservation** via IV fudging.
- **Don't preserve "the trainer's intent" by interpreting low DVs as "they meant 0"** — see 5.1 for the optional heuristic.
- **Don't constrain the PID to produce a specific Gen 4+ characteristic** — it's derived from IVs at display time, no constraint needed.
- **Don't add an "EV redistribution mode" config** — 4.3 is the only algorithm.
- **Don't try to convert species refused by 4.0.** Refuse cleanly, don't synthesise a workaround.

## 7. Output format

The conversion tool should produce, per converted Pokemon, a structure containing:

```
{
  "species": <Gen 3 dex number>,
  "nickname": <converted, max 10 chars>,
  "ot_name": <converted from source, max 7 chars>,
  "ot_gender": <0=male, 1=female; if Gen 1, default 0 or expose as config>,
  "tid": <preserved from source>,
  "sid": <derived per 4.7>,
  "pid": <derived per 4.6>,
  "ivs": {hp, atk, def, spa, spd, spe},  // each 0-31
  "evs": {hp, atk, def, spa, spd, spe},  // each 0-252, sum ≤510
  "nature": <0-24>,
  "ability_slot": 0,
  "moves": [m1, m2, m3, m4],   // preserved from source
  "pp": [...],                 // preserved
  "pp_ups": [...],             // preserved (if Gen 2)
  "held_item": <preserved or NO_ITEM>,
  "friendship": <preserved from Gen 2 source, or species base from PersonalInfo for Gen 1 sources>,
  "exp": <preserved>,
  "level": <preserved>,
  "pokerus": <preserved byte>,
  "contest_stats": {cool: 0, beauty: 0, cute: 0, clever: 0, tough: 0, sheen: 0},
  "ribbons": [],
  "markings": 0,
  "met_location": 146,                         # Four Island (FRLG daycare, hex 0x92), per 4.8
  "met_level": 5,
  "met_game": "FireRed",
  "origin_game": "FireRed",
  "fateful_encounter": false,
  "is_egg": false,
  "language": <preserved from source>,
}
```

This struct is then encrypted, checksummed, and packed into the Gen 3 64-byte (party) or 80-byte (full) format by the encoder. Keep the struct intermediate representation clean and human-inspectable for debugging — don't go straight from source bytes to encrypted output.

## 8. Reference implementations to consult

In rough order of usefulness:

1. **PKHeX `PK1.cs`, `PK2.cs`, `PK3.cs`** (https://github.com/kwsch/PKHeX) — definitive source for Gen 1/2/3 data structure layouts, encoding tables, encryption, and checksums. Read these before writing anything.
2. **pret/pokecrystal wiki "Replace stat experience with EVs"** — canonical source for the `floor(sqrt(StatExp))` formula. This is exactly what 4.3 step 1 does; the only deviation is the proportional-scaling overflow handling.
3. **PKX Delta** (https://projectpokemon.org/home/files/file/640-pkx-delta/) — closest existing tool to what's being built. Closed source (Java), but its behaviour is documented in the Smogon and Project Pokemon threads. Use as a reference for "what does PKX Delta produce for input X" testing.
4. **Lorenzooone's Pokemon-Gen3-to-Gen-X** (https://github.com/Lorenzooone/Pokemon-Gen3-to-Gen-X) — open source, MIT, GBA homebrew. Conversion is in the *opposite* direction (Gen 3 → Gen 1/2), but the data-structure handling and encoding tables are directly reusable.
5. **VGMoose's blog post** (https://vgmoose.dev/blog/on-the-pokemon-bank-transfer-algorithm-6446734174/) — the philosophical anchor for the project.
6. **Bulbapedia "Pokemon data substructures (Generation III)"** — authoritative reference for the Gen 3 storage format.
7. **Sidnoea/pokeBridge** (https://github.com/Sidnoea/pokeBridge/blob/master/pokeBridge.py) — pure Python Gen 2 → Gen 3 save converter, single file, unmaintained. Most conversion choices differ from ours (random IVs, random nature, random PID, random SID, no fateful encounter handling, regular Pokemon not eggs), but its **save-file handling, substructure encryption/checksum, friendship preservation, and Unown letter handling** are directly useful as reference. The Unown logic in `setPersonality()` is the canonical pattern for the per-4.6 Unown PID search constraint.

## 9. Testing expectations

The conversion tool needs three layers of testing:

1. **Unit tests on individual field conversions**: known DV → known IV across the full range, known StatExp → known direct-conversion EV across the range (with edge cases at 0 and 65535), Hamilton's method remainder distribution with various sums, nature derivation across the full DV space (verify all five neutral natures appear with expected frequency), friendship lookup from PersonalInfo for various species, etc.
2. **Round-trip stat preservation tests**: take a Gen 2 mon, convert to Gen 3, compute Gen 3 stats with the converted EVs/IVs/nature, compare to source Gen 2 stats. Expected total absolute deviation across all six stats (averaged over 1000 random IV-bit draws):

   | Scenario | Avg total dev | Max total dev | Notes |
   |---|---|---|---|
   | Untrained Lv25 Pikachu (low DVs) | 1.0 | 2 | Essentially perfect |
   | Untrained Lv55 Feraligatr (mid DVs) | 2.0 | 4 | Essentially perfect |
   | Untrained Lv100 max-DV Charizard | 3.1 | 6 | Within IV-randomisation noise |
   | Lv100 max-DV competitive sweeper (Alakazam, fully trained Spe + Special) | 104 | 107 | ~8% loss on heavily-trained stats due to Special split forcing proportional scaling |
   | Lv100 max-DV fully trained on all 6 stats (Snorlax, all StatExp = 65535) | 255 | 258 | ~13% loss across all stats — unavoidable, the Gen 3 510-EV cap cannot represent 6 maxed stats |

   The Special split (one Special StatExp value going to both SpA and SpD) is the dominant source of loss for competitively-trained Pokemon. For most casual playthrough Pokemon (untrained or lightly trained), preservation is near-perfect.

3. **PKHeX legality validation**: feed converted Pokemon (after delivery) into PKHeX and verify it flags them only for the expected reasons (e.g., "traded Pokemon, hatched from egg in FRLG"). The Pokemon should pass legality as a normal bred-and-traded Pokemon, not be flagged as "invalid wild encounter spread" or "missing fateful encounter flag for event Pokemon."

Hardcoded test cases (EV redistribution only — IV-dependent stats vary with the random draw):
- **Untrained, all StatExp = 0**: EVs `[0, 0, 0, 0, 0, 0]`, sum 0.
- **Fully trained, all StatExp = 65535**: EVs `[85, 85, 85, 85, 85, 85]` after proportional scaling (sum 510, no remainder).
- **Partially trained, StatExp `[65535, 65535, 10000, 5000, 0, 0]`**: EVs `[191, 191, 75, 53, 0, 0]` (sum 510) after proportional scaling and Hamilton remainder distribution.

For determinism testing of the IV draw: with a fixed RNG seed (per 4.1, derived from `hash(ot_name || tid || species || personality_seed)`), the same source Pokemon must always produce the same IVs. Verify by running conversion twice on the same source and comparing.

## 10. What's *not* in this document

This document covers conversion only. It does NOT cover:

- **How the converted Pokemon gets into the Gen 3 save.** Multiple options are being evaluated: direct save injection (PKX Delta style), custom Mystery Event/Gift Wonder Card injection (suloku's Gen3-WCTool approach), e-Reader card emulation (pokecarde toolchain), or ACE payload (Poke_Transporter_GB approach). The conversion tool produces the abstract Pokemon structure; a separate "delivery" component handles getting it into the save.
- **Hardware design.** The GBxCart RW reader and any custom PCB work is separate.
- **UI/UX of the conversion tool.** Whether it's a CLI, a web UI, embedded firmware on the device, etc. The mode-selection UX described in 4.4 is a design constraint, not a UI specification.
- **Save file reading.** Parsing the Gen 1/2 cart save is a prerequisite but a solved problem; reuse PKHeX's save format handlers.

Ask the user before making decisions in any of those areas.
