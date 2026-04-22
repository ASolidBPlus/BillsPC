/**
 * Side-by-side Gen 1/2 ↔ Gen 3 status-screen comparison overlay.
 *
 * Layout (PLAN §3.6, §4.6):
 *   - header dialog: `<species> "<nick>" Lv <n>` + shiny `★` if applicable
 *   - left pane: Gen 1/2 status screen (single Special line per A11)
 *   - right pane: Gen 3 status screen (split SpA/SpD with delta badges)
 *   - bottom menu: STORE / CANCEL  (CANCEL only for refused mons per A10)
 *
 * Per PLAN_EVAL S5 A1, source-side base stats come from the Gen 1/2
 * personal table (`getPersonalGen2`). Per A11, the source-side Special
 * is rendered as a single line; deltas.spa and deltas.spd both compare
 * against that single Special value.
 *
 * Per A8, shiny mons get a gold `★` glyph in both status-screen
 * headers.
 *
 * `computeComparisonStats` is exported so the regression test can pin
 * the FATMAN delta values directly from the formula output (per A2:
 * "derive via the formula then assert the literal").
 */
import type { Gen12Pokemon, Gen3Intermediate, SaveFormat } from '@pokeportal/core';
import { getPersonal, getPersonalGen2, getSpecies, gen2Shiny } from '@pokeportal/core/internal';
import {
  computeGen12Stats,
  computeGen3Stats,
  diffStats,
  type SixStats,
  type SixStatDeltas,
} from './statFormulas.js';
import { dialog, textDialog } from './dialog.js';
import { el } from './dom.js';
import { spriteImg } from './sprites.js';
import { menu, type MenuItem } from './menu.js';
import { refusalDialog } from './refusal.js';
import { conversionDetails } from './details.js';

export interface ComparisonStats {
  readonly source: SixStats;
  readonly converted: SixStats;
  readonly deltas: SixStatDeltas;
}

export function computeComparisonStats(
  mon: Gen12Pokemon,
  intermediate: Gen3Intermediate,
): ComparisonStats {
  const personalGen2 = getPersonalGen2(mon.speciesGen2Id);
  const personalGen3 = getPersonal(intermediate.species);
  const source = computeGen12Stats(mon, personalGen2, mon.level);
  const converted = computeGen3Stats(personalGen3, {
    ivs: intermediate.ivs,
    evs: intermediate.evs,
    level: intermediate.level,
  });
  // Gen 1/2 only displays one Special value (we render source.spa as "SPECIAL").
  // Compute Gen 3 SpA/SpD deltas against that single displayed source so the
  // numbers on screen line up — otherwise the SpD delta uses the implicit
  // Gen 2 SpD-base value (which the user never sees) and looks unrelated to
  // the SPECIAL row.
  const sourceForDelta: SixStats = { ...source, spd: source.spa };
  return {
    source,
    converted,
    deltas: diffStats(converted, sourceForDelta),
  };
}

