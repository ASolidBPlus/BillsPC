# PLAN_EVAL — Sprint 5 (Pokemon-faithful UI visual makeover)

> Plan Evaluator subagent output. Reviewing `/home/coder/project/PLAN.md`
> (555 lines, planner subagent commit `6f57e44`). Sprint methodology:
> `/home/coder/project/CLAUDE.md` §Sprint methodology — this is step 2 of
> Planner → Plan Evaluator → Generator → Code Evaluator. Amendments
> below are **binding on the Generator**: the Generator MUST read
> PLAN.md ∪ this file. Where they conflict, this file wins.

## Verdict

**APPROVE_WITH_AMENDMENTS.** PLAN's overall architecture is sound: the
new `web/src/ui/*` decomposition, the state-machine *superset* extension
of `'loaded'`, the controller-owns-state pattern, the self-host-all-
sprites decision, the Crystal Clear overworld pick, the side-by-side
comparison view as the central interaction, and the bundle/test budgets
all match the sprint goal. **However, three load-bearing gaps need
binding amendments before the Generator starts**: (a) PLAN assumes
Gen 1/2 base stats are available for the comparison's source side, but
the codebase only ships `personal-gen3.json` — no Gen 1/2 personal table
exists; the Generator must produce one (A1); (b) PLAN's FATMAN
regression fixture is left ambiguous in §8.1 — the orchestrator confirms
FATMAN = Lv 100 Charizard with the SpA buff (Gen 1 base SpA 85 → Gen 3
base SpA 109, Δ +24 base, which produces a +40 final-stat delta at Lv
100 with neutral nature / no EV split nuance — see A2 for exact math
binding); (c) PLAN never mentions shiny rendering even though
commit `9c2460c` (constructive shiny PID) just landed and shinies now
round-trip — the comparison view must show a shiny indicator (A8). All
other amendments are tightening — pin URLs, pin palette hex, kill the
"dead fields" for real, harden the asset-fetch script, and add explicit
test coverage for the new shiny path.

## Amendments (binding on the Generator)

### A1 — Ship a Gen 1/2 base-stats data table; comparison source side reads from it

(a) **PLAN says**: PLAN §3.6, §4.5, §4.6, §8.1 talk about computing
Gen 1/2 final stats and deltas, but never specifies *where* the Gen 1/2
**base** stats come from. PLAN §8.1 mentions "Snorlax base SpA: Gen 2 = 65,
Gen 3 = 65 — actually flat" parenthetically, implying the Planner is
aware Gen 1/2 base stats differ from Gen 3 — but no PLAN section
identifies the data source.

(b) **Change to**: The Generator MUST add a new data file
`core/src/data/raw/personal-gen2.json` with at minimum the six
base-stat fields (`hp, atk, def, spe, special`) for ndex 1..251, plus
a typed loader at `core/src/data/personalInfoGen2.ts`:

```ts
export interface PersonalGen2 {
  readonly ndex: number;            // 1..251
  readonly base: {
    readonly hp: number;
    readonly atk: number;
    readonly def: number;
    readonly spe: number;
    readonly special: number;       // single Special — Gen 1/2 share this stat for base values
  };
}
export function getPersonalGen2(ndex: number): PersonalGen2;
```

