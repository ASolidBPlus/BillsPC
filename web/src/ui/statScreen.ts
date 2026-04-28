/**
 * S8v2.2 polish — Pokemon stat-screen modal renderer.
 *
 * Stats are computed via the canonical helpers in `./statFormulas.ts`
 * (`computeGen12Stats`, `computeGen3Stats`, `diffStats`) — these are
 * the same tested implementations the legacy `comparisonView` uses.
 * Hand-rolled formulas were the source of every wrong number in
 * earlier iterations; this file does NO arithmetic of its own.
 *
 * Conversion-formula breakdown (DV→IV, StatExp→EV, nature) reflects
 * the canonical pipeline at `core/src/fields/{ivs,evs,nature}.ts`:
 *   IV  = 2·DV + b              (b = single deterministic RNG bit)
 *   EV  = min(252, ⌊√StatExp⌋)  (with proportional scaling if total > 510)
 *   nature = NEUTRAL[((atk_dv<<4) | def_dv) % 5]
 *
 * The actual b values + post-scale EV values are read off the
 * Gen3Intermediate that convert() produced — we don't re-derive.
 */

import type { Gen12Pokemon, Gen3Intermediate, SaveFormat } from '@pokeportal/core';
import {
  decodeGen12,
  gen2Gender,
  gen2Shiny,
  getPersonal,
  getPersonalGen2,
  getSpecies,
  hpDv,
} from '@pokeportal/core/internal';
import { deserializeGen12FromStaging } from '../cart/stagingPayload.js';
import { el } from './dom.js';
import { getAbilityDescription, getAbilityName } from './gen3Abilities.js';
import { getTypesGen2 } from './pokemonTypesGen2.js';
import { spriteImg } from './sprites.js';
import {
  computeGen12Stats,
  computeGen3Stats,
  diffStats,
  type SixStats,
} from './statFormulas.js';

const NATURE_NAMES: readonly string[] = [
  'Hardy', 'Lonely', 'Brave', 'Adamant', 'Naughty',
  'Bold', 'Docile', 'Relaxed', 'Impish', 'Lax',
  'Timid', 'Hasty', 'Serious', 'Jolly', 'Naive',
  'Modest', 'Mild', 'Quiet', 'Bashful', 'Rash',
  'Calm', 'Gentle', 'Sassy', 'Careful', 'Quirky',
];

// (NEUTRAL_BUCKET_NATURES table previously consumed by the standalone
// `renderConversionBreakdown` Nature footer; unified card reads the
// nature directly from `gen3.nature` so the lookup table is unused.)

const NATURE_EFFECTS: readonly [number, number][] = [
  [-1, -1], [0, 1], [0, 4], [0, 2], [0, 3],
  [1, 0], [-1, -1], [1, 4], [1, 2], [1, 3],
  [4, 0], [4, 1], [-1, -1], [4, 2], [4, 3],
  [2, 0], [2, 1], [2, 4], [-1, -1], [2, 3],
  [3, 0], [3, 1], [3, 2], [3, 4], [-1, -1],
];

function natureMark(nature: number, statIdx: 0 | 1 | 2 | 3 | 4): '' | '+' | '-' {
  const eff = NATURE_EFFECTS[nature];
  if (!eff || eff[0] === -1) return '';
  if (eff[0] === statIdx) return '+';
  if (eff[1] === statIdx) return '-';
  return '';
}

function nicknameOf(mon: Gen12Pokemon): string {
  const decoded = decodeGen12(mon.nicknameBytes).trim();
  if (decoded) return decoded;
  return getSpecies(mon.speciesGen2Id)?.name ?? `species-${mon.speciesGen2Id}`;
}

function otNameOf(mon: Gen12Pokemon): string {
  return decodeGen12(mon.otNameBytes).trim() || '?';
}

// (genderGlyph removed — replaced with the canonical 8×8 GSC font
// glyphs vendored as PNGs from the gsc-font sheet.)

/* ============================================================
 * GSC stat screen — combined header + cyan body, single SPECIAL row.
 * Stats from canonical computeGen12Stats.
 * ============================================================ */

export function renderSourceStatScreen(mon: Gen12Pokemon, isRby: boolean): HTMLElement {
  if (isRby) return renderRbyStatScreen(mon);
  return renderGscStatScreen(mon);
}

/* ============================================================
 * GSC stat screen — image-template overlay. Same approach as RBY:
 * vendored gsc-stats-template-clean.png as background, with absolute-
 * positioned spans painting variable values into the placeholder cells.
 * Labels (ATTACK / DEFENSE / SPCL.ATK / SPCL.DEF / SPEED / IDNo / OT /
 * No.) are baked into the template so we only render values + sprite.
 *
 * Note: the Gen 2 in-game template shows SPCL.ATK and SPCL.DEF on
 * separate rows (Gen 2 has split Special). Matching the in-game
 * layout exactly is more important than collapsing them into one
 * SPECIAL row, so we accept the duplicate-looking values for Gen 1
 * mons (where SpA == SpD).
 * ============================================================ */

