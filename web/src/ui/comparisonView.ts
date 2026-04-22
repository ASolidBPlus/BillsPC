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
import type { Gen12Pokemon, Gen3Intermediate } from '@pokeportal/core';
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
  return {
    source,
    converted,
    deltas: diffStats(converted, source),
  };
}

export interface ComparisonProps {
  readonly mon: Gen12Pokemon;
  readonly intermediate: Gen3Intermediate | null;
  readonly refusal?: { reason: string; message: string };
  readonly speciesName: string;
  readonly nickname: string;
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
}

function statusScreenGen12(p: Gen12PaneProps): HTMLElement {
  const pane = dialog({ class: 'status-screen status-screen--gen12' });
  pane.append(
    headerLine(p.speciesName, p.mon.level, p.shiny),
    spriteImg(p.mon.speciesGen2Id, 'gen2', p.speciesName),
  );
  // Per A11: single SPCL line. Use the source-side spa value, which the
  // formula derived from gen1Special (Gen 1 mons) or base.spa (Gen 2).
  const lines = [
    statRow('HP', p.stats.hp, undefined),
    statRow('ATTACK', p.stats.atk, undefined),
    statRow('DEFENSE', p.stats.def, undefined),
    statRow('SPEED', p.stats.spe, undefined),
    statRow('SPCL', p.stats.spa, undefined),
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
  pane.append(
    headerLine(p.speciesName, p.level, p.shiny),
    spriteImg(p.species, 'gen3', p.speciesName),
  );
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

function headerLine(species: string, level: number, shiny: boolean): HTMLElement {
  const h = el('div', { class: 'status-header' });
  h.append(el('span', { class: 'status-species' }, species));
  if (shiny) h.append(el('span', { class: 'shiny-star' }, '★'));
  h.append(el('span', { class: 'status-level' }, `Lv ${level}`));
  return h;
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