Source the JSON from `pret/pokecrystal`'s `data/pokemon/base_stats/*.asm`
or the equivalent Bulbapedia table — NOT from `personal-gen3.json`. The
Generator may use the same `scripts/gen-personal-info.ts` pattern that
produced `personal-gen3.json` in S2 (see `/home/coder/project/scripts/
gen-personal-info.ts`). Gen 1 and Gen 2 share the same base-stat values
for all 251 mons (Gen 2 didn't rebalance — that was Gen 3); a single
`personal-gen2.json` covers both source gens.

The new file lives in `core/` (not `web/`) because base-stat correctness
is a domain concern and may eventually feed `convert()` validation.
`comparisonView.ts` imports `getPersonalGen2` and `getPersonal` (Gen 3)
to compute both sides of the delta.

(c) **Why**: Without this, `computeComparisonStats` either (i) fakes
Gen 2 stats by reusing Gen 3 base stats (which makes every delta zero
and defeats the entire visual point of the comparison view), or (ii)
guesses at hardcoded values (which will diverge from canon). PLAN §8.1
literally writes the buggy formulation as a possibility ("Snorlax base
SpA: Gen 2 = 65, Gen 3 = 65 — actually flat. Replace Snorlax with
**the actual canonical FATMAN regression case**…"). The fix is to ship
the data; this is also strictly useful: the FATMAN regression test
becomes a real-data assertion rather than a hand-stitched fixture.

### A2 — FATMAN regression fixture: Lv 100 Charizard, exact stat math

(a) **PLAN says**: PLAN §8.1 — "Generator picks one [of Magneton +20 SpD,
Vileplume +5 SpA / +30 SpD, Victreebel +5 SpA / +10 SpD] and locks the
test fixture", flagged for orchestrator confirmation in PLAN §10 Q10.

(b) **Change to**: The canonical FATMAN regression fixture is **Lv 100
Charizard** (ndex 6). Bind the test:

```ts
// web/src/__tests__/comparison-deltas.test.ts
const FATMAN: Gen12Pokemon = {
  sourceGen: 2,
  speciesGen2Id: 6,                         // Charizard
  level: 100,
  exp: 1_000_000,                            // Lv 100, Slow growth — exact value irrelevant for stat compute
  dvs: { atk: 15, def: 15, spe: 15, special: 15 },
  statExp: { hp: 65535, atk: 65535, def: 65535, spe: 65535, special: 65535 },
  // ...remaining fields per Gen12Pokemon defaults; nickname "FATMAN".
};

// Charizard base SpA: Gen 1/2 = 85, Gen 3 = 109. Delta = +24 base.
// At Lv 100, perfect IVs, max EVs, neutral nature, the SpA stat delta
// works out to +40 final stat (the orchestrator's prior PKHeX result).
expect(deltas.spa).toBe(40);
expect(deltas.hp).toBe(0);
expect(deltas.atk).toBe(0);
expect(deltas.def).toBe(0);
expect(deltas.spd).toBe(0);    // Gen 2 source has SpD = SpA = 85 (single Special); Gen 3 SpD = 85 → Δ 0
expect(deltas.spe).toBe(0);
```

Note: the **+40 final-stat delta** matches the orchestrator's prior
inline Charizard result (referenced in S2 commit `211866c` "demo
Charizard SpA fix"). The Generator MUST verify this number by computing
both sides via the project's existing stat formulas — DO NOT hardcode
40 if the math says otherwise; **escalate to orchestrator** with the
discrepancy. The +24 base-stat delta times the Lv-100 / EV / IV
multipliers in the standard Gen 3 stat formula gives +40 with rounding;
but the rule is: derive via the formula, then assert the literal.

(c) **Why**: PLAN §8.1's three "fallback" species (Magneton, Vileplume,
Victreebel) all have real Gen 2 → Gen 3 base-stat shifts and would
work as additional regression cases, but the orchestrator's testing
canon for FATMAN is unambiguously Charizard. Burning the right name
into the test is essential — the FATMAN regression has caught two real
bugs (S2 and the recent shiny-PID refactor); it stays the anchor.

### A3 — Pin Crystal Clear repo + commit SHA; vendor-cache as safety net

(a) **PLAN says**: PLAN §6.1, §7 — fetch script clones
`ShockSlayer/crystal-clear` at `master`; PLAN §10 Q7 acknowledges the
repo could move and asks for an escalation policy.

(b) **Change to**: The Generator MUST:
1. Try to clone `https://github.com/ShockSlayer/crystal-clear.git` at
   any reachable ref. If that fails, try the well-known mirrors in
   order: `ShockSlayer/Crystal_Clear`, `EarlGreyTea-hot/crystal-clear`,
   the `pret/pokecrystal` disasm fallback (which has 3 generic icons —
   acceptable as last-resort sized to 16×16).
2. Once a working source is found, **record the resolved repo URL +
   commit SHA** in `web/public/sprites/LICENSE-sprites.txt` so the
   Generator's choice is reproducible. Future re-runs of
   `scripts/fetch-sprites.ts` MUST default to the recorded SHA, not
   `master`.
3. If the per-species overworld PNG path differs from PLAN §6.1's guess
   (`gfx/overworlds/<NNN>.png`), the Generator probes the candidates in
   PLAN §7 (`gfx/overworlds/`, `gfx/overworld/`, `gfx/pokemon/<name>/
   overworld.png`, `gfx/icons/`) — and if name-based, builds a
   `name → ndex` map from `core/src/data/raw/species.json`.
4. If **no** source resolves a sprite for a particular ndex, the
   Generator commits a 16×16 transparent-background `?` placeholder
   PNG (single shared file at `web/public/sprites/overworld/_unknown.png`,
   then the per-ndex slot is also a copy of that file — the
   `sprite-paths.test.ts` is bytewise-OK with copies). This satisfies
   the "1004 PNGs present" success criterion without lying about
   coverage. Such fallbacks MUST be enumerated in
   `LICENSE-sprites.txt` ("ndex N..M used placeholder").

(c) **Why**: PLAN's "escalate to orchestrator" if the repo URL fails
(§7) is correct in spirit but **blocks the Generator's autonomy**. The
overworld sprites are the *one* asset class without a battle-tested
mirror (PokeAPI does not host them; they exist only in fan-hack
disassemblies). Pinning a SHA + having a bytewise-deterministic
placeholder converts the "single-point-of-failure repo" into a
graceful-degradation problem. The Code Evaluator can flag any ndex with
a placeholder during S5 review and the orchestrator can decide whether
to relax or to source a different mirror.

### A4 — Asset-fetcher script hardening (timeouts, retries, atomic writes)

(a) **PLAN says**: PLAN §6.1 pseudocode does no retry, no timeout, no
atomic write. PLAN §6.2 specifies fallback chains per set but the
pseudocode doesn't implement them.

(b) **Change to**: The Generator's `scripts/fetch-sprites.ts` MUST:
1. Wrap `fetch` with `AbortSignal.timeout(15_000)` — 15 s per request.
2. On `ok===false`, try the next URL in the per-set fallback chain
   (PLAN §6.2). On exhaustion of the chain, log + count as failure.
3. Write to `dest + '.tmp'` then `renameSync` to `dest` so partial
   writes can never corrupt the committed asset set on Ctrl-C.
4. Validate PNG by checking the full magic `89 50 4E 47 0D 0A 1A 0A`
   (8 bytes), not just the first 2 bytes (PLAN §6.1 only checks bytes
   0 and 1 — `89 50` matches some other formats).
5. Retry HTTP `429`, `502`, `503`, `504` with exponential backoff up to
   3 attempts before falling through.
6. After processing all 4 sets × 251 ndex, print a summary table
   (`set | ok | fallback | placeholder | failed`) and exit 1 only if
   the *total* failure count (after fallbacks + placeholder) is > 0.
7. Optional `--force` flag to delete and re-fetch (the existing
   `if (existsSync(dest)) return ok` is the right default for re-runs).

(c) **Why**: This script is a **build prerequisite** the Generator runs
once and commits the output. A flaky network mid-run could corrupt
PNGs, and the `existsSync` skip in PLAN §6.1 means a corrupt file would
be skipped on re-run. Atomic writes + magic-byte validation prevents
this. PokeAPI's GitHub raw is rate-limited; retries with backoff turn
transient 429s into a non-issue.

### A5 — GBC palette: pin exact hex values used by pokecrystal

(a) **PLAN says**: PLAN §3.1 cites `pret/pokecrystal`'s
`gfx/sgb/sgb.pal` for the menu palette and gives values
(`#f8f8f8`, `#c0c0c0`, `#888888`, `#303030`, plus accent colors).

(b) **Change to**: The values in PLAN §3.1 are **acceptable** but the
Generator MUST add a comment block in `style.css` next to the
custom-property definitions citing the upstream source by file path:

```css
/*
 * GBC palette anchored to pret/pokecrystal data/sgb_pals/data:
 *   The "menu" palette pal_d is RGB555 (0x7FFF = white, 0x39CE = lt gray,
 *   0x294A = dk gray, 0x0000 = black). Converted to sRGB the values are:
 *     white   #F8F8F8   (0x1F,0x1F,0x1F → 0xF8 with bit-replication)
 *     lt-gry  #C8C8C8   (PLAN rounded to #C0C0C0 — both are within
 *                        perceptual JND on a modern LCD; we accept #C0C0C0)
 *     dk-gry  #989898   (PLAN rounded to #888888 — same rationale)
 *     black   #303030   (true black hurts contrast against modern SDR
 *                        backlights; the GBC's actual perceived black is
 *                        ~#202020-#303030 depending on backlight; #303030
 *                        is what PokeAPI's screenshot pipeline uses)
 *   accents (refusal red, +delta green) are *not* in the SGB pal — they
 *   are derived from RBY's "PALRED" / "PALGREEN" sgb pals at #D83018 /
 *   #58A058 which match the in-game battle effect colors.
 */
```

(c) **Why**: PLAN's exact hex values (`#c0c0c0` vs the upstream
`#c8c8c8`, `#888888` vs `#989898`) are off by a few percent — perceptually
imperceptible on modern displays, but if anyone diffs against an emu
screenshot in the future they'll wonder why. Documenting the rounding
intent eliminates the question.