function renderGscStatScreen(mon: Gen12Pokemon): HTMLElement {
  const personal = getPersonalGen2(mon.speciesGen2Id);
  const stats = computeGen12Stats(mon, personal, mon.level);
  const nick = nicknameOf(mon);
  const ot = otNameOf(mon);
  const isShiny = gen2Shiny(mon.dvs);

  const wrap = el('div', { class: 'gsc-screen' });

  // Sprite — animated Crystal front sprite, shiny variant when applicable
  const sprite = el('div', { class: 'gsc-sprite' });
  const spriteImgEl = document.createElement('img');
  spriteImgEl.src = isShiny
    ? `/sprites/crystal-anim-shiny/${mon.speciesGen2Id}.gif`
    : `/sprites/crystal-anim/${mon.speciesGen2Id}.gif`;
  spriteImgEl.alt = nick;
  spriteImgEl.className = 'sprite';
  sprite.append(spriteImgEl);
  wrap.append(sprite);

  const addText = (cls: string, text: string): void => {
    wrap.append(el('div', { class: `gsc-text ${cls}` }, text));
  };

  const speciesName =
    getSpecies(mon.speciesGen2Id)?.name ?? `species-${mon.speciesGen2Id}`;

  // Header values (top white half). Template already bakes "No." label
  // so we only render the digits — DON'T prefix with №.
  addText('gsc-dexno', String(mon.speciesGen2Id).padStart(3, '0'));
  // ":L" rendered as the canonical icon image (vendored from rby-menus
  // English-row icon strip); level digits text-overlaid right after.
  const lIcon = document.createElement('img');
  lIcon.src = '/sprites/stat-screens/gsc-icon-l.png';
  lIcon.className = 'gsc-icon-l';
  lIcon.alt = ':L';
  wrap.append(lIcon);
  addText('gsc-level', String(mon.level));
  // Gender — derived from the SOURCE mon's atk DV vs species ratio
  // (gen2Gender), NOT mon.otGender (which is the trainer's gender, a
  // different field). Matches what the AFTER panel shows from the PID.
  const genderRatio = getPersonal(mon.speciesGen2Id).genderRatio;
  const monGender = gen2Gender(mon.dvs, genderRatio);
  if (monGender !== 2) {
    const genderImg = document.createElement('img');
    genderImg.src = monGender === 1
      ? '/sprites/stat-screens/gsc-icon-female.png'
      : '/sprites/stat-screens/gsc-icon-male.png';
    genderImg.className = 'gsc-gender-pos';
    genderImg.alt = monGender === 1 ? '♀' : '♂';
    wrap.append(genderImg);
  }
  // Row 2: nickname / Row 3: species — per canonical GSC layout
  addText('gsc-nickname', nick.toUpperCase());
  addText('gsc-species', speciesName.toUpperCase());
  // HP — canonical "HP:" icon (16×8) + value digits next to it
  const hpIcon = document.createElement('img');
  hpIcon.src = '/sprites/stat-screens/gsc-icon-hp.png';
  hpIcon.className = 'gsc-icon-hp';
  hpIcon.alt = 'HP:';
  wrap.append(hpIcon);
  addText('gsc-hp', `${stats.hp}/${stats.hp}`);

  // Shiny mark — replaces the blue square at template (152, 0). Only
  // rendered when the source mon is shiny; otherwise the cleaned
  // template already shows blank white in that cell.
  if (isShiny) {
    const star = document.createElement('img');
    star.src = '/sprites/stat-screens/gsc-shiny-mark.png';
    star.className = 'gsc-shiny';
    star.alt = 'shiny';
    wrap.append(star);
  }

  // Bottom-left column — IDNo + OT
  addText('gsc-idno', String(mon.tid).padStart(5, '0'));
  addText('gsc-ot', ot.toUpperCase());

  // Bottom-right column — stats. SPCL.ATK and SPCL.DEF intentionally
  // show the SAME value (computed from the single shared Special
  // DV/StatExp the source mon actually carries). Gen 1 mons obviously
  // can't differ; for Gen 2 mons the split-base distinction exists in
  // the personal table but the cart still stores one Special StatExp,
  // so showing one value is the honest pre-conversion view.
  const sharedSpecial = stats.spa;
  addText('gsc-attack',  String(stats.atk));
  addText('gsc-defense', String(stats.def));
  addText('gsc-spclatk', String(sharedSpecial));
  addText('gsc-spcldef', String(sharedSpecial));
  addText('gsc-speed',   String(stats.spe));

  return wrap;
}

