# PokeTimeCapsule

> Convert Pokémon from Gen 1 (Red/Blue/Yellow) and Gen 2 (Crystal) save files into Gen 3 wire-format records suitable for HOME-strict legality after the standard forward-transfer chain (Gen 3 → 4 → 5 → Bank → HOME).

Internal codename: **pokeportal**. Project repo named **PokeTimeCapsule** for the eventual hardware "transfer box" target.

## What it does (and what it doesn't)

This is the **conversion + packing** half of a larger system. It takes parsed Gen 1/2 Pokémon, produces:

- A typed `Gen3Intermediate` struct (the inspectable, debug-friendly intermediate form).
- 80-byte Gen 3 boxed records (`packBoxed`) ready to drop into a Gen 3 PC slot.
- 100-byte Gen 3 party records (`packParty`) with computed battle stats.

It does **not** (out of scope, deliberately):

- Read or write the Gen 3 save file at the cart level (the "delivery mechanism" is a separate concern, planned for hardware).
- Talk to a GBxCart RW (Web Serial adapter is a deferred sprint, S3b).
- Implement Pokemon Bank / Virtual Console / PoCo style import paths — those discard EVs, randomise IVs, and pick a nature from current EXP. We do strictly better than Nintendo.

## Design philosophy: essence preservation