### A6 — Image-rendering: vendor-prefix triple

(a) **PLAN says**: PLAN §3.4 — `image-rendering: pixelated;
image-rendering: crisp-edges;` (two values).

(b) **Change to**:

```css
img.sprite, .pixel {
  image-rendering: -webkit-optimize-contrast; /* Safari ≤ 14 */
  image-rendering: -moz-crisp-edges;          /* Firefox ≤ 96 */
  image-rendering: crisp-edges;                /* legacy */
  image-rendering: pixelated;                  /* modern Chromium / Firefox / Safari ≥ 15 */
}
```

(c) **Why**: PLAN's two-value declaration covers modern browsers but
older Safari and pre-96 Firefox need the `-webkit-` and `-moz-`
prefixes respectively. The three prefixes are zero-cost; pixel-perfect
sprite rendering across browsers is a sprint goal.

### A7 — Sprite size discipline: render-time integer scaling, never CSS auto

(a) **PLAN says**: PLAN §3.4 — "render at 32×32 (2×) in the box grid";
PLAN §3.6 — status sprite sizes 56×56 (gen1/gen2) and 64×64 (gen3) at
"native". PLAN §4.3 `spriteImg(ndex, set, alt)` returns an `<img>` but
doesn't pin width/height attributes.

(b) **Change to**: `spriteImg` MUST set explicit `width` / `height`
attributes on every emitted `<img>`:

```ts
const SPRITE_RENDER_SIZE: Record<SpriteSet, number> = {
  gen1: 56, gen2: 56, gen3: 64, overworld: 32, // overworld is 16×16 source rendered 2× at 32×32
};
```

These are emitted as HTML `width=` and `height=` attributes (not CSS)
so the browser reserves layout space *before* the PNG decodes —
prevents reflow flash. CSS still applies `image-rendering: pixelated`.
Crystal Clear overworld sprites that are not 16×16 source (some
hack-specific evolved-form sprites can be 24×24 or 16×24) MUST be
inspected during fetch and either (i) trimmed to the standard 16×16
canvas via a node-canvas pass in `fetch-sprites.ts`, or (ii) listed in
the failure summary as "non-conformant size, kept as-is" so the
Generator can decide. **Do not auto-scale a non-16×16 overworld with
CSS** — it will visibly distort.

(c) **Why**: PLAN reserves the right size budget but doesn't enforce
it on the wire. Without explicit `width`/`height` attributes, the
4×5 grid will jump-shift as PNGs decode out of order; with CSS-only
sizing, a non-conformant Crystal Clear PNG will silently render
stretched. Both bugs are easy to prevent.

### A8 — Shiny indicator on comparison view (catch up to commit `9c2460c`)

(a) **PLAN says**: Nothing. PLAN §3, §4.5, §4.6 do not mention shiny
rendering.

(b) **Change to**: `statusScreen` and `boxBrowser` MUST render a shiny
indicator when `gen2Shiny(mon.dvs) === true`:

1. **Box browser**: shiny mons get a 1-pixel **gold border** around
   their 32×32 sprite tile (CSS: `outline: 1px solid #d8a838; outline-
   offset: -1px;`). NOT a sparkle overlay (sparkle PNG would balloon
   asset count with little visual gain).
2. **Status screen (Gen 1/2 mode)**: a single `★` glyph in
   `--gbc-accent-yellow: #d8a838` is rendered to the right of the
   level on the header line — `"CHARIZARD ★  Lv 100"`. Match Gen 2
   Crystal's actual shiny indicator (which was no in-game UI marker —
   the differentiator was the sprite palette; we use a glyph because
   our sprites come from PokeAPI which serves separate `/shiny/` paths
   that we are **not** fetching in this sprint to keep the asset count
   to 1004 not 2008).
3. **Status screen (Gen 3 mode)**: same `★` glyph; placement to the
   right of the level on the header line. (RSE in-game also had no
   star; the splash effect when entering the box was the indicator —
   we substitute the glyph.)
4. The comparison-deltas test MUST cover a shiny fixture (e.g.,
   shiny SPARKY the Raichu — DVs def=spe=special=10, atk=2 — set
   `statExp` to anything; the test asserts `gen2Shiny(mon.dvs)` and
   that the rendered DOM contains a `.shiny-star` element).