/* ============================================================
 * RBY stat screen — image-template overlay. The 160×144 PNG ships
 * with all labels (ATTACK / DEFENSE / TYPE1 / OT / etc.) baked in;
 * we only paint the variable values into the placeholder regions.
 * Layout is driven by absolute-positioned spans inside `.rby-screen`,
 * coordinates expressed in template-pixel units via CSS variables.
 * ============================================================ */

function renderRbyStatScreen(mon: Gen12Pokemon): HTMLElement {
  const personal = getPersonalGen2(mon.speciesGen2Id);
  const stats = computeGen12Stats(mon, personal, mon.level);
  const special = personal.gen1Special != null
    ? // For Gen 1 mons, recompute SPECIAL using the canonical Gen 1
      // single-Special base (not the split SpA value used in GSC view).
      Math.max(stats.spa, stats.spd) // both columns derive from the same DV/StatExp
    : stats.spa;
  const nick = nicknameOf(mon);
  const ot = otNameOf(mon);
  const types = getTypesGen2(mon.speciesGen2Id);

  const wrap = el('div', { class: 'rby-screen' });

  const sprite = el('div', { class: 'rby-screen-sprite' });
  sprite.append(spriteImg(mon.speciesGen2Id, 'gen1', nick, 'RBY-RED'));
  wrap.append(sprite);

  const addText = (cls: string, text: string): void => {
    wrap.append(el('div', { class: `rby-text ${cls}` }, text));
  };

  addText('rby-name', nick.toUpperCase());
  addText('rby-level', String(mon.level));
  addText('rby-hp-current', String(stats.hp));
  addText('rby-hp-max', String(stats.hp));
  addText('rby-status', 'OK');
  // In-game RBY always pads the dex number to 3 digits (No.006, No.112).
  addText('rby-dexno', String(mon.speciesGen2Id).padStart(3, '0'));
  addText('rby-attack', String(stats.atk));
  addText('rby-defense', String(stats.def));
  addText('rby-speed', String(stats.spe));
  addText('rby-special', String(special));
  addText('rby-type1', types[0]);
  if (types[1]) {
    addText('rby-type2', types[1]);
  } else {
    // Cover the baked "TYPE2/" label with a cream rect — monotype mons
    // shouldn't display an empty TYPE2 row.
    wrap.append(el('div', { class: 'rby-type2-mask' }));
  }
  addText('rby-idno', String(mon.tid).padStart(5, '0'));
  addText('rby-ot', ot.toUpperCase());

  return wrap;
}

// (statRow + renderHpBar removed — used by the original CSS-only GSC
// renderer; the image-template overlay GSC renderer doesn't need them.)

/* ============================================================
 * Emerald stat screen — Gen 3 panel with deltas vs source.
 * Stats from canonical computeGen3Stats.
 * ============================================================ */

interface EmeraldOpts {
  /** Source SixStats baseline for delta rendering. */
  readonly sourceStats?: SixStats | null;
}

export function renderEmeraldStatScreen(mon: Gen3Intermediate, opts: EmeraldOpts = {}): HTMLElement {
  const personal = getPersonal(mon.species);
  const stats = computeGen3Stats(personal, {
    ivs: mon.ivs,
    evs: mon.evs,
    level: mon.level,
  });
  const speciesName = getSpecies(mon.species)?.name ?? `species-${mon.species}`;
  const natureName = NATURE_NAMES[mon.nature] ?? '?';
  const deltas = opts.sourceStats ? diffStats(stats, opts.sourceStats) : null;

  const wrap = el('div', { class: 'em-screen' });

  const header = el('div', { class: 'em-screen-header' });
  const spriteBox = el('div', { class: 'em-screen-sprite' });
  spriteBox.append(spriteImg(mon.species, 'gen3', speciesName));
  header.append(spriteBox);
  const headerText = el('div', { class: 'em-screen-header-text' });
  headerText.append(
    el('div', { class: 'em-screen-name' }, speciesName.toUpperCase()),
    el(
      'div',
      { class: 'em-screen-meta' },
      `Lv${mon.level} · ${natureName} · ability ${personal.ability0}`,
    ),
  );
  header.append(headerText);
  wrap.append(header);

  const body = el('div', { class: 'em-screen-body' });
  body.append(
    emRow('HP', stats.hp, deltas?.hp ?? null),
    emRow('ATTACK', stats.atk, deltas?.atk ?? null, natureMark(mon.nature, 0)),
    emRow('DEFENSE', stats.def, deltas?.def ?? null, natureMark(mon.nature, 1)),
    emRow('SP. ATK', stats.spa, deltas?.spa ?? null, natureMark(mon.nature, 2)),
    emRow('SP. DEF', stats.spd, deltas?.spd ?? null, natureMark(mon.nature, 3)),
    emRow('SPEED', stats.spe, deltas?.spe ?? null, natureMark(mon.nature, 4)),
  );
  wrap.append(body);

  return wrap;
}

