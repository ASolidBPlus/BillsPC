/**
 * Conversion-details panel — shown beneath the side-by-side status screens
 * in the comparison overlay. Surfaces the underlying conversion math:
 * DV → IV mappings, StatExp → EV mappings (with the proportional-cap
 * factor when applicable), nature derivation, PID search outcome, SID
 * derivation source, and met data. The goal is full transparency about
 * what the conversion did to each field.
 */
import type { Gen12Pokemon, Gen3Intermediate } from '@pokeportal/core';
import { hpDv, NATURE_NAMES, decodeGen12 } from '@pokeportal/core/internal';
import { dialog } from './dialog.js';
import { el } from './dom.js';

export function conversionDetails(
  mon: Gen12Pokemon,
  intermediate: Gen3Intermediate,
): HTMLElement {
  const wrap = dialog({ class: 'conversion-details' });
  wrap.append(el('div', { class: 'details-header' }, 'CONVERSION DETAILS'));
  // Two-column flow: stat tables (DV/IV + StatExp/EV) on the left, identity
  // + carryover on the right. Reduces overlay height ~40% on wide viewports
  // and stays readable on narrow ones (CSS collapses to one column under
  // a media query).
  const grid = el('div', { class: 'details-grid' });
  const colA = el('div');
  const colB = el('div');
  wrap.append(grid);
  grid.append(colA, colB);

  const ivBlock = el('div', { class: 'details-block' });
  ivBlock.append(el('div', { class: 'details-block-title' }, 'DV > IV'));
  const ivTable = el('table', { class: 'details-table' });
  const sourceHpDv = hpDv(mon.dvs);
  // 6-row form: SpA / SpD share the single Special DV. Mirror rows tinted
  // so it's clear they're driven by the same source value.
  type IvRow = readonly [string, string, string, boolean];
  const ivRows: readonly IvRow[] = [
    ['HP', String(sourceHpDv), String(intermediate.ivs.hp), false],
    ['Atk', String(mon.dvs.atk), String(intermediate.ivs.atk), false],
    ['Def', String(mon.dvs.def), String(intermediate.ivs.def), false],
    ['SpA', String(mon.dvs.special), String(intermediate.ivs.spa), true],
    ['SpD', String(mon.dvs.special), String(intermediate.ivs.spd), true],
    ['Spe', String(mon.dvs.spe), String(intermediate.ivs.spe), false],
  ];
  for (const [label, dv, iv, mirror] of ivRows) {
    const tr = el('tr', mirror ? { class: 'is-mirror' } : {});
    tr.append(
      el('td', { class: 'details-stat' }, label),
      el('td', { class: 'details-src' }, dv),
      el('td', { class: 'details-arrow' }, '>'),
      el('td', { class: 'details-dst' }, iv),
    );
    ivTable.append(tr);
  }
  ivBlock.append(ivTable);
  colA.append(ivBlock);

  const evBlock = el('div', { class: 'details-block' });
  evBlock.append(el('div', { class: 'details-block-title' }, 'StatExp > Raw EV > Final EV'));
  const evTable = el('table', { class: 'details-table' });
  // Raw EV per HANDOFF §4.3: floor(sqrt(StatExp[i])), capped at 252.
  // For Special: same raw value mirrored to both spa and spd.
  const rawEv = (se: number): number => Math.min(252, Math.floor(Math.sqrt(se)));
  const rawHp = rawEv(mon.statExp.hp);
  const rawAtk = rawEv(mon.statExp.atk);
  const rawDef = rawEv(mon.statExp.def);
  const rawSpe = rawEv(mon.statExp.spe);
  const rawSpc = rawEv(mon.statExp.special);
  const rawTotal = rawHp + rawAtk + rawDef + rawSpe + rawSpc * 2;
  // 6-row form: SpA / SpD share the single Special StatExp. Mirror rows
  // tinted to make the shared source obvious and to keep all numeric
  // columns single-value so they right-align cleanly.
  type EvRow = readonly [string, number, number, number, boolean];
  const evRows: readonly EvRow[] = [
    ['HP', mon.statExp.hp, rawHp, intermediate.evs.hp, false],
    ['Atk', mon.statExp.atk, rawAtk, intermediate.evs.atk, false],
    ['Def', mon.statExp.def, rawDef, intermediate.evs.def, false],
    ['SpA', mon.statExp.special, rawSpc, intermediate.evs.spa, true],
    ['SpD', mon.statExp.special, rawSpc, intermediate.evs.spd, true],
    ['Spe', mon.statExp.spe, rawSpe, intermediate.evs.spe, false],
  ];
  for (const [label, se, raw, ev, mirror] of evRows) {
    const tr = el('tr', mirror ? { class: 'is-mirror' } : {});
    tr.append(
      el('td', { class: 'details-stat' }, label),
      el('td', { class: 'details-src' }, String(se)),
      el('td', { class: 'details-arrow' }, '>'),
      el('td', { class: 'details-raw' }, String(raw)),
      el('td', { class: 'details-arrow' }, '>'),
      el('td', { class: 'details-dst' }, String(ev)),
    );
    evTable.append(tr);
  }
  const evSum =
    intermediate.evs.hp +
    intermediate.evs.atk +
    intermediate.evs.def +
    intermediate.evs.spa +
    intermediate.evs.spd +
    intermediate.evs.spe;
  const sumRow = el('tr', { class: 'details-sum' });
  const capLabel = rawTotal > 510 ? `${evSum} / 510` : `${evSum} (≤510)`;
  sumRow.append(
    el('td', { class: 'details-stat' }, 'Σ'),
    el('td', { class: 'details-src' }, '—'),
    el('td', { class: 'details-arrow' }, '>'),
    el('td', { class: 'details-raw' }, String(rawTotal)),
    el('td', { class: 'details-arrow' }, '>'),
    el('td', { class: 'details-dst' }, capLabel),
  );
  evTable.append(sumRow);
  evBlock.append(evTable);
  if (rawTotal > 510) {
    const factor = 510 / rawTotal;
    evBlock.append(
      el(
        'div',
        { class: 'details-note' },
        `Raw EV total ${rawTotal} > 510 cap. Scale factor 510 ÷ ${rawTotal} = ${factor.toFixed(3)}; per-stat EV = floor(raw × ${factor.toFixed(3)}); Hamilton remainder distributes the rounding shortfall to the largest fractional stats first.`,
      ),
    );
  } else {
    evBlock.append(
      el(
        'div',
        { class: 'details-note' },
        `Raw EV total ${rawTotal} ≤ 510 cap — no scaling needed; raw values pass through unchanged.`,
      ),
    );
  }
  colA.append(evBlock);

  const metaBlock = el('div', { class: 'details-block' });
  metaBlock.append(el('div', { class: 'details-block-title' }, 'Identity'));
  const metaTable = el('table', { class: 'details-table' });
  const natureName = NATURE_NAMES[intermediate.nature] ?? `nature-${intermediate.nature}`;
  const natureBucket = ((mon.dvs.atk << 4) | mon.dvs.def) % 5;
  const pidIters = intermediate._meta.pidSearchIterations;
  const otName = decodeGen12(mon.otNameBytes) || '(unknown)';
  const metaRows: [string, string][] = [
    ['OT', `${otName}  (TID ${intermediate.tid}, SID ${intermediate.sid})`],
    ['Nature', `${natureName}  (#${intermediate.nature}, bucket ${natureBucket}, neutral)`],
    [
      'PID',
      `0x${intermediate.pid.toString(16).padStart(8, '0')}  (${pidIters} iter${pidIters === 1 ? '' : 's'})`,
    ],
    [
      'Met',
      `Four Island, FRLG, met-level ${intermediate.metLevel} (hatched egg)`,
    ],
    ['Ability', `slot ${intermediate.abilitySlot}`],
  ];
  for (const [label, value] of metaRows) {
    const tr = el('tr');
    tr.append(el('td', { class: 'details-stat' }, label), el('td', { colspan: '3' }, value));
    metaTable.append(tr);
  }
  metaBlock.append(metaTable);
  colB.append(metaBlock);

  const carryBlock = el('div', { class: 'details-block' });
  carryBlock.append(el('div', { class: 'details-block-title' }, 'Carryover'));
  const carryTable = el('table', { class: 'details-table' });
  const carryRows: [string, string][] = [
    ['Item', intermediate.heldItem === 0 ? 'none' : `id ${intermediate.heldItem}`],
    ['Friendship', String(intermediate.friendship)],
    ['Pokerus', intermediate.pokerus === 0 ? 'clean' : `0x${intermediate.pokerus.toString(16)}`],
    ['EXP', String(intermediate.exp)],
  ];
  for (const [label, value] of carryRows) {
    const tr = el('tr');
    tr.append(el('td', { class: 'details-stat' }, label), el('td', { colspan: '3' }, value));
    carryTable.append(tr);
  }
  carryBlock.append(carryTable);
  colB.append(carryBlock);

  if (intermediate._meta.warnings.length > 0) {
    const warnBlock = el('div', { class: 'details-block' });
    warnBlock.append(el('div', { class: 'details-block-title' }, 'Warnings'));
    for (const w of intermediate._meta.warnings) {
      warnBlock.append(el('div', { class: 'details-warning' }, w));
    }
    colB.append(warnBlock);
  }

  return wrap;
}