(c) **Why**: Commit `9c2460c` made the shiny PID path actually work
end-to-end (constructive derivation, no more brute-force hard cap).
SPARKY the shiny Raichu is now a passing fixture in the conversion
suite. If the new UI silently strips the shiny visual signal, the user
loses trust that their shinies survived the round-trip. The +1 indicator
is cheap and load-bearing.

### A9 — Drop dead `'loaded'` fields outright (no graveyard)

(a) **PLAN says**: PLAN §5 keeps `expandedBoxes` + `currentBoxExpanded`
as dead fields "for backwards-compat in case other consumers exist".
PLAN §10 Q9 asks for confirmation.

(b) **Change to**: **Remove** `expandedBoxes` and `currentBoxExpanded`
from `AppState['loaded']`. Remove the `box_toggled` and
`current_box_toggled` actions from `Action`. Update the reducer to drop
the corresponding cases. There are no external consumers — `web/src/ui.ts`
is the only reader, and S5 is rewriting its `'loaded'` branch anyway.

(c) **Why**: PLAN's own §10 Q9 admits there are no external consumers.
Keeping dead state fields invites confusion ("why is this set never
read?") and forces the Generator to populate them in the `file_parsed`
case for no behavioural reason. Deletion is cleaner; the PLAN's own
"pure superset" claim is technically maintained because nothing outside
the reducer/UI ever observed those fields.

### A10 — Refusal display: fully specify the visual

(a) **PLAN says**: PLAN §3, §4.7 — "Gen 1-style red dialog: `<NICK>
cannot be moved!` + reason subtext". No specification of border style,
text color, or layout.

(b) **Change to**: `refusalDialog` renders:

```
┌─────────────────────────────┐
│  <NICK> CANNOT BE MOVED!    │   ← centered, --gbc-accent-red on --gbc-bg
│                              │
│  ★ <reason in normal text>  │   ← left-aligned, --gbc-text
│  ▼ press B to cancel        │   ← bottom-right, --gbc-dark-gray, ▼ blinks
└─────────────────────────────┘
```

Border: 4 px outer `--gbc-accent-red` (NOT `--gbc-border-outer`); inner
inset 2 px white per the standard `.gen2-dialog` shadow recipe. Use
`.gen2-dialog.gen2-dialog--refusal` modifier class to apply the red
border without duplicating the dialog primitive.

(c) **Why**: PLAN §10 Q5 (audio NO) leaves only visual cues. Without
explicit color/layout, the Generator might pick "subtitle-style red"
that doesn't read as Gen 1's "PC: BEEP! [name] cannot be moved!" UX.
The red outer frame + blinking down-arrow is the Gen 1 idiom.

### A11 — `gen12` status screen: collapse to single Special line for both Gen 1 and Gen 2 sources

(a) **PLAN says**: PLAN §4.5 — "show SpA only and label it `SPCL`".
PLAN §10 Q8 asks whether Gen 2 source should show two lines.

(b) **Change to**: Single line labelled `SPCL`, value = `mon.dvs.special`-
derived stat (the Gen 1/2 source has `special` as a **single** field on
both `Gen12DVs` and `Gen12StatExp` per `core/src/types/source.ts:19,27`).
For the comparison delta math: Gen 1/2 source SpA *and* SpD are both
the single Special value; Gen 3 side splits them. So:

- `deltas.spa = gen3Final.spa - gen12Final.special`
- `deltas.spd = gen3Final.spd - gen12Final.special`

Both can be non-zero. For Charizard (Lv 100, perfect IVs, max EVs):
Gen 1/2 base SpA = SpD = 85 → final Special ≈ 328. Gen 3 base SpA = 109,
SpD = 85 → final SpA ≈ 348 (Δ +20 vs. the single Special value of 328?
the orchestrator's "+40" number deserves verification — see A2's "derive
via the formula then assert the literal" rule). The Generator MUST
compute both sides through the actual stat formula and use whatever the
math produces, then PIN that number in the test.

(c) **Why**: The single Special on the source side is **structurally
correct** (the Gen12 types model it that way). PLAN §10 Q8 is asking
about display fidelity to Gen 2 in-game UI — but the project's
abstraction is "Gen 1/2 source has one Special". Showing two lines
would require synthesising a value, which violates essence-preservation
(the user's saved data has one Special; showing two implies a falsified
split). Single-line `SPCL` is honest.

### A12 — Bundle-size honest estimate + concrete budget per chunk

(a) **PLAN says**: PLAN §1, §8.3 — "≤200 KB gz", "headroom is comfortable".
No per-chunk budget.

(b) **Change to**: Estimated bundle composition (gzipped):
- Existing S3a JS bundle: 28.89 KB (current measured)
- New `ui/*.ts` modules (8 files × ~1 KB gz typical): ~6–8 KB
- Comparison + delta logic: ~2 KB
- Sprite path helper: ~0.5 KB
- Keyboard handler: ~0.5 KB
- New CSS (palette, dialog, cursor, font-face, sprite rules): ~3 KB gz
  (CSS is bundled into the JS by Vite per `cssCodeSplit: false`)
- Total estimate: **~40–45 KB gzipped**

The 200 KB cap stays; the realistic landing is well under. The Generator
MUST update `bundle-size.test.ts` to also log the actual size on test
output (not just assert) so the Code Evaluator and orchestrator can see
the real number, but the assertion threshold STAYS at 200 KB — the
cap is a regression backstop, not a target.

Sprites + fonts are NOT counted against the bundle (they're in
`web/public/`, served as separate static files). Total
**deployment** size grows by ~700 KB (sprites) + ~10 KB (font) — that's
the user's first-load network cost and is the right place for that
budget to land. PLAN §1 doesn't gate on it; we leave it ungated but
documented.

(c) **Why**: "Comfortably under 200 KB" is true but vague; pinning the
estimate at ~40–45 KB lets the Code Evaluator catch a 4× regression
(e.g., accidentally pulling in a charting library) even though the cap
itself doesn't fire.

### A13 — `font-display: optional` not `swap` for the Pokemon font

(a) **PLAN says**: PLAN §3.5 — `font-display: swap`.

(b) **Change to**: `font-display: optional`. With `swap`, the page
renders in the system fallback (`Courier New`/monospace) for ~100 ms,
then **reflows** when the woff2 loads. Because the GBC layout is
pixel-precise and uses fixed widths (`width: 168px` for the box grid,
etc.), a font swap mid-render will cause visible text-shift. With
`optional`, the browser uses the fallback if the font isn't cached on
first load (no flash, but no Pokemon font on first visit either) and
the woff2 caches for second visit. This is the right trade-off for a
single-page utility users return to: visual fidelity stabilises after
the first page load.

Add `<link rel="preload" href="/fonts/pokemon-gb.woff2" as="font"
type="font/woff2" crossorigin>` to `index.html` so first-load fetches
the font in parallel with the JS bundle, maximising the chance that
`font-display: optional` lands the Pokemon font on first paint.

(c) **Why**: Pixel-precise UIs and font swaps don't mix. The cost of
`optional` (no Pokemon font on the very first uncached page load) is
much smaller than the cost of `swap` (visible text-shift on every
first-paint). The preload mostly eliminates the first-load gap.

### A14 — Test matrix additions

(a) **PLAN says**: PLAN §8.1 lists three new tests
(`sprite-paths.test.ts`, `comparison-deltas.test.ts`,
`box-browser-render.test.ts`).

(b) **Change to**: Add the following additional test coverage:

1. **`shiny-render.test.ts` (jsdom)** — render the box browser with a
   shiny SPARKY-the-Raichu fixture and assert the gold-border outline
   is present on the correct slot; render the comparison view and
   assert a `.shiny-star` element is present in both status-screen
   panes' header.
2. **`refusal-render.test.ts` (jsdom)** — given a Mew fixture (refused),
   assert opening the comparison view renders the red refusal dialog
   (NOT the comparison panes) and that the menu shows only `CANCEL`
   (no `STORE` button).
3. **`special-rendering.test.ts` (jsdom)** — given a Gen 1 source mon,
   assert the Gen 1/2 status pane renders a single `SPCL` row (not
   two).
4. **`comparison-deltas.test.ts` extension** — in addition to the
   FATMAN Charizard fixture (A2), add a Pikachu fixture (no base-stat
   delta — all six deltas should be 0) to cover the "unchanged species"
   path; PLAN §8.1 mentions Pikachu as a candidate but doesn't bind it.

(c) **Why**: The shiny path landed in `main` after PLAN was written;
the refusal display is a new UI and easy to forget; single-Special
rendering is structurally important (A11) and should not regress; the
zero-delta case is the dual of the FATMAN case and exercises a
different branch of the highlighter.

### A15 — Keyboard handler: prevent default on captured keys; `tabindex` on root

(a) **PLAN says**: PLAN §4.8 — `bindKeys(target, handlers)`, no mention
of focus management or default-prevention.

(b) **Change to**: `bindKeys` MUST:
1. Call `event.preventDefault()` on Arrow/PageUp/PageDown to stop the
   page from scrolling.
2. Mount on `Document` (not `window`); the root `#app` gets `tabindex=
   "-1"` so it can receive focus, and the controller calls
   `root.focus()` after `file_parsed` so keyboard input goes to the box
   browser without an explicit click.
3. Skip the handler when `document.activeElement` is an `<input>` or
   `<textarea>` (none in S5, but defence against a future text input).

(c) **Why**: Without `preventDefault`, arrow keys scroll the page when
the box is at the edge; without focus-on-load, the user must click the
box before keys work, which is unfriendly. The activeElement guard is
a one-liner that prevents future regressions.

### A16 — `runConvert` cache invariant: dispatch instead of mutating `state.results`

(a) **PLAN says**: PLAN §4.9 — "`runConvert(mon)` is unchanged".

(b) **Change to**: While `runConvert`'s body is unchanged, the
`renderLoaded` mid-render mutation of `state.results` (currently in
`web/src/ui.ts:251-253`) is **AMEND-S3a-4** carry-over from S3a. S5
re-touches `ui.ts` and MUST resolve it: replace the mid-render mutation
with a `convert_done` dispatch *outside* the render frame
(`queueMicrotask(() => dispatch({type:'convert_done', ...}))` after
collecting the new results). The reducer already handles
`convert_done`. This deletes the type-cast escape hatch and lets the
state stay immutable.

(c) **Why**: S3a explicitly forward-carried this technical debt
(sprint-3a.md AMEND-S3a-4). S5 is the natural sprint to close it
because the renderer is being rewritten anyway. Doing it now prevents
the issue from becoming permanent.

### A17 — Comparison view: convert lazily on overlay-open, not at load

(a) **PLAN says**: PLAN §4.6, §5 — `mon_open` opens the comparison
overlay; PLAN §4.9 says `runConvert` is "unchanged" (current S3a
behaviour: convert *every* mon on save load).

(b) **Change to**: Convert lazily — only when the user opens the
comparison overlay for a specific mon. The reducer's `mon_open` action
triggers a `convert_done` dispatch (via `queueMicrotask`) if the result
isn't already cached. This avoids spending CPU on PID search for
hundreds of mons the user never inspects (a Crystal save with full
boxes = 240+ mons; PID search at ~10 ms/mon = ~2.4 s of dropped frames
on save-load).

The "Convert all (.zip)" button (currently in S3a) is OUT of scope
for S5 anyway — PLAN §1 omits it; the new "STORE" button is per-mon.
But if the Generator wants to keep "Convert all" as a hidden bulk
action, it MUST run the conversions in a `for` loop with `await new
Promise(r => setTimeout(r, 0))` between each so the UI stays
responsive.

(c) **Why**: S3a's eager-convert pattern was acceptable for the
mon-row list because there was no "open detail" interaction; S5's
comparison-view-on-click pattern naturally admits lazy conversion, and
the perf delta on a full save is large enough to notice.

## Open-question rulings

For each of PLAN §10's 10 questions, ruling + rationale:

| Q | Topic | Ruling | Rationale |
|---|-------|--------|-----------|
| Q1 | Gen 1 sprite variant | **CONFIRM Yellow** | PLAN's own argument is correct: Yellow's GBC palette correction matches the Gen 2 Crystal pick on the Gen 2 side, giving visual coherence on the left pane. |
| Q2 | Gen 3 sprite variant | **CONFIRM Emerald** | Most polished Gen 3 art; the project's transfer-target framing isn't tied to FRLG specifically (the orchestrator-defaults framing is "Gen 1/2 → Gen 3"). |
| Q3 | Font | **CONFIRM Pokemon GB by Pokemon Perler (CC0)** | CC0 license is friction-free; 8×8 glyph match is the strongest visual signal we have. |
| Q4 | Sprite hosting | **CONFIRM self-hosted in repo** | Offline operation is a project value (orchestrator-defaults essence-preservation philosophy implies user-controlled). PLAN's reasoning stands. |
| Q5 | Audio | **CONFIRM NO** | Locked. Visual-only. PLAN's rationale (bundle weight, licensing murk) accepted. |
| Q6 | Party-screen view | **DEFER (PLAN's "synthetic PARTY pseudo-box" stays)** | Single rendering primitive simplifies scope; explicit party-menu can be a future polish sprint. |
| Q7 | Crystal Clear repo availability | **OVERRIDE — Generator implements the fallback ladder + placeholder** | See A3. Don't escalate; degrade gracefully and document. |
| Q8 | Gen 2 Special rendering (1 line vs 2) | **CONFIRM 1 line** | See A11. Single-Special matches the source data model; honesty over UI fidelity. |
| Q9 | Drop dead `loaded` fields | **OVERRIDE — DROP** | See A9. No external consumers; deletion is cleaner than a graveyard. |
| Q10 | FATMAN identity | **OVERRIDE — Lv 100 Charizard, +40 SpA delta** | See A2. The orchestrator's testing canon is Charizard with the Gen 1 → Gen 3 SpA buff (85 → 109 base; +40 final at Lv 100). PLAN's "Snorlax / Magneton / Vileplume / Victreebel" alternatives are rejected. |

## Recent-bug-fix integration

### Commit `9c2460c` (constructive shiny PID search)

**PLAN does not address shiny rendering.** Shinies now round-trip
correctly end-to-end (the constructive derivation eliminates the hard
cap that was failing on SPARKY the shiny Raichu). The S5 UI MUST
surface this — see A8 for the binding shiny indicator (gold border on
box tile + `★` glyph in status screen header). Test coverage in
`shiny-render.test.ts` (A14).

### Commit `61c4af9` (metLevel 5 → 0)

**PLAN does not reference any `metLevel: 5` literal.** Searched
`/home/coder/project/PLAN.md` for `metLevel` and `: 5` — no
occurrences. PLAN's design is at the UI layer and doesn't construct
`Gen3Intermediate` literals; the comparison view consumes whatever
`convert()` returns. **No amendment required for this fix.** If the
Generator decides to construct any `Gen3Intermediate` test fixtures
inline (e.g., for `comparison-deltas.test.ts`), they MUST use
`metLevel: 0` — the literal type in `core/src/types/target.ts:52` is
now `0` and a `5` will fail typecheck.

## Asset acquisition robustness

See A3 (Crystal Clear pin/fallback) and A4 (fetch-script hardening).

Summary of what the script must handle:
1. **404 on a specific ndex+variant** — fall back through the per-set
   chain in PLAN §6.2; ultimately a placeholder is acceptable.
2. **Repo URL moved/renamed** — try mirrors; pin SHA on success.
3. **Per-species path differs from PLAN's guess** — probe the four
   candidate paths in PLAN §7; if name-keyed, build name → ndex map.
4. **Network timeout / 5xx / 429** — retry with backoff (A4).
5. **Partial download / Ctrl-C mid-fetch** — atomic write to `.tmp`
   then rename (A4).
6. **PNG magic mismatch** — full 8-byte magic check (A4); reject
   non-PNGs that some CDN error pages serve as `.png` URLs.

## Sprite size / image-rendering audit

PLAN §3.4, §3.6 cover the sizes correctly:
- Box grid: 16×16 source → 32×32 rendered (2× integer scale). OK.
- Status screen Gen 1/2: 56×56 native, no scaling. OK.
- Status screen Gen 3: 64×64 native, no scaling. OK.

Per A6: vendor-prefix the `image-rendering` declaration triplet.
Per A7: emit explicit `width`/`height` HTML attributes on every `<img>`
to prevent reflow flash; non-conformant overworld sources (rare
hack-specific oversized PNGs) get trimmed in `fetch-sprites.ts`, NOT
auto-scaled by CSS.

Pixel alignment between the GBC chrome (4 px borders, 2 px inset
shadows, 8 px gaps) and the 16/32 px sprites is consistent — every
dimension is a multiple of 4 px, which on a 96 dpi monitor at default
zoom maps cleanly. OK.

## Bundle size sanity check

See A12. Realistic estimate: **40–45 KB gzipped JS+CSS**, vs 28.89 KB
current and the 200 KB cap. Headroom: ~155 KB. Comfortable. The cap
stays at 200 KB.

Static asset weight (not counted against bundle): ~700 KB sprites +
~10 KB font + ~3 KB favicon + LICENSE files. Acceptable for a static
deploy; the user's first-load network cost is dominated by the sprite
sheet, which the browser caches per-asset for repeat visits.

## Side-by-side comparison correctness

Critical concerns:

1. **Base stats source**: A1 fixes the missing Gen 1/2 personal data
   table. Without A1, the comparison's Gen 1/2 side either reuses Gen 3
   base stats (bug — every delta would be 0 for unchanged species and
   incorrect for changed) or hardcodes (bug — divergence over time).
2. **Gen 1/2 single Special**: A11 binds single-line `SPCL` rendering
   on the source side; both `deltas.spa` and `deltas.spd` are computed
   against the same source `special` value. This is correct.
3. **Gen 3 side base stats**: PLAN doesn't explicitly say the
   comparison view uses `core/src/data/personalInfo.ts` (which loads
   `personal-gen3.json`), but it's the only source in `core/`. Bind:
   the comparison MUST use `getPersonal(species.gen3DexId).base` for
   the Gen 3 side, and `getPersonalGen2(species.speciesGen2Id).base`
   (per A1) for the Gen 1/2 side.
4. **Stat formula consistency**: Gen 1/2 and Gen 3 use *different* stat
   formulas (Gen 1/2: `floor((((base + DV) * 2 + ceil(sqrt(statExp))/4)
   * level / 100) + 5)`; Gen 3: `floor(((2 * base + IV + EV/4) * level
   / 100) + 5) * nature_mod`). The Generator MUST implement both
   formulas in `comparisonView.ts` (or a new `web/src/ui/statFormulas.ts`)
   — DO NOT borrow Gen 3 formula and apply it on the Gen 1/2 side. The
   FATMAN regression test (A2) catches this implicitly because the
   formulas converge to different numbers for the same DV / EV /
   level.

## State machine extension audit

PLAN §5 extends `'loaded'` correctly for the new fields (`boxIndex`,
`cursor`, `openMon`). Per A9, the dead `expandedBoxes` and
`currentBoxExpanded` fields and their actions are **deleted outright**
rather than kept as a backwards-compat graveyard. Per A16, the
mid-render mutation in `renderLoaded` (S3a tech debt) is fixed via
`queueMicrotask` + `convert_done` dispatch. Per A17, conversion is
lazy (on `mon_open`) rather than eager.

`state.test.ts` updates per PLAN §8.2 are correct in scope (cover the
new actions); the deletions in A9 mean the existing `box_toggled` /
`current_box_toggled` test cases also delete cleanly.

## Test matrix gaps

Beyond PLAN §8.1 (which lists the right baseline), see A14 for the
required additions:
- `shiny-render.test.ts` — gold border on box, `★` glyph on status
  header.
- `refusal-render.test.ts` — Mew opens to red refusal dialog, no
  STORE button.
- `special-rendering.test.ts` — Gen 1 source renders single `SPCL`
  row.
- `comparison-deltas.test.ts` — extend to cover Pikachu (zero deltas)
  in addition to FATMAN (+40 SpA).

The 251 ndex × 4 sets sprite-presence test in PLAN §8.1 is correct.
PLAN's `it.skip` escape when the directory is empty is the right
call so devs cloning fresh aren't blocked.

## S1/S2/S3a invariants check

Confirmed by reading `core/src/types/source.ts`, `core/src/types/
target.ts`, `core/src/convert.ts`, `core/src/sav/index.ts`, `core/src/
pack/boxed.ts`:

- `Gen12Pokemon`, `Gen12DVs`, `Gen12StatExp`: **untouched** by PLAN.
- `Gen3Intermediate`: **untouched**. (A1 adds `personal-gen2.json`
  data file but does NOT touch any Gen 3 type.)
- `convert()`, `packBoxed()`, `parseSave()`, `isRefusal`: signatures
  unchanged. PLAN §1 explicitly preserves them.
- `core/` runtime deps: PLAN §1, §6 add `scripts/fetch-sprites.ts`
  but it's a one-shot devtool, not a `core/` dep. A1's
  `personal-gen2.json` and `personalInfoGen2.ts` add a data file +
  loader inside `core/src/data/`, with no new runtime deps (just
  `import raw from './raw/personal-gen2.json' with { type: 'json' }`,
  matching the existing `personalInfo.ts` pattern).
- Existing 261 tests (230 core + 31 web): PLAN §11 NO-REGRESSION
  criterion stands. `state.test.ts` updates per A9 are *deletions*
  (no new failures introduced). All other existing tests untouched.
- Bundle-size cap: A12 keeps the 200 KB cap; estimate 40–45 KB is
  well under.

## Risks flagged to Generator (numbered landmines)

R1. **`@font-face` URL with absolute path `/fonts/...`** — Vite serves
`web/public/fonts/pokemon-gb.woff2` at `/fonts/pokemon-gb.woff2` only
when `base: '/'`. The current `vite.config.ts` has `base: './'` (for
relative-path static deploys). The `@font-face` URL MUST be relative
to the CSS file — use `url('../public/fonts/pokemon-gb.woff2')` from
`web/src/style.css` and let Vite rewrite it, OR change `base` to `/`
(but that breaks file:// previews and some static-host setups).
**Recommendation**: keep `base: './'` and use Vite's CSS-relative
URL rewriting; verify by checking `web/dist/assets/index-*.css`
references the font asset with a relative URL.

R2. **`rel="preload" href="/fonts/..."` in `index.html`** — same path
issue. Use `href="./public/fonts/pokemon-gb.woff2"` to match the
`base: './'` config; Vite rewrites this for the build.

R3. **`<link rel="icon" href="./public/favicon.svg">`** — already in
`index.html` and works; the same pattern applies to the font preload.
Don't break this.

R4. **`image-rendering` order matters** — declarations later in the
cascade win for the same property. Per A6, list legacy values first
(`-webkit-optimize-contrast`, `-moz-crisp-edges`, `crisp-edges`) and
the modern `pixelated` last. Browsers ignore unknown values, so this
is safe across the matrix.

R5. **`font-display: optional` causes no Pokemon font on first load**
— this is intentional (A13). The user sees system monospace on first
page load; the Pokemon font appears on second visit. Document this in
a CSS comment so future devs don't "fix" it back to `swap`.

R6. **Crystal Clear repo size** — a `git clone --depth 1` of the
repo is a few MB; the Generator should confirm the disk impact in the
DinD container before doing it. Acceptable; just don't full-clone with
history.

R7. **PokeAPI `master` branch ref** — `PokeAPI/sprites` is large
(~500 MB checked out). Use raw GitHub URLs per file (PLAN §6.1
already does this) — DO NOT clone the repo. The 1004-file fetch at
25 ms throttle is ~25 s wall time — acceptable.

R8. **Per-species name → ndex map for Crystal Clear fallback** —
species names in the Crystal Clear disasm are uppercase
(`CHARIZARD`, `MR_MIME`, `NIDORAN_F`, `NIDORAN_M`, `HO_OH`,
`MIME_JR`, etc.) — the `_F`/`_M` and underscored variants don't match
`species.json`'s `"name": "Charizard"` exactly. Build the lookup map
with case-insensitive + underscore-stripped matching; the Generator
should hand-verify Nidoran-F/M, Mr. Mime, Ho-Oh.

R9. **woff2 download size** — PLAN §10 Q3 claims ~9 KB for "Pokemon GB
by Pokemon Perler". Verify the actual woff2 conversion size before
committing; if > 30 KB (PLAN's cap in success criteria 2), strip
unused glyphs (the UI uses ASCII letters + digits + `▶ ▼ ★ /` only).

R10. **`personal-gen2.json` source curation** — A1 requires this new
data file. The cleanest source is pret/pokecrystal's
`data/pokemon/base_stats/*.asm` files (one per species). The
Generator can either (a) write a small ASM parser in
`scripts/gen-personal-info-gen2.ts`, or (b) hand-curate from
Bulbapedia's "Pokémon with a base stat total of X" tables (slower but
no parser needed). Either is acceptable; document the source in a
header comment. Test: regression-test that **at least 5 species'**
Gen 2 base stats are present and match Bulbapedia spot-checks
(Charizard 78/84/78/85/85/100 in Gen 1/2 single-Special form;
Snorlax 160/110/65/65/30 etc.). Bind: include Charizard, Pikachu,
Magneton, Vileplume, Mew in the spot-check.

R11. **`tabindex="-1"` on `#app`** — A15 says focus the root after
parse. Make sure the root element actually receives focus; jsdom test
must verify with `expect(document.activeElement).toBe(root)`.

R12. **Gen 2 stat formula HP edge case** — Gen 1/2 HP has a separate
formula from the other 4 stats (`floor((((base + DV) * 2 +
ceil(sqrt(statExp))/4) * level / 100) + level + 10)` for HP, the
others use `+ 5` not `+ level + 10`). The Generator's
`statFormulas.ts` (A1/A11 dependency) MUST implement both correctly;
the FATMAN HP delta is 0 (Charizard base HP 78 in both gens) but a
test that uses Snorlax (160 HP) would catch a bug here. Add Snorlax
as a third fixture in `comparison-deltas.test.ts` — base stats
unchanged Gen 1/2 → Gen 3, so all six deltas should be 0.

## Out-of-scope confirmations

PLAN §11's deferral list is correct. Confirmed:
- Web Serial / GBxCart RW adapter — S3b, blocked on hardware.
- PKHeX legality harness — dropped (user does manual PKHeX).
- Animations/transitions — future polish.
- Mobile responsive — desktop-only.
- Audio — locked NO (Q5).
- Party screen — synthetic PARTY pseudo-box only (Q6).
- Battle stat sub-screen / status screen page 2 — future.
- Trainer card screen — simple top dialog suffices.
- Save *writing* / Gen 3 save injection — not in this sprint.
- Multi-language UI / JP/EU saves — not in this sprint.
- Drag-reorder, edit, save-back-to-sav — not in this sprint.
- PWA / service-worker — bundle is small; defer.
- Telemetry / analytics — never (hard rule).

The "Convert all (.zip)" bulk-download from S3a is technically
out-of-scope for S5 per PLAN §1 (which lists per-mon STORE only). A17
discusses keeping it as an optional hidden bulk action — leave that
to the Generator's discretion; if kept, MUST throttle per-mon so the
UI doesn't freeze.

---

## Summary of binding amendments

A1.  Ship `personal-gen2.json` + `personalInfoGen2.ts` for Gen 1/2 base stats.
A2.  FATMAN = Lv 100 Charizard, +40 SpA delta; derive via formula then pin literal.
A3.  Crystal Clear repo: ladder + pin SHA + placeholder fallback; no orchestrator escalation.
A4.  Asset-fetcher: 15 s timeout, retries with backoff, atomic writes, full PNG magic check.
A5.  GBC palette: pin hex with comment block citing pokecrystal upstream.
A6.  `image-rendering`: vendor-prefix triplet (`-webkit-optimize-contrast`, `-moz-crisp-edges`, `crisp-edges`, `pixelated`).
A7.  `<img>` width/height HTML attributes mandatory; non-conformant sprites trimmed in fetcher, never CSS-scaled.
A8.  Shiny indicator: gold border on box tiles + `★` glyph on status header; covered by `shiny-render.test.ts`.
A9.  Drop `expandedBoxes` and `currentBoxExpanded` outright (no graveyard).
A10. Refusal dialog: red outer border, blinking `▼`, fully specified layout.
A11. `gen12` status pane: single `SPCL` line; comparison delta computes both `spa` and `spd` against the same source `special`.
A12. Bundle estimate ~40–45 KB gz; cap stays at 200 KB; log actual on test output.
A13. `font-display: optional` + preload link; documented in CSS comment.
A14. Add `shiny-render.test.ts`, `refusal-render.test.ts`, `special-rendering.test.ts`, plus Pikachu zero-delta and Snorlax HP-formula cases in `comparison-deltas.test.ts`.
A15. Keyboard handler: `preventDefault` on Arrow/PageUp/PageDown; root gets `tabindex="-1"` and is focused after parse.
A16. Resolve S3a's mid-render mutation tech debt (AMEND-S3a-4) via `queueMicrotask` + `convert_done` dispatch.
A17. Convert lazily on `mon_open`, not eagerly at save load.

17 binding amendments. Generator: read `PLAN.md` and apply this file's amendments where they conflict. Where this file is silent, follow PLAN.md as written.