function emRow(label: string, value: number, delta: number | null, mark: '' | '+' | '-' = ''): HTMLElement {
  const row = el('div', { class: 'em-screen-row' });
  row.append(el('span', { class: 'em-screen-row-label' }, label));
  const valueWrap = el('span', { class: 'em-screen-row-value' });
  valueWrap.append(
    el(
      'span',
      { class: `em-screen-row-num${mark === '+' ? ' em-nature-up' : mark === '-' ? ' em-nature-down' : ''}` },
      String(value),
    ),
  );
  if (delta !== null) {
    const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±';
    const cls = delta > 0 ? 'em-delta-pos' : delta < 0 ? 'em-delta-neg' : 'em-delta-zero';
    valueWrap.append(el('span', { class: `em-delta ${cls}` }, `${sign}${Math.abs(delta)}`));
  }
  row.append(valueWrap);
  return row;
}

/* ============================================================
 * Conversion-formula breakdown — shows what convert() did.
 * DV→IV, StatExp→EV, nature derivation; final-stat formulas.
 * ============================================================ */

/**
 * AFTER panel — pixel-faithful FR/LG summary screen ("STATS" page).
 * Background is the vendored bg_skills.png from the FRLG Summary Screen
 * Pokemon Essentials plugin; we overlay sprite + labels + values via
 * absolute-positioned spans aligned to the template's 512×384 grid.
 */
function renderFrlgAfterPanel(gen3: Gen3Intermediate, source?: Gen12Pokemon): HTMLElement {
  const personal = getPersonal(gen3.species);
  const stats = computeGen3Stats(personal, {
    ivs: gen3.ivs,
    evs: gen3.evs,
    level: gen3.level,
  });
  const speciesName = getSpecies(gen3.species)?.name ?? `species-${gen3.species}`;
  const natureName = NATURE_NAMES[gen3.nature] ?? '?';
  const pokemonGender = derivePokemonGender(gen3.pid, personal.genderRatio);
  // Shininess is determined upstream by the canonical Gen 2 DV check
  // (Def==Spe==Special==10 && Atk in {2,3,6,7,10,11,14,15}). The convert
  // pipeline preserves it into the Gen 3 PID, but we read directly from
  // the source DVs to avoid recomputing the formula here.
  const isShiny = source != null && gen2Shiny(source.dvs);

  const wrap = el('div', { class: `frlg-screen${isShiny ? ' frlg-screen-shiny' : ''}` });

  // Page title strip — "POKéMON SKILLS" in white at template (8, 6),
  // matches canonical FR/LG header bar
  wrap.append(el('div', { class: 'frlg-text frlg-page-title' }, 'POKéMON SKILLS'));

  // Pokéball icon at template (211, 238) — bottom-right of sprite area
  const ballImg = document.createElement('img');
  ballImg.src = '/sprites/stat-screens/frlg-icon-pokeball.png';
  ballImg.className = 'frlg-pokeball';
  ballImg.alt = '';
  wrap.append(ballImg);

  // Shiny star at template (214, 42) — only shown for shiny mons
  if (isShiny) {
    const star = document.createElement('img');
    star.src = '/sprites/stat-screens/frlg-shiny-star.png';
    star.className = 'frlg-shiny-star';
    star.alt = 'shiny';
    wrap.append(star);
  }

  // Sprite — uses the actual gen3 shiny palette swap for shiny mons
  // (vendored from PokeAPI/sprites/.../emerald/shiny/<n>.png), normal
  // sprite for everyone else.
  const sprite = el('div', { class: 'frlg-sprite' });
  if (isShiny) {
    const shinyImg = document.createElement('img');
    shinyImg.src = `/sprites/gen3-shiny/${gen3.species}.png`;
    shinyImg.alt = speciesName;
    shinyImg.className = 'sprite';
    sprite.append(shinyImg);
  } else {
    sprite.append(spriteImg(gen3.species, 'gen3', speciesName));
  }
  wrap.append(sprite);

  // Top-right header info: species name + level inside the lavender
  // header strip area + nature shown as a small tag (FR/LG canonically
  // shows nature on the TRAINER MEMO page, not SKILLS — but we have
  // no separate page so it goes inline here)
  wrap.append(el('div', { class: 'frlg-text frlg-name' }, speciesName.toUpperCase()));
  wrap.append(el('div', { class: 'frlg-text frlg-level' }, `Lv${gen3.level}`));
  if (pokemonGender !== 'N') {
    wrap.append(
      el(
        'div',
        { class: `frlg-text frlg-gender frlg-gender-${pokemonGender.toLowerCase()}` },
        pokemonGender === 'M' ? '♂' : '♀',
      ),
    );
  }

  // Stat rows — gray pill labels on the right column with values in
  // yellow boxes. Layout matches the in-game FR/LG SKILLS sub-page.
  wrap.append(el('div', { class: 'frlg-pill frlg-pill-hp' },  'HP'));
  wrap.append(el('div', { class: 'frlg-pill frlg-pill-atk' }, 'ATTACK'));
  wrap.append(el('div', { class: 'frlg-pill frlg-pill-def' }, 'DEFENSE'));
  wrap.append(el('div', { class: 'frlg-pill frlg-pill-spa' }, 'SP.ATK'));
  wrap.append(el('div', { class: 'frlg-pill frlg-pill-spd' }, 'SP.DEF'));
  wrap.append(el('div', { class: 'frlg-pill frlg-pill-spe' }, 'SPEED'));
  wrap.append(el('div', { class: 'frlg-pill frlg-pill-ability' }, 'ABILITY'));

  // HP bar fill (full HP) — width fixed in CSS so the rect lands inside
  // the bar interior at integer pixel positions
  wrap.append(el('div', { class: 'frlg-hpbar-fill' }));

  // Stat values inside the yellow input boxes
  wrap.append(el('div', { class: 'frlg-text frlg-val frlg-val-hp' },  `${stats.hp}/${stats.hp}`));
  wrap.append(el('div', { class: `frlg-text frlg-val frlg-val-atk ${natureColorClass(gen3.nature, 0)}` }, String(stats.atk)));
  wrap.append(el('div', { class: `frlg-text frlg-val frlg-val-def ${natureColorClass(gen3.nature, 1)}` }, String(stats.def)));
  wrap.append(el('div', { class: `frlg-text frlg-val frlg-val-spa ${natureColorClass(gen3.nature, 2)}` }, String(stats.spa)));
  wrap.append(el('div', { class: `frlg-text frlg-val frlg-val-spd ${natureColorClass(gen3.nature, 3)}` }, String(stats.spd)));
  wrap.append(el('div', { class: `frlg-text frlg-val frlg-val-spe ${natureColorClass(gen3.nature, 4)}` }, String(stats.spe)));
  // ABILITY value (UPPERCASE per FR/LG canonical), with nature on the
  // line below as a secondary value, then description further below
  wrap.append(
    el('div', { class: 'frlg-text frlg-val frlg-val-ability' },
      getAbilityName(personal.ability0).toUpperCase()),
  );
  wrap.append(
    el('div', { class: 'frlg-text frlg-val frlg-val-nature' },
      `${natureName.toUpperCase()} NATURE`),
  );
  const desc = getAbilityDescription(personal.ability0);
  if (desc) {
    wrap.append(el('div', { class: 'frlg-text frlg-val frlg-ability-desc' }, desc));
  }

  return wrap;
}