export interface ComparisonProps {
  readonly mon: Gen12Pokemon;
  readonly intermediate: Gen3Intermediate | null;
  readonly refusal?: { reason: string; message: string };
  readonly speciesName: string;
  readonly nickname: string;
  readonly sourceFormat: SaveFormat | null;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function comparisonView(props: ComparisonProps): HTMLElement {
  const wrap = el('div', { class: 'comparison-overlay' });
  wrap.addEventListener('click', (ev) => {
    if (ev.target === wrap) props.onCancel();
  });

  const inner = el('div', { class: 'comparison-inner' });
  const shiny = gen2Shiny(props.mon.dvs);
  const header = textDialog(
    [`${props.speciesName} "${props.nickname}" Lv ${props.mon.level}${shiny ? '  ★' : ''}`],
    { class: 'comparison-header' },
  );
  inner.append(header);

  if (props.intermediate === null) {
    // Refused mon: show single refusal pane instead of comparison.
    const reason = props.refusal?.reason ?? 'REFUSED';
    const msg = props.refusal?.message ?? 'This Pokemon cannot be transferred.';
    inner.append(refusalDialog(props.nickname, reason, msg));
    inner.append(
      menu({
        items: [{ label: 'CANCEL', onSelect: props.onCancel }],
        selectedIndex: 0,
      }),
    );
    wrap.append(inner);
    return wrap;
  }

  const stats = computeComparisonStats(props.mon, props.intermediate);
  const panes = el('div', { class: 'comparison-panes' });
  panes.append(
    statusScreenGen12({
      mon: props.mon,
      speciesName: props.speciesName,
      nickname: props.nickname,
      stats: stats.source,
      shiny,
      sourceFormat: props.sourceFormat,
    }),
    statusScreenGen3({
      species: props.intermediate.species,
      level: props.intermediate.level,
      speciesName: props.speciesName,
      nickname: props.nickname,
      stats: stats.converted,
      deltas: stats.deltas,
      shiny,
    }),
  );
  inner.append(panes);

  // Transparency: full conversion details (DV→IV, StatExp→EV, nature, PID, etc).
  inner.append(conversionDetails(props.mon, props.intermediate));

  const items: MenuItem[] = [
    { label: 'STORE', onSelect: props.onConfirm },
    { label: 'CANCEL', onSelect: props.onCancel },
  ];
  inner.append(menu({ items, selectedIndex: 0 }));

  wrap.append(inner);
  return wrap;
}

interface Gen12PaneProps {
  readonly mon: Gen12Pokemon;
  readonly speciesName: string;
  readonly nickname: string;
  readonly stats: SixStats;
  readonly shiny: boolean;
  readonly sourceFormat: SaveFormat | null;
}

function statusScreenGen12(p: Gen12PaneProps): HTMLElement {
  const pane = dialog({ class: 'status-screen status-screen--gen12' });
  // No species/level header here — it's already in the overlay's top dialog.
  // Per-gen label (so user knows which side is which) + shiny star (so test
  // selectors can still find one star per pane).
  const label = el('div', { class: 'pane-gen-label' }, paneLabelForFormat(p.sourceFormat));
  if (p.shiny) label.append(el('span', { class: 'shiny-star' }, '★'));
  pane.append(label);
  pane.append(spriteImg(p.mon.speciesGen2Id, 'gen2', p.speciesName, p.sourceFormat));
  // Single SPECIAL line — Gen 1/2 only had one Special value. The Gen 3 pane
  // computes SpA/SpD deltas against this single displayed source value
  // (see computeComparisonStats), so what's on screen lines up arithmetically.
  // Order: HP/ATK/DEF/SPECIAL/SPEED so SPEED sits at the bottom of the pane,
  // matching the Gen 3 pane's bottom row for visual alignment across panes.
  const lines = [
    statRow('HP', p.stats.hp, undefined),
    statRow('ATTACK', p.stats.atk, undefined),
    statRow('DEFENSE', p.stats.def, undefined),
    statRow('SPECIAL', p.stats.spa, undefined),
    statRow('SPEED', p.stats.spe, undefined),
  ];
  const block = el('div', { class: 'stat-block' });
  for (const l of lines) block.append(l);
  pane.append(block);
  return pane;
}

interface Gen3PaneProps {
  readonly species: number;
  readonly level: number;
  readonly speciesName: string;
  readonly nickname: string;
  readonly stats: SixStats;
  readonly deltas: SixStatDeltas;
  readonly shiny: boolean;
}

function statusScreenGen3(p: Gen3PaneProps): HTMLElement {
  const pane = dialog({ class: 'status-screen status-screen--gen3' });
  const label = el('div', { class: 'pane-gen-label' }, 'GEN 3 CONVERTED');
  if (p.shiny) label.append(el('span', { class: 'shiny-star' }, '★'));
  pane.append(label);
  pane.append(spriteImg(p.species, 'gen3', p.speciesName));
  const lines = [
    statRow('HP', p.stats.hp, p.deltas.hp),
    statRow('ATTACK', p.stats.atk, p.deltas.atk),
    statRow('DEFENSE', p.stats.def, p.deltas.def),
    statRow('SP. ATK', p.stats.spa, p.deltas.spa),
    statRow('SP. DEF', p.stats.spd, p.deltas.spd),
    statRow('SPEED', p.stats.spe, p.deltas.spe),
  ];
  const block = el('div', { class: 'stat-block' });
  for (const l of lines) block.append(l);
  pane.append(block);
  return pane;
}

function paneLabelForFormat(f: SaveFormat | null): string {
  switch (f) {
    case 'RBY-RED':
      return 'GEN 1 RED SOURCE';
    case 'RBY-BLUE':
      return 'GEN 1 BLUE SOURCE';
    case 'RBY-YELLOW':
      return 'GEN 1 YELLOW SOURCE';
    case 'GS':
      return 'GEN 2 GOLD/SILVER SOURCE';
    case 'CRYSTAL':
      return 'GEN 2 CRYSTAL SOURCE';
    default:
      return 'GEN 1/2 SOURCE';
  }
}

function statRow(label: string, value: number, delta: number | undefined): HTMLElement {
  const row = el('div', { class: 'stat-row' });
  row.append(
    el('span', { class: 'stat-label' }, label),
    el('span', { class: 'stat-value' }, String(value)),
  );
  if (delta !== undefined) {
    const sign = delta > 0 ? '+' : '';
    const cls =
      delta > 0
        ? 'stat-delta stat-delta--pos'
        : delta < 0
          ? 'stat-delta stat-delta--neg'
          : 'stat-delta stat-delta--zero';
    row.append(el('span', { class: cls }, `${sign}${delta}`));
  }
  return row;
}

/** Resolve a species name from the Gen 2 internal ID, fallback to a stub. */
export function speciesNameFor(gen2Id: number): string {
  return getSpecies(gen2Id)?.name ?? `species-${gen2Id}`;
}
