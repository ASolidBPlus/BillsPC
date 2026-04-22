# Sprint 5 Archive — pokeportal Visual Makeover (Pokemon-faithful UI)

**Status**: PASS (archived 2026-04-22).
**Scope**: Replace S3a's minimal Vite UI with Gen-2-Crystal-style PC box browser, side-by-side Gen 1/2 ↔ Gen 3 status comparison, conversion-details transparency panel, GBC chrome + Pokemon GB pixel font, and per-cart sprite art (Red/Blue/Yellow/GS/Crystal).
**Test outcome**: 289 tests passing (238 core + 51 web), 1 permitted skip. Web bundle 31.6 KB gzipped (cap 200 KB).
**Previous sprint**: S3a (save reader + Vite UI). S3b (Web Serial GBxCart) and S4 (PKHeX legality harness) still deferred — S3b carried into the new S6 scope below.

---

## Retrospective amendments (binding for future sprints)

- **AMEND-S5-1** (HANDOFF correction, applied): `metLevel` for hatched-egg
  conversions is `0`, not `5`. PKHeX expects 0 for any mon whose origin is
  "hatched from egg." HANDOFF §4.8 should be read with this correction.
  Fixed in `core/src/fields/met.ts` (commit 61c4af9).
- **AMEND-S5-2** (HANDOFF correction, applied): SID derivation must
  truncate the OT byte buffer at the Gen 1/2 string terminator (`0x50`)
  *before* hashing. Without this, uninitialised trailing bytes drift the
  derived SID for two saves with the same logical OT name. Fixed in
  `core/src/fields/otSid.ts` (commit 4d41c02).
- **AMEND-S5-3** (HANDOFF correction, applied): Eeveelution internal IDs
  in Gen 1 are `0x66-0x69` (per pokered `pokemon_constants.asm`), not
  `0x42-0x45`. Misreading the pokered table led to Eevees being silently
  skipped from box parsing. Fixed in
  `core/src/sav/gen1/internalDex.ts` (commit afff067).
- **AMEND-S5-4** (HANDOFF correction, applied): Shiny-PID derivation now
  uses a constructive search (derive `pid_high` from SHA-256, then solve
  `pid_low = TID ^ SID ^ pid_high ^ delta` for delta ∈ 0..7) instead of
  a brute-force scan. Reduces ~410 k iterations per shiny to ~50 and
  eliminates the ~8.6 % of shinies that were hitting the search cap.
  Fixed in `core/src/fields/pid.ts` (commit 9c2460c).
- **AMEND-S5-5** (refused-list correction, applied): Babies (Pichu, Igglybuff,
  Cleffa, Tyrogue, Smoochum, Elekid, Magby, Togepi) are eligible — they
  can be hatched from breeding the corresponding adult, satisfying HOME-
  strict legality. Refused list shrunk from 20 to 12 entries (11 legendaries
  + Ditto). Fixed in `core/src/data/raw/refused.json` (commit c2bdcf1).
- **AMEND-S5-6** (forward-carried to S6): Gen 2 Crystal uses a slightly
  different character map than Gen 1 (bytes `0x90`, `0xF4`, possibly more
  diverge between PKHeX's Gen 1 and Gen 2 tables). The shared
  `decodeGen12` charmap drifts on a small number of nicknames containing
  these bytes. Filed as GitHub issue #1; cosmetic-only, doesn't affect
  conversion bytes. S6 (which will surface destination-side nicknames in a
  box-picker UI) should fix this before shipping the picker.

---

## What shipped

**Visual chrome.** GBC palette CSS custom properties (`--gbc-*`,
`--pc-blue`), Gen-2 dialog frame (`.gen2-dialog`), Pokemon GB pixel font
self-hosted at `web/public/fonts/pokemon-gb.woff2`,
`image-rendering: pixelated` everywhere a sprite is drawn.

**PC box browser** (`web/src/ui/boxBrowser.ts`). 4-col adaptive-row grid
of HGSS-style overworld sprites (TaTaTaZJJ/pokemon-overworld-for-gba),
walking-in-place CSS keyframe animation cycling frames 0↔3 of the
288×32 nine-frame strip (down-idle ↔ down-walk-A). Big species
(legendaries, Snorlax, etc.) get a 1.4× scale via `.is-big`.
Gen-2-style hover tooltip with mon nickname / species / level / OT.
Click to open the comparison overlay.

**Side-by-side comparison** (`web/src/ui/comparisonView.ts`). Left pane
labelled per-cart (`GEN 1 RED SOURCE`, `GEN 2 CRYSTAL SOURCE`, etc.)
with that cart's native sprite art (red/blue/yellow PNG; animated GIF
for Crystal). Right pane labelled `GEN 3 CONVERTED` with the Emerald
sprite. 5-stat layout (HP / ATTACK / DEFENSE / SPECIAL / SPEED) on the
left so SPEED bottom-aligns with the Gen 3 6-stat layout. Per-stat
deltas on the right (green > 0, red < 0, gray 0). SpD delta computed
against the displayed source SPECIAL value so the on-screen numbers
line up arithmetically.