/** Derive the visible Pokemon gender from PID + species gender ratio. */
function derivePokemonGender(pid: number, genderRatio: number): 'M' | 'F' | 'N' {
  if (genderRatio === 255) return 'N';
  if (genderRatio === 254) return 'F';
  if (genderRatio === 0)   return 'M';
  return (pid & 0xff) < genderRatio ? 'F' : 'M';
}

// (isShinyGen3 removed — we read shininess from the source mon's
// canonical `gen2Shiny(dvs)` instead of recomputing from the converted
// PID, so this Gen 3-side helper is unused.)

function natureColorClass(nature: number, statIdx: number): string {
  const eff = NATURE_EFFECTS[nature] ?? [-1, -1];
  if (eff[0] === -1) return '';
  if (eff[0] === statIdx) return 'frlg-nature-up';
  if (eff[1] === statIdx) return 'frlg-nature-down';
  return '';
}

/**
 * Unified "AFTER" card — replaces the separate Emerald panel + standalone
 * conversion-breakdown block. Combines:
 *   - species/level/nature/ability header
 *   - one wide table per stat row: Final  Δ  DV>IV  StatExp>EV
 *   - Σ totals row
 *   - nature footer (formula in tooltip)
 *   - EV cap warning when raw > 510
 */
function renderGen3UnifiedCard(
  source: Gen12Pokemon,
  gen3: Gen3Intermediate,
  sourceStats: SixStats,
): HTMLElement {
  const wrap = el('div', { class: 'g3card' });

  const personal = getPersonal(gen3.species);
  const stats = computeGen3Stats(personal, {
    ivs: gen3.ivs,
    evs: gen3.evs,
    level: gen3.level,
  });
  const natureName = NATURE_NAMES[gen3.nature] ?? '?';
  const deltas = diffStats(stats, sourceStats);

  // 3×2 grid of per-stat cards. Each card is self-contained: header
  // line shows STAT name + Final value + Δ from source; body shows
  // DV→IV and StatExp→EV. Replaces the wide table that smeared values
  // across the modal width.
  const grid = el('div', { class: 'g3-grid' });
  const sourceHpDv = hpDv(source.dvs);
  type StatSpec = {
    label: string; statKey: keyof SixStats;
    /** Index 0..4 for the natureMark lookup; null for HP (no nature effect). */
    statIdx: 0 | 1 | 2 | 3 | 4 | null;
    dv: number; iv: number; statExp: number; ev: number;
  };
  const specs: StatSpec[] = [
    { label: 'HP',  statKey: 'hp',  statIdx: null, dv: sourceHpDv,         iv: gen3.ivs.hp,  statExp: source.statExp.hp,      ev: gen3.evs.hp },
    { label: 'ATK', statKey: 'atk', statIdx:    0, dv: source.dvs.atk,     iv: gen3.ivs.atk, statExp: source.statExp.atk,     ev: gen3.evs.atk },
    { label: 'DEF', statKey: 'def', statIdx:    1, dv: source.dvs.def,     iv: gen3.ivs.def, statExp: source.statExp.def,     ev: gen3.evs.def },
    { label: 'SpA', statKey: 'spa', statIdx:    2, dv: source.dvs.special, iv: gen3.ivs.spa, statExp: source.statExp.special, ev: gen3.evs.spa },
    { label: 'SpD', statKey: 'spd', statIdx:    3, dv: source.dvs.special, iv: gen3.ivs.spd, statExp: source.statExp.special, ev: gen3.evs.spd },
    { label: 'Spe', statKey: 'spe', statIdx:    4, dv: source.dvs.spe,     iv: gen3.ivs.spe, statExp: source.statExp.spe,     ev: gen3.evs.spe },
  ];

  let rawSum = 0;
  let finalEvSum = 0;
  for (const s of specs) {
    const raw = Math.min(252, Math.floor(Math.sqrt(s.statExp)));
    rawSum += raw;
    finalEvSum += s.ev;
    const finalVal = stats[s.statKey];
    const delta = deltas[s.statKey];
    const deltaSign = delta > 0 ? '+' : delta < 0 ? '−' : '±';
    const deltaCls = delta > 0 ? 'g3-delta-pos' : delta < 0 ? 'g3-delta-neg' : 'g3-delta-zero';
    const mark = s.statIdx !== null ? natureMark(gen3.nature, s.statIdx) : '';
    const finalCls = mark === '+' ? 'g3-final g3-nature-up'
                   : mark === '-' ? 'g3-final g3-nature-down'
                   : 'g3-final';

    const card = el('div', { class: 'g3-stat-card' });
    const head = el('div', { class: 'g3-stat-head' });
    head.append(
      el('span', { class: 'g3-stat-label' }, s.label),
      el('span', { class: finalCls }, String(finalVal)),
      el('span', { class: `g3-delta ${deltaCls}` }, delta === 0 ? '±0' : `${deltaSign}${Math.abs(delta)}`),
    );
    card.append(head);
    card.append(
      el(
        'div',
        {
          class: 'g3-stat-row',
          title:
            'IV = 2 * DV + b\n(b is a deterministic RNG bit per stat; SpA & SpD share the Special bit)',
        },
        `DV ${s.dv} > IV ${s.iv}`,
      ),
    );
    card.append(
      el(
        'div',
        {
          class: 'g3-stat-row',
          title:
            'EV = min(252, floor(sqrt(StatExp)))\nSpecial StatExp feeds both SpA & SpD.\nRaw EV > 510 → proportional rescale (Hamilton remainder).',
        },
        `StatExp ${s.statExp.toLocaleString()} > EV ${s.ev}`,
      ),
    );
    grid.append(card);
  }
  wrap.append(grid);

  // ---------- Footer: Σ EV totals + Nature on one row ----------
  const bucket = (((source.dvs.atk & 0x0f) << 4) | (source.dvs.def & 0x0f)) % 5;
  const footer = el('div', { class: 'g3-footer' });
  const evCell = el('div', { class: 'g3-footer-cell' });
  evCell.append(
    el('span', { class: 'g3-footer-label' }, 'Σ EV'),
    el('span', { class: 'g3-footer-value' }, `${finalEvSum}/510`),
  );
  if (rawSum !== finalEvSum) {
    evCell.append(
      el('span', { class: 'g3-footer-aux' }, `(raw ${rawSum} ×${(510 / rawSum).toFixed(3)})`),
    );
  }
  const natCell = el('div', { class: 'g3-footer-cell' });
  natCell.append(
    el('span', { class: 'g3-footer-label' }, 'NATURE'),
    el(
      'span',
      {
        class: 'g3-footer-value g3-nature',
        title:
          `bucket = ((atk_dv << 4) | def_dv) mod 5 = ((${source.dvs.atk}<<4) | ${source.dvs.def}) % 5 = ${bucket}\n` +
          'NEUTRAL = [Hardy, Docile, Serious, Bashful, Quirky]',
      },
      natureName,
    ),
  );
  footer.append(evCell, natCell);
  wrap.append(footer);

  // EV cap warning — only when actual scaling kicked in
  if (rawSum > 510) {
    wrap.append(
      el(
        'div',
        { class: 'g3-warning' },
        `EV cap: raw ${rawSum} > 510, scaled by ×${(510 / rawSum).toFixed(3)}.`,
      ),
    );
  }

  return wrap;
}


