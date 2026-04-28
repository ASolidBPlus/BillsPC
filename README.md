# Bill's PC

> Cross-generation Pokémon transfer. Move your Gen 1 / Gen 2 mons forward to Gen 3 — from a SAV file or directly between physical Game Boy carts via GBxCart RW.

**Live demo: https://asolidbplus.github.io/BillsPC/**

Static web app, vanilla TypeScript, runs entirely client-side. Drop in your save (or plug in a cart with [GBxCart RW](https://www.gbxcart.com/)) and stage mons through Bill's PC workbench: pick from your source, drop in the transfer box, switch to destination, commit. The output is a Gen 3-legal record that survives the standard forward-transfer chain (Gen 3 → 4 → 5 → Bank → HOME).

## What it does

- **Reads** Gen 1 (Red/Blue/Yellow) and Gen 2 (Crystal) saves — `.sav` files OR live carts over Web Serial via GBxCart RW (Chromium browsers only).
- **Reads** Gen 3 destination saves (Ruby/Sapphire/Emerald, FireRed/LeafGreen) — `.sav` files OR live carts.
- **Converts** each Pokémon to a Gen 3 record using a deterministic algorithm aligned with VGMoose's "essence preservation" philosophy — preserves DVs, training, OT, friendship, held items, etc., as faithfully as Gen 3's data model allows.
- **Stages + commits** mons via the **Bill's PC workbench**:
  - Multi-select on the source side (cmd/ctrl/shift)
  - Push selected mons into a 30-slot persistent transfer box (IndexedDB-backed; survives reload + multi-tab safe)
  - SWITCH to destination, place mons into a Gen 3 box (preview overlay)
  - Commit each side: source-cart DELETE → SWITCH → dest-cart WRITE (with mandatory pre-write backup + post-write byte-by-byte verify)
- **Per-mon Stat Inspect** modal with pixel-faithful re-creations of the actual in-game stat screens (RBY status screen, GSC status screen, FRLG SKILLS sub-page).
- **Exports**: per-mon `.pk2` (Crystal box record), Backup-to-SAV (the loaded SAV with a timestamped filename), Transfer Box snapshot as JSON.

## Possible directions

Not promises — just the things I'd genuinely consider building if there's interest:

- **Gen 1/2 ROM-hack support** — Prism, Brown, Polished Crystal, Orange. The conversion pipeline already runs against arbitrary parsed `Gen12Pokemon` records; the lift is per-hack save-format detection + custom-species handling.
- **Modular stat-conversion choices** — opt out of EV preservation entirely, swap the StatExp → EV algorithm (proportional vs Hamilton vs caller-supplied), pick from a wider nature pool, etc. The conversion functions are already pure + composable; surfacing the levers in the UI is the main work.
- **Legendary + Ditto support** — currently the convert pipeline refuses all 11 Gen 1/2 legendaries plus Ditto (12 species total) because the bred-egg origin metadata doesn't fit them. Routing them through a different origin profile (event-distribution / Mystery Gift / fateful-encounter) would need a per-species legality study but is doable.

## Design philosophy: essence preservation

Aligned with [VGMoose's Bank-transfer-algorithm post](https://vgmoose.dev/blog/on-the-pokemon-bank-transfer-algorithm-6446734174/). Five principles:

1. **Determinism.** Every output value is a pure function of source bytes. Same source → same Gen 3 record, byte-for-byte.
2. **Conservation of information.** Preserve every preservable bit. Don't invent.
3. **Identity preservation.** Clones in produce clones out.
4. **Defensibility.** Every mapping is "the natural thing to do."
5. **Reversibility where format allows.** The Gen 3 record can be decoded back to the intermediate representation.

Every converted Pokémon is encoded as a **hatched egg from FireRed**, with the original trainer preserved from the source cart. Origin/met game = FireRed, met level = 0 (the value PKHeX expects for a hatched egg), met location = 146 (Four Island, the FRLG breeding daycare town), no fateful encounter, no egg flag. This is the only origin metadata pattern that survives forward-transfer through Bank and HOME without legality flags.

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
| **Ability slot**                       | derived from PID               | `pid & 1` for 2-ability species (Gen 3-faithful); pinned to slot 0 for 1-ability species. pkhex-legal in either case                                                                                                                                           |
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

## Legality notes

Three classes of pkhex flag the converter intentionally does not chase. Each is the user's call to fix in-game (or accept) before transferring:

1. **Movesets pass through verbatim.** Whatever moves your Gen 1/2 mon currently knows are written into the Gen 3 record as-is. pkhex checks every move against the species's Gen 3 learnset (level-up + TM + tutor + egg-move) and may flag moves the species can't legally know in Gen 3. Delete or relearn the offending moves in-game first if you care about pkhex-clean output.

2. **Pre-evolution-level mons fail the bred-egg origin check.** Some Pokemon can be caught in Gen 1/2 below the level their pre-evo would naturally evolve at (e.g. a wild Lv 37 Muk, where Grimer evolves at Lv 38). The Gen 3 origin profile this tool writes is "hatched from a bred egg" — and a bred egg can't legally produce a fully-evolved Muk before its evolution level. Train the mon past its evolution threshold before transferring.

3. **Hatched eggs are Lv 5 in Gen 3.** A bred egg in Gen 3 hatches at Lv 5, full stop. If you transfer a Lv 4 Pidgey (or any sub-Lv-5 mon), pkhex will flag the level as inconsistent with the bred-egg origin. Level it up to 5+ in-game first.

The "essence preservation" philosophy explicitly trades pkhex-clean defaults for honest data preservation — the tool will not silently change your moves or level your mon up to dodge these flags. The transferred mon WORKS in-game (the games themselves are more lenient than pkhex); the warnings are about HOME-strict legality, which is downstream of the user choosing to clean up first.

## Architecture

```
core/                       Pure conversion library, zero runtime deps
  src/
    types/                  Gen12Pokemon, Gen3Intermediate, ConvertOptions, Refusal, DecodeError
    primitives/             SHA-256 (vendored, NIST-vector tested), seeded RNG, personality seed
    fields/                 Per-field conversion (IV, EV, nature, PID search, ability)
    pack/                   Gen 3 substructure encoding, encryption, checksum, packBoxed/packParty/unpackBoxed
    sav/                    Gen 1/2 + Gen 3 save parsers, deleters, encoders
    transfer/               composeSourceWrite (DELETE) + composeDestinationWrite (INJECT)
    cart/                   Web Serial GBxCart adapter (read + write + flashCart pipeline)
    data/
      raw/                  PKHeX-derived JSON tables (species, refused, personal info, charmaps)
      *.ts                  Typed accessors

web/                        Vite static site; vanilla TypeScript, no framework
  src/
    main.ts, ui.ts          Entry + controller (legacy `?ui=v1` path retained as fallback)
    state.ts                Pure reducer
    download.ts, zip.ts     File download + fflate zip helpers
    cart/
      cartFlasher.ts        Backup → write → verify pipeline (S7b)
      cartReader.ts         Cart-mode source/dest read (S7a)
      stagingStore.ts       Slot-addressed 30-slot transfer box (IDB-backed)
      stagingPayload.ts     Sentinel-byte JSON serialization for Gen12Pokemon
    ui/
      workbench.ts          v2 Bill's PC layout (default)
      v2Actions.ts          Stage / commit handlers
      statScreen.ts         RBY/GSC/FRLG pixel-faithful Stat Inspect modal
      boxBrowser.ts, destBoxBrowser.ts
      confirmFlashDialog.ts, recoveryDialog.ts, flashProgressOverlay.ts
      ...
  public/
    sprites/                Self-hosted Gen 1/2/3/overworld + party-icon sprites
    fonts/                  PokemonGB + Pokemon Emerald pixel fonts (woff2)

tests/                      Cross-package unit + integration tests via vitest
scripts/                    Data ports + sprite fetchers + oracle generators
sprints/                    Frozen sprint archives (PLAN + PLAN_EVAL + EVAL per sprint)
HANDOFF.md                  Authoritative conversion spec
```

## Hardware support

Cart Mode talks to GBxCart RW over Web Serial. Tested on:

- **GBxCart RW v1.4 PCB-6** with R42+L14 firmware (the active maintained variant — insideGadgets shop)

Both Insidegadgets and FlashGBX protocols are implemented. The cart-write pipeline mirrors the FlashGBX read/erase/write/verify sequence — anything FlashGBX can flash, this tool can theoretically flash too (PCB-1 through PCB-6, original GBxCart RW, the various community-made clones, etc.) — but only PCB-6 has been HIL-validated end-to-end.

**OS support:**

- **Windows + macOS**: works out of the box. Plug in the cart, the browser prompts for the serial port, you're done.
- **Linux**: needs a udev rule to grant your user access to the GBxCart RW USB device (otherwise the browser can't enumerate it). Same rule FlashGBX uses on Linux works here. Without the rule you'll either need to run the browser as root (not recommended) or fix the device permissions manually each session.

Web Serial requires a Chromium-based browser (Chrome, Edge, Brave, Opera, Arc). Safari and Firefox don't support it; SAV upload mode still works in those.

## AI Disclaimer

Built with substantial AI-generated code under a [planner → generator → evaluator harness](https://www.anthropic.com/engineering/harness-design-long-running-apps) (Anthropic's "Harness design for long-running apps" pattern) with heavy human orchestrator oversight. Every sprint went through plan review, generator dispatch, code-evaluator verification, and HIL (hardware-in-the-loop) testing on real Game Boy carts before being treated as shipped. The conversion algorithms, cart-write pipeline, and stat-screen reconstructions were all human-reviewed against canonical references (PKHeX, pret disassemblies, Bulbapedia) line-by-line during the evaluator pass.

That said: **always keep a backup of any save file or cart before running it through this tool**. Cart writes are irreversible without the backup the tool downloads pre-flash.

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

`bun run --cwd web build` produces `web/dist/` — a fully static site that can be deployed to GitHub Pages, Cloudflare Pages, or any static host. The repo's own deploy workflow at `.github/workflows/deploy-pages.yml` ships to https://asolidbplus.github.io/BillsPC/ on every push to main.

## References

- [PKHeX](https://github.com/kwsch/PKHeX) — definitive source for Gen 1/2/3 data structures, charmaps, encryption, checksum, legality rules
- [pret/pokered](https://github.com/pret/pokered), [pret/pokegold](https://github.com/pret/pokegold), [pret/pokecrystal](https://github.com/pret/pokecrystal), [pret/pokeemerald](https://github.com/pret/pokeemerald) — disassembly of the original games; canonical for save layouts, base stats, internal indices
- [Bulbapedia "Pokémon data substructures (Generation III)"](<https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9mon_data_substructures_(Generation_III)>) — authoritative for the Gen 3 storage format
- [GBxCart RW](https://www.gbxcart.com/) (insideGadgets / LesserKuma) — the hardware adapter the cart-mode code talks to via Web Serial
- [VGMoose's blog post](https://vgmoose.dev/blog/on-the-pokemon-bank-transfer-algorithm-6446734174/) — philosophical anchor for the project

## Credits

- **[FlashGBX](https://github.com/lesserkuma/FlashGBX)** by Lesserkuma — the canonical reference for the GBxCart RW protocol. The cart-write pipeline (read / erase-sector / chunked-write / readback-verify with retry) is a faithful port of FlashGBX's flow. If anything cart-side works in this tool, it's because FlashGBX figured it out first.
- **Console pixel-art**: [AloneAgainstPixels](https://www.deviantart.com/aloneagainstpixels) (DeviantArt) — Game Boy + Game Boy Advance console sprites used in the workbench's trading-pipe lane.
- **Gen 1/2 party icons**: [SoupPotato/sourcrystal](https://github.com/SoupPotato/sourcrystal) — colorized via the vendored palette table from `data/menu_icon_pals.asm`.
- **Gen 3 party icons + FRLG SKILLS background**: [pret/pokeemerald](https://github.com/pret/pokeemerald) and the FRLG Summary Screen plugin from the Pokemon Essentials community.
- **Front sprites** (gen1, gen2, gen3, shinies, animated Crystal): [PokeAPI/sprites](https://github.com/PokeAPI/sprites).
- **Overworld follower sprites**: [TaTaTaZJJ/pokemon-overworld-for-gba](https://github.com/TaTaTaZJJ/pokemon-overworld-for-gba).
- **PokemonGB pixel font**: CC0 (vendored as `web/public/fonts/pokemon-gb.woff2`).
- **Pokemon Emerald TTF font**: by aztecwarrior28 (vendored as `web/public/fonts/pokemon-emerald.woff2`) — the canonical GBA in-game font for the FRLG stat-inspect modal.
- **Bill portrait**: © The Pokémon Company / Nintendo, used here as nominal fair-use reference (Bulbapedia FRLG sprite, transparent PNG).
- **Box wallpapers**: extracted via PKHeX assets.

## License

Code: MIT.

Sprite + font assets are 25-year-old Game Freak / Nintendo properties redistributed via public sprite repos under fair-use precedent (PKHeX, PokeAPI, pret disassembly projects, etc.). Use for non-commercial transfer-tool work; redistribution as bare sprite asset packs is discouraged.