Aligned with [VGMoose's Bank-transfer-algorithm post](https://vgmoose.dev/blog/on-the-pokemon-bank-transfer-algorithm-6446734174/). Five principles:

1. **Determinism.** Every output value is a pure function of source bytes. Same source → same Gen 3 record, byte-for-byte.
2. **Conservation of information.** Preserve every preservable bit. Don't invent.
3. **Identity preservation.** Clones in produce clones out.
4. **Defensibility.** Every mapping is "the natural thing to do."
5. **Reversibility where format allows.** `unpackBoxed` recovers the intermediate from the wire bytes.

The cover story for HOME-strict legality is **bred egg, hatched in FireRed at Four Island, OT preserved**. Origin/met game = FireRed, met level = 0 (PKHeX-correct for hatched eggs), met location = 146 (Four Island, the FRLG breeding daycare town), no fateful encounter, no egg flag, ability slot 0.

Species that cannot be hatched from an egg in Gen 3 are **refused** with a typed error — Mew, all legendaries, baby pre-evos (Pichu/Cleffa/Igglybuff/Togepi/Tyrogue/Smoochum/Elekid/Magby), Ditto. 20 species refused total.

## Per-field conversion summary

| Field                                  | Source                         | Conversion                                                                                                                                                                                                                                                    |
| -------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IV**                                 | Gen 1/2 DV (0-15)              | `IV = 2·DV + rand01` (deterministic seeded RNG); `preserveZeroDV` forces IV=0 when DV=0.                                                                                                                                                                      |
| **Special split**                      | Gen 1/2 single Special DV      | `SpA_IV = SpD_IV = 2·Special_DV + rand01` (mirror, single shared bit)                                                                                                                                                                                         |
| **EV**                                 | Gen 1/2 StatExp (0-65535)      | `EV[i] = floor(sqrt(StatExp[i]))` capped at 252; if Σ > 510, **proportional scale** by `510/Σ`, then **Hamilton remainder distribution** (largest fractional remainder gets +1)                                                                               |
| **Nature**                             | Gen 1/2 Atk_DV, Def_DV         | `bucket = ((Atk_DV << 4) \| Def_DV) % 5` → one of 5 **neutral natures** (Hardy/Docile/Serious/Bashful/Quirky). All 1.0× multipliers — no stat deviation introduced.                                                                                           |
| **PID**                                | personality-seed + constraints | Search for `pid` satisfying nature, gender, shininess, and not-Method-1/2/4/H1/H2/H4 wild-spread. Brute-force for non-shiny (~50 iters); **constructive** for shiny (~50 iters by deriving `pid_low = TID^SID^pid_high^delta`). Unown adds letter constraint. |
| **TID**                                | preserved verbatim             | —                                                                                                                                                                                                                                                             |
| **SID**                                | derived                        | `SID = SHA-256(otNameBytes ‖ tid_le)[:2]`. Stable per (OT, TID) pair.                                                                                                                                                                                         |
| **OT name / nickname**                 | Gen 1/2 charmap bytes          | Two-pass char map: Gen 1/2 → Unicode → Gen 3 byte. Unmapped → `?` (0xAC). Truncate to 7 (OT) / 10 (nickname). **Known issue**: see issue #1 (Gen 2 Crystal saves currently use Gen 1 RBY charmap — fix queued.)                                               |
| **Held item**                          | Gen 2 byte                     | Identity passthrough. Gen 1 sources get NO_ITEM. Gen 2-only items map to NO_ITEM.                                                                                                                                                                             |
| **Friendship**                         | Gen 2 byte                     | Preserved. Gen 1 sources use species' Gen 3 base friendship from `personal-gen3.json`.                                                                                                                                                                        |
| **Pokerus**                            | Gen 2 byte                     | Direct copy. Gen 1 sources get 0.                                                                                                                                                                                                                             |
| **Moves / PP / PP-Ups**                | Gen 1/2                        | Preserved verbatim. Gen 1 sources get PP-Ups [0,0,0,0]. Gen 1/2 move IDs match Gen 3 (Gen 3 is a superset).                                                                                                                                                   |
| **Level / EXP**                        | Gen 1/2                        | Preserved verbatim. Same growth groups across gens.                                                                                                                                                                                                           |
| **Ability slot**                       | —                              | Always **0** (HANDOFF §4.14). Hidden Abilities don't exist in Gen 3.                                                                                                                                                                                          |
| **Hidden Power**                       | —                              | Falls out of converted IVs automatically; no constraint.                                                                                                                                                                                                      |
| **Met data**                           | constants                      | Origin = FireRed, met = FireRed, met-level = 0, met-location = 146 (Four Island), fateful = false, isEgg = false.                                                                                                                                             |
| **Contest stats / ribbons / markings** | —                              | All zero.                                                                                                                                                                                                                                                     |

## Stat preservation: the 510-EV cap

Gen 3 caps total EVs at 510 across all 6 stats (252 max per stat). Gen 1/2 had effectively unlimited training. For broadly-trained Lv 100 Pokémon, this is **fundamentally lossy** — no algorithm can preserve numerical stats. We choose **proportional scaling** to preserve the _shape_ of training rather than picking winners and losers.

Empirical test results from a real Gen 1 Red save:

| Mon                                          | Lv  | Total StatExp | Total \|stat dev\| |
| -------------------------------------------- | --- | ------------- | ------------------ |
| Untrained Pikachu                            | 25  | 0             | **0** (perfect)    |
| Untrained Feraligatr                         | 55  | 0             | 1 (rounding)       |
| Untrained Charizard max-DV                   | 100 | 0             | 3                  |
| FATMAN (broadly-trained Charizard)           | 100 | 78,830        | 57 (~10/stat)      |
| Feraligatr (heavily-trained, shared StatExp) | 74  | 186,825       | 117 (~20/stat)     |
| Theoretical max-trained Snorlax              | 100 | 327,675       | ~255 (~42/stat)    |

For casual playthrough mons, conversion is near-perfect. For broadly-trained Lv 100s, the loss is algorithmically unavoidable — we ship the loss with full warnings rather than discarding training entirely (Nintendo's choice).

## Architecture

```
core/                       Pure conversion library, zero runtime deps
  src/
    types/                  Gen12Pokemon, Gen3Intermediate, ConvertOptions, Refusal, DecodeError
    primitives/             SHA-256 (vendored, NIST-vector tested), seeded RNG, personality seed
    fields/                 Per-§4 conversion functions (IV, EV, nature, PID search, etc.)
    pack/                   Gen 3 substructure encoding, encryption, checksum, boxed/party packing
    sav/                    Gen 1/2 save parsers (RBY + Crystal; GS/Yellow deferred)
    data/
      raw/                  PKHeX-derived JSON tables (species, refused, personal info, charmaps)
      *.ts                  Typed accessors

web/                        Vite static site; vanilla TypeScript, no framework
  src/
    main.ts, ui.ts          Entry + controller
    state.ts                Pure reducer
    download.ts, zip.ts     File download + fflate zip helpers
    ui/                     (S5 makeover) per-screen modules: boxBrowser, statusScreen, comparisonView, dialog, menu, sprites
  public/
    sprites/                (S5) self-hosted Gen 1/2/3/overworld sprites, lazy-loaded

tests/                      Cross-package unit + integration tests via vitest

scripts/                    One-off tools: gen-personal-info.ts (data port), gen-pkhex-vector.ts (oracle), demo-red-*.ts, demo-crystal.sav (test fixtures), fetch-sprites.ts (S5)

sprints/                    Frozen sprint archives (PLAN + PLAN_EVAL + EVAL per sprint)

HANDOFF.md                  Authoritative conversion spec (308 lines)
CLAUDE.md                   Sprint methodology + harness rules
```

## Sprint history

Each sprint is **Planner → Plan Evaluator → Generator → Code Evaluator** with binding amendments. Frozen artefacts in `sprints/sprint-N.md`.

| Sprint  | Scope                                                                                                                                                            | Status                                                        |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **S1**  | Conversion core: data tables, IV/EV/nature/PID algorithms, refused species, full unit + property tests                                                           | ✅ PASS — 113 tests                                           |
| **S2**  | Gen 3 wire format: substructure shuffle (PID%24), XOR encryption, checksum, packBoxed/packParty/unpackBoxed, independent PKHeX-spec oracle test                  | ✅ PASS — 183 tests                                           |
| **S3a** | Save reader (RBY + Crystal) + Vite web UI with file upload + .pk3 download + .zip batch                                                                          | ✅ PASS — 261 tests                                           |
| **S3b** | Web Serial GBxCart RW adapter (Chromium-only, with file-upload fallback)                                                                                         | Deferred (no target hardware yet)                             |
| **S4**  | PKHeX legality harness (automated)                                                                                                                               | Dropped (real-PKHeX manual testing covers it strictly better) |
| **S5**  | Pokémon-faithful UI: GBC chrome, side-by-side Gen 1/2 vs Gen 3 status comparison, Crystal Clear overworld sprites in box, PokeAPI front sprites, shiny indicator | In progress                                                   |

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

# preview the built site
bun --cwd web exec vite preview --host 0.0.0.0 --port 8080
```

`bun run --cwd web build` produces `web/dist/` — a fully static site that you can deploy to GitHub Pages, Cloudflare Pages, or any static host.

## Bug fixes worth noting

- **commit `afff067`**: Eeveelution internal IDs corrected (0x66-0x69, not 0x42-0x45). My initial demo table had them at MissingNo slots; user caught it via "no Eevees showing" in the web app.
- **commit `9c2460c`**: Shiny PID search rewritten to use **constructive derivation**. The HANDOFF §4.6 brute-force loop expected ~few hundred iterations; the shiny constraint adds 1/8192, making expected iterations ~410k and the 1M cap insufficient ~8.6% of shinies. Caught by user's shiny Raichu (SPARKY) failing CONVERT_THREW. Fix: derive `pid_high` from SHA-256, then construct `pid_low = TID^SID^pid_high^delta` to satisfy the shiny invariant; expected iterations drop to ~50.
- **commit `61c4af9`**: `Gen3Intermediate.metLevel` changed from 5 to **0**. PKHeX flags non-zero met_level on hatched eggs. HANDOFF §4.8 mandated 5 — wrong. Caught by user's PKHeX legality run on FATMAN.

## Known issues

See [GitHub issues](https://github.com/ASolidBPlus/PokeTimeCapsule/issues). Notable open:

- **#1** Gen 2 Crystal saves use Gen 1 RBY charmap; PKHeX uses a separate Gen 2 table. Bytes 0x90 and 0xF4 differ. Affects nickname display and Gen 3 nickname output. Fix scope ~30 min.

## References

The conversion algorithms cite specific PKHeX source files and Bulbapedia pages for verification. Primary references:

- [PKHeX](https://github.com/kwsch/PKHeX) — definitive source for Gen 1/2/3 data structures, charmaps, encryption, checksum
- [pret/pokered](https://github.com/pret/pokered), [pret/pokegold](https://github.com/pret/pokegold), [pret/pokecrystal](https://github.com/pret/pokecrystal) — disassembly of the original games; canonical for save layouts and base stats
- [Bulbapedia "Pokémon data substructures (Generation III)"](<https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9mon_data_substructures_(Generation_III)>) — authoritative for the Gen 3 storage format
- [PokeAPI sprite repo](https://github.com/PokeAPI/sprites) — front sprites for all gens
- [Crystal Clear](https://github.com/ShockSlayer/crystal-clear) — overworld sprites for the PC box browser
- [VGMoose's blog post](https://vgmoose.dev/blog/on-the-pokemon-bank-transfer-algorithm-6446734174/) — philosophical anchor for the project

## License

Code: MIT. Sprite assets are 25-year-old Game Freak / Nintendo properties redistributed via public sprite repos under fair-use precedent (PKHeX, PokeAPI, etc.). See `web/public/sprites/LICENSE-sprites.txt` for sprite attribution. Pokémon font is CC0.