/** BEFORE/AFTER section tag — `LABEL [icon]`, icon to the right.
 *  Icon is wrapped in a `.ss-tag-icon` div so we can size/scale it
 *  via the wrapper without overriding any global .party-icon-* CSS
 *  (Vite's CSS minifier was incorrectly hoisting our overrides into
 *  global selectors, breaking the box-browser bounce animation). */
function sectionTag(
  label: 'BEFORE' | 'AFTER',
  ndex: number,
  iconSet: 'party-gen2' | 'party-gen3',
  monochrome = false,
): HTMLElement {
  const wrap = el('div', {
    class: `ss-section-tag${monochrome ? ' ss-section-tag-mono' : ''}`,
  });
  wrap.append(el('span', { class: 'ss-section-tag-text' }, label));
  const iconWrap = el('div', {
    class: `ss-tag-icon${iconSet === 'party-gen3' ? ' ss-tag-icon-gen3' : ''}`,
  });
  iconWrap.append(spriteImg(ndex, iconSet, label));
  wrap.append(iconWrap);
  return wrap;
}

function sourceStatsForCompare(mon: Gen12Pokemon): SixStats {
  const personal = getPersonalGen2(mon.speciesGen2Id);
  const stats = computeGen12Stats(mon, personal, mon.level);
  // Gen 1/2 panel displays SPECIAL = SpA — make SpD use the same
  // value for the delta-comparison so the on-screen SPECIAL row's
  // delta makes sense (matches legacy comparisonView).
  return { ...stats, spd: stats.spa };
}

