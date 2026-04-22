# PokeTimeCapsule

> Convert Pokémon from Gen 1 (Red/Blue/Yellow) and Gen 2 (Crystal) save files into Gen 3 wire-format records suitable for HOME-strict legality after the standard forward-transfer chain (Gen 3 → 4 → 5 → Bank → HOME).

Static web app, vanilla TypeScript, runs entirely client-side. Drop in your Game Boy save, get back a Gen 3-legal `.pk3` file (or a `.zip` of all your boxes) ready to drop into a Gen 3 PC slot.

## What it does

- **Reads** Gen 1 (Red/Blue) and Gen 2 (Crystal) save files (`.sav`, 32 KB SRAM dump).
- **Converts** each Pokémon to a Gen 3 record using a deterministic algorithm aligned with VGMoose's "essence preservation" philosophy — preserves DVs, training, OT, friendship, held items, etc., as faithfully as Gen 3's data model allows.
- **Outputs** 80-byte Gen 3 boxed records (`.pk3`) or 100-byte party records, encrypted and checksummed per Bulbapedia's Gen 3 substructure spec.
- **Refuses** species that can't legally be hatched from an egg in Gen 3 (legendaries, baby pre-evos, Ditto), with a clear reason.

## What it doesn't do (yet)

- **Direct cart writing** — output today is a downloadable file. A future sprint adds Web Serial support for the GBxCart RW so the app can write the converted Pokémon straight into a Gen 3 cart's PC, end-to-end in the browser. Until that lands, the `.pk3` output drops cleanly into PKHeX or any tool that imports Gen 3 records.
- **Pokemon Bank / Virtual Console-style import** — Nintendo's official VC → Bank chain discards EVs, randomises IVs (with 3 forced 31s), and picks a nature from current EXP. This project does strictly better: deterministic, EV-preserving, legality-defensible.
- **Gold/Silver, Yellow, romhack saves** — Crystal and RBY only at the moment. GS and Yellow detection returns a typed "unsupported variant" error rather than silently misparsing.

## Design philosophy: essence preservation