**Conversion-details transparency panel** (`web/src/ui/details.ts`).
Two-column flow: stat tables on the left (DV→IV in 6-row form with
SpA/SpD tinted blue to indicate shared-Special-DV source; StatExp →
Raw EV → Final EV in matching 6-row form, with a yellow-highlighted
Σ row showing raw total, final total, and cap-510 status), identity
+ carryover on the right. Trailing note explains the Hamilton-remainder
proportional-cap factor when raw EV total exceeds 510, or confirms
no-scaling-needed when it doesn't.

**Per-cart sprite asset pack** (`web/public/sprites/`). 151 transparent
PNGs each for Red/Blue (shared), Yellow; 251 transparent PNGs for
Crystal static; 251 animated GIFs for Crystal animated; 251 9-frame
overworld strips. Defaults at `gen1/` (Yellow), `gen2/` (Crystal),
`gen3/` (Emerald). Routing in `web/src/ui/sprites.ts` per-cart helper
keys on `SaveFormat`, falling back to the default set when format is
null (destination side).

**Refusal display.** Gen-1-style "It cannot be moved." red dialog
replaces the S3a inline badge.

**State-machine extensions.** `loaded` state gained optional
`box: { index, cursor }` and `comparison: { ref } | null` fields.
Backwards-compatible with S3a discriminator
(`'idle' | 'parsing' | 'parse_error' | 'loaded'`).

**Tests.** Per-ndex sprite-presence test, comparison-delta math test
(FATMAN regression anchor), jsdom box-browser render test (20-tile →
8-tile after adaptive-rows refactor; `img.sprite` → `.ow-sprite`
background-image after CSS-animation refactor), shiny-render test
(same `.ow-sprite` adjustment), bundle-size gate.

**README.** Project overview, conversion formula reference, methodology
section, and pre-emptive note framing S3b (cart writer) as the real
delivery target — written in neutral language (no internal "cover
story" / orchestrator framing).

---

## Out-of-scope items still deferred to S6 (or beyond)

- **Web Serial GBxCart RW adapter** (was S3b — now folded into S6).
- **Save *writing* / Gen 3 save injection** (was S4-adjacent — now folded
  into S6: write the converted mon directly into a Gen 3 .sav, optionally
  flashed back to a cart).
- **Animation polish** — slide-in dialogs, screen fades, additional sprite
  walk frames.
- **Mobile responsive** — desktop ≥ 720 px only.
- **Audio cues** — silent UI is honest; not planned.
- **International (JP/FR/DE/IT/ES) save support** — English-only.
- **Multi-language UI strings** — English only.

---

> Sprint 5 PLAN.md and PLAN_EVAL.md are preserved in git history at
> commit `6f57e44` (planner output) and `088e7c5` (plan evaluator).
> They are intentionally NOT inlined here — they are 555 + 853 lines of
> planning artefact that have been fully superseded by the shipped
> implementation. Read them via
> `git show 6f57e44:PLAN.md` and `git show 088e7c5:PLAN_EVAL.md`
> if needed for historical reference.