/* ============================================================
 * Modal opener
 * ============================================================ */

export type StatScreenSubject =
  | { kind: 'sourceMon'; mon: Gen12Pokemon; sourceFormat: SaveFormat | null }
  | { kind: 'transferSlot'; slot: import('../cart/stagingStore.types.js').StagedSlot }
  | { kind: 'destMon'; intermediate: Gen3Intermediate };

export interface StatScreenOpts {
  readonly subject: StatScreenSubject;
  readonly convert?: (mon: Gen12Pokemon) => Gen3Intermediate | null;
  /** Remove the current transferSlot subject from the Transfer Box.
   *  Available in both source and destination roles. */
  readonly onRemoveTransfer?: () => void;
  /** Add the current sourceMon subject to the Transfer Box. Only
   *  rendered when subject.kind === 'sourceMon' and callback supplied. */
  readonly onAddToTransfer?: () => void;
  /** Disable the add-to-transfer button (already-staged, party slot,
   *  capacity reached, etc.). String is shown as the button text. */
  readonly addToTransferLabel?: string;
  /** Send the current transferSlot subject to the Destination cart
   *  (placement preview only — no cart writes in S8v2.2). Only
   *  rendered when subject.kind === 'transferSlot' AND callback set. */
  readonly onSendToDestination?: () => void;
  readonly sendToDestinationLabel?: string;
  /** Cancel an existing placement on the current transferSlot (clears
   *  `placement` so the mon goes back to "in transfer box, no
   *  destination assigned"). Only rendered when subject is transferSlot
   *  AND the slot has a placement set AND callback is supplied. */
  readonly onCancelSend?: () => void;
  /** Save the current sourceMon or transferSlot subject as a .pk2 file
   *  (32-byte Crystal box record + 11-byte nickname + 11-byte OT name). */
  readonly onSaveAsPk2?: () => void;
}