Aligned with [VGMoose's Bank-transfer-algorithm post](https://vgmoose.dev/blog/on-the-pokemon-bank-transfer-algorithm-6446734174/). Five principles:

1. **Determinism.** Every output value is a pure function of source bytes. Same source → same Gen 3 record, byte-for-byte.
2. **Conservation of information.** Preserve every preservable bit. Don't invent.
3. **Identity preservation.** Clones in produce clones out.
4. **Defensibility.** Every mapping is "the natural thing to do."
5. **Reversibility where format allows.** The Gen 3 record can be decoded back to the intermediate representation.

Every converted Pokémon is encoded as a **hatched egg from FireRed**, with the original trainer preserved from the source cart. Origin/met game = FireRed, met level = 0 (the value PKHeX expects for a hatched egg), met location = 146 (Four Island, the FRLG breeding daycare town), no fateful encounter, no egg flag, ability slot 0. This is the only origin metadata pattern that survives forward-transfer through Bank and HOME without legality flags.

Species that cannot be hatched from an egg in Gen 3 are **refused** with a typed error — all 11 Gen 1/2 legendaries plus Ditto (Ditto × Ditto produces no egg). 12 species refused total. Babies (Pichu, Cleffa, Igglybuff, Togepi, Tyrogue, Smoochum, Elekid, Magby) are _not_ refused — they hatch from breeding their adult forms in Gen 3 FRLG.

## Per-field conversion summary

| Field                                  | Source                         | Conversion                                                                                                                                                                                                                                                     |
| -------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IV**                                 | Gen 1/2 DV (0–15)              | `IV = 2·DV + rand01` (deterministic seeded RNG); optional `preserveZeroDV` forces IV=0 when DV=0                                                                                                                                                               |
| **Special split**                      | Gen 1/2 single Special DV      | `SpA_IV = SpD_IV = 2·Special_DV + rand01` (mirror split, single shared random bit)                                                                                                                                                                             |
| **EV**                                 | Gen 1/2 StatExp (0–65535)      | `EV[i] = floor(sqrt(StatExp[i]))` capped at 252; if Σ > 510, **proportional scale** by `510/Σ`, then **Hamilton remainder distribution** (largest fractional remainder gets +1)                                                                                |
| **Nature**                             | Atk_DV, Def_DV                 | `bucket = ((Atk_DV << 4) \| Def_DV) % 5` → one of 5 **neutral natures** (Hardy/Docile/Serious/Bashful/Quirky). All 1.0× multipliers — no stat deviation introduced                                                                                             |
| **PID**                                | personality-seed + constraints | Search for `pid` satisfying nature, gender, shininess, and not-Method-1/2/4/H1/H2/H4 wild-spread. Brute-force for non-shiny (~50 iters); **constructive** for shiny (~50 iters by deriving `pid_low = TID^SID^pid_high^delta`). Unown adds a letter constraint |
| **TID**                                | Gen 1/2                        | Preserved verbatim                                                                                                                                                                                                                                             |
| **SID**                                | derived                        | `SID = SHA-256(otNameBytes ‖ tid_le)[:2]`. Stable per (OT, TID) pair                                                                                                                                                                                           |
| **OT name / nickname**                 | Gen 1/2 charmap bytes          | Two-pass char map: source → Unicode → Gen 3 byte. Unmapped → `?` (0xAC). Truncate to 7 (OT) / 10 (nickname)                                                                                                                                                    |
| **Held item**                          | Gen 2 byte                     | Identity passthrough. Gen 1 sources get NO_ITEM. Gen 2-only items map to NO_ITEM                                                                                                                                                                               |
| **Friendship**                         | Gen 2 byte                     | Preserved. Gen 1 sources use the species' Gen 3 base friendship                                                                                                                                                                                                |
| **Pokerus**                            | Gen 2 byte                     | Direct copy. Gen 1 sources get 0                                                                                                                                                                                                                               |
| **Moves / PP / PP-Ups**                | Gen 1/2                        | Preserved verbatim. Gen 1 sources get PP-Ups [0,0,0,0]. Move IDs match Gen 3 (Gen 3 is a superset)                                                                                                                                                             |
| **Level / EXP**                        | Gen 1/2                        | Preserved verbatim. Same growth groups across gens                                                                                                                                                                                                             |
| **Ability slot**                       | —                              | Always **0**. Hidden Abilities don't exist in Gen 3                                                                                                                                                                                                            |
| **Hidden Power**                       | —                              | Falls out of converted IVs automatically; no constraint imposed                                                                                                                                                                                                |
| **Met data**                           | constants                      | Origin = FireRed, met = FireRed, met-level = 0, met-location = 146 (Four Island), fateful = false, isEgg = false                                                                                                                                               |
| **Contest stats / ribbons / markings** | —                              | All zero                                                                                                                                                                                                                                                       |

## Stat preservation: the 510-EV cap

Gen 3 caps total EVs at 510 across all 6 stats (252 max per stat). Gen 1/2 had effectively unlimited training (StatExp 0–65535 per stat, no shared cap). For broadly-trained Lv 100 Pokémon, this is **fundamentally lossy** — no algorithm can preserve numerical stats exactly. This project chooses **proportional scaling** to preserve the _shape_ of training rather than picking winners and losers.

Empirical results across the predicted training tiers:

| Profile                                    | Total StatExp | Total \|stat dev\| at Lv 100 |
| ------------------------------------------ | ------------- | ---------------------------- |
| Untrained (all StatExp = 0)                | 0             | **0** (perfect)              |
| Lightly trained, low DVs                   | < 5,000       | 0–3                          |
| Untrained max-DV                           | 0             | 3–6 (IV randomisation noise) |
| Broadly trained (~80,000 sum, even spread) | ~80k          | ~10/stat, ~57 total          |
| Heavily trained (~180,000 sum)             | ~180k         | ~20/stat, ~117 total         |
| Theoretical max (all StatExp = 65535)      | 327,675       | ~42/stat, ~255 total         |

For casual playthrough mons, conversion is near-perfect. For broadly-trained Lv 100s, the loss is algorithmically unavoidable — the project ships the loss with full transparency rather than discarding training entirely.

## Architecture

```
core/                       Pure conversion library, zero runtime deps
  src/
    types/                  Gen12Pokemon, Gen3Intermediate, ConvertOptions, Refusal, DecodeError
    primitives/             SHA-256 (vendored, NIST-vector tested), seeded RNG, personality seed
    fields/                 Per-field conversion functions (IV, EV, nature, PID search, etc.)
    pack/                   Gen 3 substructure encoding, encryption, checksum, packBoxed/packParty
    sav/                    Gen 1/2 save parsers (RBY + Crystal)
    data/
      raw/                  PKHeX-derived JSON tables (species, refused, personal info, charmaps)
      *.ts                  Typed accessors

web/                        Vite static site; vanilla TypeScript, no framework
  src/
    main.ts, ui.ts          Entry + controller
    state.ts                Pure reducer
    download.ts, zip.ts     File download + fflate zip helpers
    ui/                     Per-screen modules: boxBrowser, statusScreen, comparisonView, dialog, menu, sprites
  public/
    sprites/                Self-hosted Gen 1/2/3/overworld sprites, lazy-loaded

tests/                      Cross-package unit + integration tests via vitest

scripts/                    One-off tools (data ports, sprite fetchers, oracle generators)

sprints/                    Frozen sprint archives (PLAN + PLAN_EVAL + EVAL per sprint)

HANDOFF.md                  Authoritative conversion spec (308 lines)
```

## Sprint roadmap

| Sprint  | Scope                                                                                                                                                                                   | Status      |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| **S1**  | Conversion core: data tables, IV/EV/nature/PID algorithms, refused species, full unit + property tests                                                                                  | Done        |
| **S2**  | Gen 3 wire format: substructure shuffle (PID%24), XOR encryption, checksum, packBoxed / packParty / unpackBoxed, independent PKHeX-spec oracle test                                     | Done        |
| **S3a** | Save reader (RBY + Crystal) + Vite web UI with file upload + .pk3 download + .zip batch                                                                                                 | Done        |
| **S5**  | Pokémon-faithful UI: GBC chrome, side-by-side Gen 1/2 vs Gen 3 status comparison, overworld sprites in box browser, PokeAPI front sprites, shiny indicator                              | In progress |
| **S3b** | Web Serial GBxCart RW adapter — read source cart and write converted Pokémon directly to a Gen 3 cart, end-to-end in the browser. Chromium-only; file-upload remains the universal path | Planned     |

## Running locally

```bash
# install
bun install

# core + web tests
bun run test
bun run --cwd web test

# typecheck, lint, format
bun run typecheck
bun run lint
bun run format:check

# build the static web app
bun run --cwd web build

# preview the built site at http://localhost:8080
bun --cwd web exec vite preview --host 0.0.0.0 --port 8080
```

`bun run --cwd web build` produces `web/dist/` — a fully static site that you can deploy to GitHub Pages, Cloudflare Pages, or any static host.

## Notable design decisions

- **Constructive shiny PID derivation.** The naive brute-force loop expected ~50 iterations for typical constraint stacks but the shiny constraint adds 1/8192, blowing past any reasonable hard cap on a non-trivial fraction of shinies. The fix: derive `pid_high` from SHA-256, then construct `pid_low = TID^SID^pid_high^delta` to satisfy the shiny invariant by construction. Brute-force only the remaining nature/gender/not-method constraints. Expected iterations stay ~50 even for shinies.

- **Met-level = 0 for hatched eggs.** PKHeX flags non-zero `met_level` on hatched eggs as illegal; eggs are "met" at level 0 (pre-hatch placeholder), and the in-party current level (5 at hatch) is stored separately in the party-tail block.

- **Independent PKHeX-spec oracle test.** Sprint 2 ships an independent reimplementation of the Gen 3 packer in `scripts/gen-pkhex-vector.ts` that consumes only the spec (Bulbapedia / PKHeX layouts) without importing the production code. Production `packBoxed` is asserted byte-identical against the oracle's output on multiple fixtures, eliminating circular self-consistency tests.

## References

- [PKHeX](https://github.com/kwsch/PKHeX) — definitive source for Gen 1/2/3 data structures, charmaps, encryption, checksum
- [pret/pokered](https://github.com/pret/pokered), [pret/pokegold](https://github.com/pret/pokegold), [pret/pokecrystal](https://github.com/pret/pokecrystal) — disassembly of the original games; canonical for save layouts and base stats
- [Bulbapedia "Pokémon data substructures (Generation III)"](<https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9mon_data_substructures_(Generation_III)>) — authoritative for the Gen 3 storage format
- [PokeAPI sprite repo](https://github.com/PokeAPI/sprites) — front sprites for all gens
- [Crystal Clear](https://github.com/ShockSlayer/crystal-clear) — overworld sprites for the PC box browser
- [VGMoose's blog post](https://vgmoose.dev/blog/on-the-pokemon-bank-transfer-algorithm-6446734174/) — philosophical anchor for the project

## License

Code: MIT. Sprite assets are 25-year-old Game Freak / Nintendo properties redistributed via public sprite repos under fair-use precedent (PKHeX, PokeAPI, etc.). Pokémon font is CC0.