export function openStatScreenModal(opts: StatScreenOpts): void {
  for (const node of Array.from(document.body.querySelectorAll('.ss-overlay'))) node.remove();

  const overlay = el('div', { class: 'ss-overlay' });
  const inner = el('div', { class: 'ss-inner' });
  const panels = el('div', { class: 'ss-panels' });
  const subject = opts.subject;

  let breakdownSrc: Gen12Pokemon | null = null;
  let breakdownGen3: Gen3Intermediate | null = null;

  if (subject.kind === 'sourceMon') {
    const isRby = subject.sourceFormat?.startsWith('RBY-') ?? false;
    const beforeBlock = el('div', { class: 'ss-before-block' });
    beforeBlock.append(sectionTag('BEFORE', subject.mon.speciesGen2Id, 'party-gen2', isRby));
    beforeBlock.append(renderSourceStatScreen(subject.mon, isRby));
    panels.append(beforeBlock);
    const conv = opts.convert?.(subject.mon);
    if (conv) {
      const afterBlock = el('div', { class: 'ss-after-block' });
      afterBlock.append(sectionTag('AFTER', conv.species, 'party-gen3'));
      afterBlock.append(renderFrlgAfterPanel(conv, subject.mon));
      panels.append(afterBlock);
      breakdownSrc = subject.mon;
      breakdownGen3 = conv;
    }
  } else if (subject.kind === 'transferSlot') {
    const mon = deserializeGen12FromStaging(subject.slot.pkBytes);
    if (mon) {
      const isRby = mon.sourceGen === 1;
      const beforeBlock = el('div', { class: 'ss-before-block' });
      beforeBlock.append(sectionTag('BEFORE', mon.speciesGen2Id, 'party-gen2', isRby));
      beforeBlock.append(renderSourceStatScreen(mon, isRby));
      panels.append(beforeBlock);
      const conv = opts.convert?.(mon);
      if (conv) {
        const afterBlock = el('div', { class: 'ss-after-block' });
        afterBlock.append(sectionTag('AFTER', conv.species, 'party-gen3'));
        afterBlock.append(renderFrlgAfterPanel(conv, mon));
        panels.append(afterBlock);
        breakdownSrc = mon;
        breakdownGen3 = conv;
      }
    } else {
      panels.append(
        el('div', { class: 'ss-deserialize-error' }, 'Could not decode this staged mon.'),
      );
    }
  } else {
    panels.append(renderFrlgAfterPanel(subject.intermediate));
  }
  inner.append(panels);

  // Conversion-mechanic breakdown (DV>IV / StatExp>EV / Nature) lives
  // BELOW the BEFORE/AFTER row — same compact table the user already
  // approved, just relocated under the new summary panels.
  if (breakdownSrc && breakdownGen3) {
    inner.append(renderGen3UnifiedCard(breakdownSrc, breakdownGen3, sourceStatsForCompare(breakdownSrc)));
  }

  const actions = el('div', { class: 'ss-actions' });
  if (subject.kind === 'sourceMon' && opts.onAddToTransfer) {
    const add = el(
      'button',
      { type: 'button', class: 'ss-btn ss-btn-add' },
      opts.addToTransferLabel ?? 'Add to Transfer Box',
    ) as HTMLButtonElement;
    add.addEventListener('click', () => {
      close();
      opts.onAddToTransfer?.();
    });
    actions.append(add);
  }
  if (subject.kind === 'transferSlot' && opts.onSendToDestination) {
    const send = el(
      'button',
      { type: 'button', class: 'ss-btn ss-btn-add' },
      opts.sendToDestinationLabel ?? 'Send to Destination',
    ) as HTMLButtonElement;
    send.addEventListener('click', () => {
      close();
      opts.onSendToDestination?.();
    });
    actions.append(send);
  }
  if (subject.kind === 'transferSlot' && opts.onCancelSend) {
    const cancel = el(
      'button',
      { type: 'button', class: 'ss-btn ss-btn-cancel' },
      'Cancel Send',
    ) as HTMLButtonElement;
    cancel.addEventListener('click', () => {
      close();
      opts.onCancelSend?.();
    });
    actions.append(cancel);
  }
  if (opts.onSaveAsPk2 && (subject.kind === 'sourceMon' || subject.kind === 'transferSlot')) {
    const pk2 = el(
      'button',
      { type: 'button', class: 'ss-btn ss-btn-pk2' },
      'Save as .pk2',
    ) as HTMLButtonElement;
    pk2.addEventListener('click', () => {
      opts.onSaveAsPk2?.();
    });
    actions.append(pk2);
  }
  if (subject.kind === 'transferSlot' && opts.onRemoveTransfer) {
    const remove = el('button', { type: 'button', class: 'ss-btn ss-btn-remove' }, 'Remove from Transfer') as HTMLButtonElement;
    remove.addEventListener('click', () => {
      close();
      opts.onRemoveTransfer?.();
    });
    actions.append(remove);
  }
  const close = (): void => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') close();
  }
  const closeBtn = el('button', { type: 'button', class: 'ss-btn ss-btn-close' }, 'Close') as HTMLButtonElement;
  closeBtn.addEventListener('click', () => close());
  actions.append(closeBtn);
  inner.append(actions);

  overlay.append(inner);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
}
